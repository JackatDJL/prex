#!/usr/bin/env -S bun --no-env-file
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

import { Cause, Effect, Exit } from "effect";
import { FetchHttpClient } from "effect/http";
import { BunServices } from "@effect/platform-bun";
import { asError, attempt, task } from "./failure.js";
import { compiled, upgrade } from "./upgrade.js";
import { createConnection } from "node:net";
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
  prex upgrade [--stable | --nightly]
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

function waitForPorts(ports: readonly number[]) {
  return Effect.gen(function* () {
    let pending = [...ports];
    while (pending.length) {
      const results = yield* Effect.forEach(pending, (port) => Effect.callback<boolean>((resume) => {
        const socket = createConnection({ host: "127.0.0.1", port });
        socket.setTimeout(300, () => socket.destroy());
        socket.once("connect", () => {
          resume(Effect.succeed(true));
          socket.destroy();
        });
        socket.once("error", () => resume(Effect.succeed(false)));
        socket.once("close", () => resume(Effect.succeed(false)));
        return Effect.sync(() => { socket.destroy(); });
      }), { concurrency: "unbounded" });
      pending = pending.filter((_, index) => !results[index]);
      if (pending.length) yield* Effect.sleep(100);
    }
  }).pipe(
    Effect.timeoutOrElse({ duration: "30 seconds", orElse: () =>
      Effect.fail(new Error(`Server lauscht noch nicht auf: ${ports.join(", ")}.`)) }),
  );
}

function termination(background?: AbortSignal) {
  return Effect.callback<NodeJS.Signals>((resume) => {
    const handlers = (["SIGINT", "SIGTERM", "SIGHUP"] as const).map((signal) => {
      const onSignal = () => finish(signal);
      process.on(signal, onSignal);
      return [signal, onSignal] as const;
    });
    const onStop = () => finish("SIGTERM");
    const cleanup = () => {
      for (const [signal, handler] of handlers) process.off(signal, handler);
      background?.removeEventListener("abort", onStop);
    };
    const finish = (signal: NodeJS.Signals) => {
      cleanup();
      resume(Effect.succeed(signal));
    };
    background?.addEventListener("abort", onStop, { once: true });
    if (background?.aborted) onStop();
    return Effect.sync(cleanup);
  });
}

const run = Effect.fn("run")(function* (
  options: CliOptions,
  named: boolean,
  background?: { signal: AbortSignal; ready: (urls: Endpoint[], cwd: string) => Effect.Effect<void, Error> },
) {
  let exitSignal: NodeJS.Signals = "SIGTERM";
  const lifecycle = Effect.gen(function* () {
    const { command, profile, count } = options;
    const script = named && !profile && !options.external && /^[a-zA-Z0-9_-]+$/.test(command[0])
      ? yield* findProjectScript(process.cwd(), command[0])
      : undefined;
    if (script && count !== undefined && count !== script.count) {
      return yield* Effect.fail(new Error("Das Projekt-Script legt seine Portanzahl fest."));
    }
    const cwd = script?.cwd ?? process.cwd();
    const prepared = script?.count === 0 ? undefined : yield* prepareRun({
      cwd, profile, count: script?.count ?? count, command,
    });
    const reservation = prepared ? yield* reservePorts(prepared.count) : undefined;
    const ports = reservation?.ports ?? [];
    if (!ports.length && (options.tailscale || options.qr || options.image)) {
      return yield* Effect.fail(new Error("Diese Option benötigt mindestens einen Port."));
    }
    const tailnet = options.tailscale ? yield* serveTailnet(ports) : undefined;
    const urls = endpoints(ports, tailnet?.host);
    const expanded = script?.expand(ports, command.slice(1));
    const childCommand = expanded?.command ?? prepared?.command ?? command;
    const env = { ...process.env, ...prepared?.environment(ports), ...expanded?.environment };
    if (reservation) yield* reservation.releaseProbes;

    const ownGroup = Boolean(background) || !process.stdin.isTTY;
    const spawnOptions = {
      cwd, env, detached: ownGroup, stdin: "inherit",
      stdout: options.json && !background ? 2 : "inherit",
      stderr: "inherit",
    } as const;
    const child = yield* Effect.acquireRelease(attempt(() => {
      try {
        return Bun.spawn([...childCommand], spawnOptions);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOEXEC") throw error;
        const [program, ...args] = childCommand;
        const scriptPath = program.includes("/") ? program : Bun.which(program, { cwd, PATH: env.PATH }) ?? program;
        return Bun.spawn(["/bin/sh", scriptPath, ...args], spawnOptions);
      }
    }), (child) => Effect.gen(function* () {
      const send = (signal: NodeJS.Signals) => {
        if (!ownGroup) {
          if (child.exitCode === null && child.signalCode === null) child.kill(signal);
          return;
        }
        try {
          process.kill(-child.pid, signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      };
      if (child.exitCode === null && child.signalCode === null) {
        yield* Effect.sync(() => send(exitSignal));
        yield* task(() => child.exited).pipe(
          Effect.timeoutOption("3 seconds"), Effect.interruptible, Effect.ignore,
        );
      }
      yield* Effect.sync(() => send("SIGKILL"));
      yield* Effect.promise(() => child.exited);
    }));
    const result = task(() => child.exited).pipe(Effect.map((code) => {
      const signal = child.signalCode;
      return typeof signal === "string" ? signalExitCode(signal) : typeof signal === "number" ? 128 + signal : code;
    }));

    if (background) {
      yield* Effect.raceFirst(
        waitForPorts(ports).pipe(Effect.andThen(background.ready(urls, cwd))),
        result.pipe(Effect.flatMap((code) => Effect.fail(new Error(`Startbefehl vorzeitig beendet (${code}).`)))),
      );
    } else {
      if (!options.json) printUrls(urls, true);
      const qr = options.qr || options.image ? yield* renderQr(preferredUrl(urls), Boolean(options.image)) : undefined;
      if (options.json) process.stdout.write(JSON.stringify({ urls, ...qr }) + "\n");
      else if (qr) printQr(qr, process.stderr);
    }
    return yield* tailnet ? Effect.raceFirst(result, tailnet.closed) : result;
  });

  return yield* Effect.raceFirst(Effect.scoped(lifecycle), termination(background?.signal).pipe(
    Effect.map((signal) => {
      exitSignal = signal;
      return signalExitCode(signal);
    }),
  ));
});

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

const manage = Effect.fn("manage")(function* (action: string, args: readonly string[]) {
  const json = args.includes("--json");
  const image = action === "qri" || args.includes("-i") || args.includes("--image");
  const qr = action.toLowerCase() === "qr" || action === "qri";
  const selectors = args.filter((arg) => arg !== "--json" && !(qr && (arg === "-i" || arg === "--image")));
  const bulk = action === "list" || action === "stop-all";
  if (selectors.some((arg) => arg.startsWith("-")) || selectors.length > (bulk ? 0 : 1)) {
    return yield* Effect.fail(new Error(`Ungültige Argumente für 'prex ${action}'.`));
  }
  const target = selectors[0];
  if (qr) {
    const direct = /^https?:\/\/[^\s]+$/i.test(target ?? "")
      ? yield* attempt(() => new URL(target).href)
      : undefined;
    const all = direct ? [] : yield* listSessions();
    const url = direct ?? (yield* attempt(() => preferredUrl(selectSession(all, target).urls)));
    const result = yield* renderQr(url, image);
    if (json) process.stdout.write(JSON.stringify(result) + "\n");
    else printQr(result, process.stdout);
    return 0;
  }
  const all = yield* listSessions();
  const sessions = bulk ? all : [yield* attempt(() => selectSession(all, target))];
  if (action === "stop" || action === "stop-all") {
    const settled = yield* Effect.forEach(sessions, (session) => Effect.exit(stopSession(session)), { concurrency: "unbounded" });
    const stopped = sessions.filter((_, index) => Exit.isSuccess(settled[index]));
    printSessions(stopped, json, bulk);
    const failed = settled.flatMap((result) => Exit.isFailure(result) ? [asError(Cause.squash(result.cause)).message] : []);
    if (failed.length) return yield* Effect.fail(new Error(failed.join("\n")));
    return 0;
  }
  printSessions(sessions, json, bulk);
  return 0;
});
export const main = Effect.fn("main")(function* (argv: readonly string[]) {
  const [action, ...args] = argv;
  if (action === "upgrade") return yield* upgrade(args);
  if (action === "__session") {
    const [id, name, ...raw] = args;
    return yield* runSession(id, name, (signal, ready) =>
      attempt(() => parseArgs(raw)).pipe(Effect.flatMap((options) => run(options, true, { signal, ready }))));
  }
  if (["status", "stop", "list", "stop-all", "qr", "QR", "qri"].includes(action)) return yield* manage(action, args);
  const background = action === "start";
  const raw = background ? args : argv;
  const options = yield* attempt(() => parseArgs(raw));
  if (options.help) {
    process.stdout.write(`${usage}\n`);
    return 0;
  }
  if (background) {
    const name = options.name ?? options.command[0];
    const session = yield* startSession(fileURLToPath(import.meta.url), raw, name, compiled);
    if (!options.json) printSessions([session], false, false);
    const qr = options.qr || options.image ? yield* attempt(() => preferredUrl(session.urls)).pipe(Effect.flatMap((url) => renderQr(url, Boolean(options.image)))) : undefined;
    if (options.json) process.stdout.write(JSON.stringify({ ...session, ...qr }) + "\n");
    else if (qr) printQr(qr, process.stdout);
    return 0;
  }
  if (options.name) return yield* Effect.fail(new Error("--name ist nur mit 'start' verfügbar."));
  return yield* run(options, action !== "run");
});

if (compiled || import.meta.main) {
  // Prex forwards the original signal to its child group and owns the exit code.
  const exit = await Effect.runPromiseExit(main(process.argv.slice(2)).pipe(Effect.provide([BunServices.layer, FetchHttpClient.layer])));
  if (Exit.isSuccess(exit)) process.exitCode = exit.value;
  else {
    process.stderr.write(`prex: ${asError(Cause.squash(exit.cause)).message}\n`);
    process.exitCode = 1;
  }
}
