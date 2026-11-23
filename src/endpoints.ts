import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import QRCode from "qrcode";
import type { Endpoint } from "./sessions.js";

const exec = promisify(execFile);

export async function serveTailnet(ports: readonly number[], signal: AbortSignal) {
  const { stdout } = await exec("tailscale", ["status", "--json"], { timeout: 5000, signal });
  const status = JSON.parse(stdout);
  const host = status.Self?.DNSName?.replace(/\.$/, "") ||
    status.Self?.TailscaleIPs?.find((ip: string) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
  if (status.BackendState !== "Running" || !host || !/^[\w.-]+$/.test(host)) {
    throw new Error("Tailscale braucht eine aktive Verbindung und eine lokale Tailnet-Adresse.");
  }

  const config = JSON.parse((await exec("tailscale", ["serve", "status", "--json"], { timeout: 5000, signal })).stdout);
  const occupied = (entry: { TCP?: Record<string, unknown>; Foreground?: Record<string, unknown> }): boolean =>
    ports.some((port) => Object.hasOwn(entry.TCP ?? {}, port)) ||
    Object.values(entry.Foreground ?? {}).some((child) => child !== null && typeof child === "object" && occupied(child));
  if (config && occupied(config)) throw new Error("Ein reservierter Port wird bereits von Tailscale Serve verwendet.");

  const gateways: Array<{ ready: Promise<void>; closed: Promise<void>; child: ChildProcess }> = [];
  async function dispose() {
    for (const { child } of gateways) child.kill("SIGTERM");
    const timeout = setTimeout(() => {
      for (const { child } of gateways) child.kill("SIGKILL");
    }, 2000);
    try {
      await Promise.all(gateways.map(({ closed }) => closed));
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    for (const port of ports) {
      signal.throwIfAborted();
      // A foreground Serve mapping is removed by tailscaled when the CLI disconnects.
      const child = spawn("tailscale", ["serve", `--tcp=${port}`, `tcp://127.0.0.1:${port}`], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
      const ready = new Promise<void>((resolve, reject) => {
        let output = "";
        const abort = () => reject(signal.reason);
        const timer = setTimeout(() => reject(new Error(`Tailscale Serve ist für Port ${port} nicht bereit: ${output.trim()}`)), 8000);
        const cleanup = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort);
        };
        function capture(chunk: Buffer) {
          output = (output + chunk).slice(-4000);
          if (output.includes("Press Ctrl+C")) {
            cleanup();
            resolve();
          }
        }
        child.stdout?.on("data", capture);
        child.stderr?.on("data", capture);
        child.once("error", reject);
        child.once("close", (code) => reject(new Error(`Tailscale Serve (${port}, Exit ${code}): ${output.trim()}`)));
        signal.addEventListener("abort", abort, { once: true });
        void closed.then(cleanup);
      });
      gateways.push({ ready, closed, child });
    }
    await Promise.all(gateways.map(({ ready }) => ready));
    return { host, dispose, closed: Promise.race(gateways.map(({ closed }) => closed)) };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export function endpoints(ports: readonly number[], tailnetHost?: string): Endpoint[] {
  return ports.map((port) => ({
    port, local: `http://127.0.0.1:${port}`,
    ...(tailnetHost ? { tailscale: `http://${tailnetHost}:${port}` } : {}),
  }));
}

export async function renderQr(url: string, image: boolean) {
  if (image) {
    const path = join(await mkdtemp(join(tmpdir(), "prex-qr-")), "qr.png");
    await QRCode.toFile(path, url, { width: 512, margin: 3 });
    return { url, image: path };
  }
  return { url, qr: await QRCode.toString(url, { type: "terminal", small: true }) };
}

export function printQr(result: Awaited<ReturnType<typeof renderQr>>, output: NodeJS.WriteStream) {
  output.write(result.image ? result.image + "\n" : `${result.url}\n${result.qr}`);
}
