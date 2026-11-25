/**
 * Prex
 *
 * @description Preview manager extended
 * @author Jack Ruder <jack@djl.foundation>
 * @copyright 2026 Jack Ruder
 * @see https://jack.djl.foundation
 * SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { Deferred, Effect, Fiber, FileSystem, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import QRCode from "qrcode";
import { attempt, task } from "./failure.js";
import type { Endpoint } from "./sessions.js";

const statusJson = Effect.fn("tailscaleStatus")(function* (args: string[]) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const stdout = yield* Effect.scoped(Effect.gen(function* () {
    const child = yield* spawner.spawn(ChildProcess.make("tailscale", args, { stderr: "ignore" }));
    const [code, output] = yield* Effect.all([
      child.exitCode,
      child.stdout.pipe(Stream.decodeText(), Stream.mkString),
    ], { concurrency: "unbounded" });
    if (code !== 0) return yield* Effect.fail(new Error(`Tailscale ${args.join(" ")} (Exit ${code}).`));
    return output;
  })).pipe(Effect.timeout("5 seconds"));
  return yield* attempt(() => JSON.parse(stdout));
});

export const serveTailnet = Effect.fn("serveTailnet")(function* (ports: readonly number[]) {
  const status = yield* statusJson(["status", "--json"]);
  const host = status.Self?.DNSName?.replace(/\.$/, "") ||
    status.Self?.TailscaleIPs?.find((ip: string) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
  if (status.BackendState !== "Running" || !host || !/^[\w.-]+$/.test(host)) {
    return yield* Effect.fail(new Error("Tailscale braucht eine aktive Verbindung und eine lokale Tailnet-Adresse."));
  }

  const config = yield* statusJson(["serve", "status", "--json"]);
  const occupied = (entry: { TCP?: Record<string, unknown>; Foreground?: Record<string, unknown> }): boolean =>
    ports.some((port) => Object.hasOwn(entry.TCP ?? {}, port)) ||
    Object.values(entry.Foreground ?? {}).some((child) => child !== null && typeof child === "object" && occupied(child));
  if (config && occupied(config)) {
    return yield* Effect.fail(new Error("Ein reservierter Port wird bereits von Tailscale Serve verwendet."));
  }

  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const gateways = yield* Effect.forEach(ports, (port) => Effect.gen(function* () {
    // tailscaled removes the foreground mapping when this child disconnects.
    const child = yield* spawner.spawn(ChildProcess.make("tailscale", [
      "serve", `--tcp=${port}`, `tcp://127.0.0.1:${port}`,
    ], { stdin: "ignore", forceKillAfter: "2 seconds" }));
    const ready = yield* Deferred.make<void>();
    let output = "";
    const closed = yield* child.all.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) => Effect.suspend(() => {
        output = (output + chunk).slice(-4000);
        return output.includes("Press Ctrl+C") ? Deferred.succeed(ready, undefined) : Effect.void;
      })),
      Effect.andThen(child.exitCode),
      Effect.flatMap((code) => Effect.fail(new Error(`Tailscale Serve (${port}, Exit ${code}): ${output.trim()}`))),
      Effect.forkScoped,
    );
    return {
      ready: Deferred.await(ready).pipe(Effect.raceFirst(Fiber.join(closed)), Effect.timeoutOrElse({
        duration: "8 seconds",
        orElse: () => Effect.fail(new Error(`Tailscale Serve ist für Port ${port} nicht bereit: ${output.trim()}`)),
      })),
      closed: Fiber.join(closed),
    };
  }), { concurrency: "unbounded" });
  yield* Effect.forEach(gateways, ({ ready }) => ready, { concurrency: "unbounded", discard: true });
  return { host: host as string, closed: Effect.raceAllFirst(gateways.map(({ closed }) => closed)) };
});

export function endpoints(ports: readonly number[], tailnetHost?: string): Endpoint[] {
  return ports.map((port) => ({
    port, local: `http://127.0.0.1:${port}`,
    ...(tailnetHost ? { tailscale: `http://${tailnetHost}:${port}` } : {}),
  }));
}

type QrResult = { url: string; image: string; qr?: never } | { url: string; qr: string; image?: never };

export const renderQr = Effect.fn("renderQr")(function* (url: string, image: boolean) {
  if (!image) {
    const qr = yield* task(() => QRCode.toString(url, { type: "terminal", small: true }));
    return { url, qr } satisfies QrResult;
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const png = yield* task(() => QRCode.toBuffer(url, { width: 512, margin: 3 }));
  const directory = yield* fs.makeTempDirectory({ prefix: "prex-qr-" });
  const file = path.join(directory, "qr.png");
  yield* fs.writeFile(file, png).pipe(
    Effect.onError(() => fs.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore)),
  );
  return { url, image: file } satisfies QrResult;
});

export function printQr(result: QrResult, output: NodeJS.WriteStream) {
  output.write(result.image ? result.image + "\n" : `${result.url}\n${result.qr}`);
}
