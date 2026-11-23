#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { constants as osConstants } from "node:os";
import { fileURLToPath } from "node:url";
import { prepareRun } from "./integrations.js";
import { reservePorts } from "./ports.js";
import { findProjectScript } from "./project-config.js";
import { endpoints, serveTailnet, renderQr, printQr } from "./endpoints.js";
import { listSessions, runSession, selectSession, startSession, stopSession, type Endpoint, type Session } from "./sessions.js";

export interface CliOptions {
  readonly help: boolean;
  readonly profile?: string;
  readonly count?: number;
  readonly command: readonly string[];
  readonly name?: string;
  readonly json?: true;
  readonly tailscale?: true;
  readonly qr?: true;
  readonly image?: true;
  readonly external?: true;
}

const usage = `Usage:
  prex <script> [arguments…] (config/prex.toml)
  prex [--ports N] [--profile NAME] <program> [arguments…]
  prex run [--ports N] [--profile NAME] -- <program> [arguments…]

  prex start [--name NAME] [options] <script> [arguments…]
  prex start [options] -- <program> [arguments…]
  prex status|stop [NAME|ID] [--json]
  prex list|stop-all [--json]
  prex qr|qri [NAME|ID|URL] [-i|--image] [--json]

Options:
  -t, --tailscale  Forward reserved ports with private Tailscale Serve
  --json           Print machine-readable results
  -qr, --qr, --QR  Render a terminal QR for the first URL
  -i, --image      Write a PNG QR to a temporary directory
  --ports N       Reserve 1 to 5 ports (default: integration-specific)
  --profile NAME  Select a project integration profile
  -h, --help      Show this help

The child process runs in the current directory with inherited standard streams.`;

export function parseArgs(argv: readonly string[]): CliOptions {
  if (argv.length === 0 || (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h"))) {
    return { help: true, command: [] };
  }

  const explicitRun = argv[0] === "run";
  const args = explicitRun ? argv.slice(1) : argv;
  let index = 0;
  let profile: string | undefined;
  let count: number | undefined;
  const flags: Omit<CliOptions, "help" | "command"> = {};
  const options = (command: readonly string[]) => ({ ...optionsWithCommand(profile, count, command), ...flags });

  while (index < args.length) {
    const arg = args[index];
    if (arg === "--") {
      const command = args.slice(index + 1);
      if (command.length === 0) throw new Error("Nach '--' fehlt das Startprogramm.");
      return { ...options(command), ...(!explicitRun ? { external: true as const } : {}) };
    }
    if (arg === "--help" || arg === "-h") {
      if (index !== args.length - 1) throw new Error("--help muss allein stehen.");
      return { help: true, command: [] };
    }
    if (arg === "--json" || arg === "-t" || arg === "--tailscale" || arg === "-qr" || arg === "--qr" || arg === "--QR" || arg === "-i" || arg === "--image") {
      const key = arg === "--json" ? "json" : arg === "-t" || arg === "--tailscale" ? "tailscale"
        : arg === "-i" || arg === "--image" ? "image" : "qr";
      Object.assign(flags, { [key]: true });
      index += 1;
      continue;
    }
    if (arg === "--ports" || arg === "--profile" || arg === "--name") {
      const value = args[index + 1];
      if (value === undefined || value === "--" || value.startsWith("--")) {
        throw new Error(`${arg} benötigt einen Wert.`);
      }
      if (arg === "--ports") {
        if (!/^[1-5]$/.test(value)) throw new Error("--ports erwartet eine ganze Zahl von 1 bis 5.");
        if (count !== undefined) throw new Error("--ports darf nur einmal angegeben werden.");
        count = Number(value);
      } else if (arg === "--name") {
        if (flags.name !== undefined || !/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("Ungültiger Session-Name.");
        Object.assign(flags, { name: value });
      } else {
        if (profile !== undefined) throw new Error("--profile darf nur einmal angegeben werden.");
        profile = value;
      }
      index += 2;
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unbekannte Prex-Option: ${arg}`);
    if (explicitRun) throw new Error("Bei 'prex run' muss das Programm nach '--' stehen.");
    return options(args.slice(index));
  }

  throw new Error(explicitRun ? "'prex run' benötigt '-- <Programm>'." : "Es fehlt ein Startprogramm.");
}

function optionsWithCommand(
  profile: string | undefined,
  count: number | undefined,
  command: readonly string[],
): CliOptions {
  return {
    help: false,
    ...(profile === undefined ? {} : { profile }),
    ...(count === undefined ? {} : { count }),
    command,
  };
}

function signalExitCode(signal: NodeJS.Signals): number {
  return 128 + (osConstants.signals[signal] ?? 0);
}

async function waitForPorts(ports: readonly number[], signal: AbortSignal) {
  const deadline = Date.now() + 30_000;
  let pending = [...ports];
  while (pending.length && Date.now() < deadline) {
    signal.throwIfAborted();
    pending = (await Promise.all(pending.map((port) => new Promise<number | undefined>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(300, () => socket.destroy());
      socket.once("connect", () => { resolve(undefined); socket.destroy(); });
      socket.once("error", () => resolve(port));
      socket.once("close", () => resolve(port));
    })))).filter((port): port is number => port !== undefined);
    if (pending.length) await delay(100, undefined, { signal });
  }
  if (pending.length) throw new Error(`Server lauscht noch nicht auf: ${pending.join(", ")}.`);
}

async function run(
  options: CliOptions,
  named: boolean,
  background?: { signal: AbortSignal; ready: (urls: Endpoint[], cwd: string) => Promise<void> },
): Promise<number> {
  const { command, profile, count } = options;
  const script = named && !profile && !options.external && /^[a-zA-Z0-9_-]+$/.test(command[0])
    ? await findProjectScript(process.cwd(), command[0])
    : undefined;
  if (script && count !== undefined && count !== script.count) throw new Error("Das Projekt-Script legt seine Portanzahl fest.");
  const cwd = script?.cwd ?? process.cwd();
  const prepared = script?.count === 0 ? undefined : await prepareRun({
    cwd, profile, count: script?.count ?? count, command,
  });
  const controller = new AbortController();
  const signal = background ? AbortSignal.any([background.signal, controller.signal]) : controller.signal;
  let exitSignal: NodeJS.Signals = "SIGTERM";
  const handlers = (["SIGINT", "SIGTERM", "SIGHUP"] as const).map((kind) => {
    const handler = () => { exitSignal = kind; controller.abort(); };
    process.on(kind, handler);
    return [kind, handler] as const;
  });
  let reservation: Awaited<ReturnType<typeof reservePorts>> | undefined;
  let tailnet: Awaited<ReturnType<typeof serveTailnet>> | undefined;
  try {
    if (prepared) reservation = await reservePorts(prepared.count);
    const ports = reservation?.ports ?? [];
    if (!ports.length && (options.tailscale || options.qr || options.image)) {
      throw new Error("Diese Option benötigt mindestens einen Port.");
    }
    if (options.tailscale) tailnet = await serveTailnet(ports, signal);
    const urls = endpoints(ports, tailnet?.host);
    const expanded = script?.expand(ports, command.slice(1));
    const childCommand = expanded?.command ?? prepared?.command ?? command;
    const env = { ...process.env, ...prepared?.environment(ports), ...expanded?.environment };

    await reservation?.releaseProbes();
    signal.throwIfAborted();
    const ownGroup = Boolean(background) || !process.stdin.isTTY;
    const child = spawn(childCommand[0], childCommand.slice(1), {
      cwd, env, detached: ownGroup,
      stdio: options.json && !background ? ["inherit", 2, 2] : "inherit",
    });
    let killTimer: NodeJS.Timeout | undefined;
    const send = (kind: NodeJS.Signals) => {
      if (child.pid === undefined) return;
      try {
        if (ownGroup) process.kill(-child.pid, kind);
        else child.kill(kind);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };
    const stop = () => {
      send(exitSignal);
      killTimer ??= setTimeout(() => send("SIGKILL"), 3000);
    };
    signal.addEventListener("abort", stop, { once: true });
    const result = new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, kind) => resolve(code ?? (kind ? signalExitCode(kind) : 1)));
    });
    const spawned = new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    const publishing = async () => {
      await spawned;
      if (background) {
        await waitForPorts(ports, signal);
        signal.throwIfAborted();
        await background.ready(urls, cwd);
      } else {
        if (!options.json) printUrls(urls, true);
        const qr = options.qr || options.image ? await renderQr(preferredUrl(urls), Boolean(options.image)) : undefined;
        if (options.json) process.stdout.write(JSON.stringify({ urls, ...qr }) + "\n");
        else if (qr) printQr(qr, process.stderr);
      }
    };
    const gateway = tailnet;
    const setup = publishing();
    try {
      const first = await Promise.race([
        setup.then(() => undefined),
        result.then((code) => {
          if (background) throw new Error(`Startbefehl vorzeitig beendet (${code}).`);
          return code;
        }),
      ]);
      if (first !== undefined) return first;
      return await (gateway ? Promise.race([
        result,
        gateway.closed.then(() => { throw new Error("Tailscale Serve wurde beendet."); }),
      ]) : result);
    } finally {
      controller.abort();
      await Promise.allSettled([result, setup]);
      clearTimeout(killTimer);
      if (ownGroup) send("SIGKILL");
    }
  } catch (error) {
    if (background?.signal.aborted || (controller.signal.aborted && error instanceof Error && error.name === "AbortError")) {
      return signalExitCode(exitSignal);
    }
    throw error;
  } finally {
    for (const [kind, handler] of handlers) process.off(kind, handler);
    try {
      await tailnet?.dispose();
    } finally {
      const cleanup = await Promise.allSettled([reservation?.release(), prepared?.dispose()]);
      const failed = cleanup.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    }
  }
}

function printUrls(urls: Endpoint[], foreground = false) {
  const output = foreground ? process.stderr : process.stdout;
  if (foreground && urls.length) output.write(`Prex-Ports: ${urls.map(({ port }) => port).join(", ")}\n`);
  for (const url of urls) output.write(`${url.local}${url.tailscale ? `  ${url.tailscale}` : ""}\n`);
}

function preferredUrl(urls: Endpoint[]): string {
  if (!urls[0]) throw new Error("Keine URL für diese Session.");
  return urls[0].tailscale ?? urls[0].local;
}

function printSessions(sessions: Session[], json: boolean, plural: boolean) {
  if (json) {
    process.stdout.write(JSON.stringify(plural ? sessions : sessions[0]) + "\n");
    return;
  }
  if (!sessions.length) process.stdout.write("Keine laufenden Sessions.\n");
  for (const session of sessions) {
    process.stdout.write(`${session.name} (${session.id})\n`);
    printUrls(session.urls);
    process.stdout.write(`Log: ${session.log}\n`);
  }
}

async function manage(action: string, args: readonly string[]): Promise<number> {
  const json = args.includes("--json");
  const image = action === "qri" || args.includes("-i") || args.includes("--image");
  const qr = action.toLowerCase() === "qr" || action === "qri";
  const selectors = args.filter((arg) => arg !== "--json" && !(qr && (arg === "-i" || arg === "--image")));
  const bulk = action === "list" || action === "stop-all";
  if (selectors.some((arg) => arg.startsWith("-")) || selectors.length > (bulk ? 0 : 1)) {
    throw new Error(`Ungültige Argumente für 'prex ${action}'.`);
  }
  const target = selectors[0];
  if (qr) {
    const url = /^https?:\/\/[^\s]+$/i.test(target ?? "")
      ? new URL(target).href
      : preferredUrl(selectSession(await listSessions(), target).urls);
    const result = await renderQr(url, image);
    if (json) process.stdout.write(JSON.stringify(result) + "\n");
    else printQr(result, process.stdout);
    return 0;
  }
  const all = await listSessions();
  const sessions = bulk ? all : [selectSession(all, target)];
  if (action === "stop" || action === "stop-all") {
    const settled = await Promise.allSettled(sessions.map(stopSession));
    const stopped = sessions.filter((_, index) => settled[index].status === "fulfilled");
    printSessions(stopped, json, bulk);
    const failed = settled.flatMap((result) => result.status === "rejected" ? [String(result.reason)] : []);
    if (failed.length) throw new Error(failed.join("\n"));
    return 0;
  }
  printSessions(sessions, json, bulk);
  return 0;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const [action, ...args] = argv;
  if (action === "__session") {
    const [id, name, ...raw] = args;
    return runSession(id, name, (signal, ready) => run(parseArgs(raw), true, { signal, ready }));
  }
  if (["status", "stop", "list", "stop-all", "qr", "QR", "qri"].includes(action)) return manage(action, args);
  const background = action === "start";
  const raw = background ? args : argv;
  const options = parseArgs(raw);
  if (options.help) {
    process.stdout.write(`${usage}\n`);
    return 0;
  }
  if (background) {
    const name = options.name ?? options.command[0];
    const session = await startSession(fileURLToPath(import.meta.url), raw, name);
    if (!options.json) printSessions([session], false, false);
    const qr = options.qr || options.image ? await renderQr(preferredUrl(session.urls), Boolean(options.image)) : undefined;
    if (options.json) process.stdout.write(JSON.stringify({ ...session, ...qr }) + "\n");
    else if (qr) printQr(qr, process.stdout);
    return 0;
  }
  if (options.name) throw new Error("--name ist nur mit 'start' verfügbar.");
  return run(options, action !== "run");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  main().then((status) => {
    process.exitCode = status;
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`prex: ${message}\n`);
    process.exitCode = 1;
  });
}
