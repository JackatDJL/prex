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

import { spawn, type ChildProcess } from "node:child_process";
import { open } from "node:fs/promises";
import { Cause, Effect, FileSystem, Schema } from "effect";
import { asError, task } from "./failure.js";
import { createConnection, createServer, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

const EndpointSchema = Schema.Struct({
  port: Schema.Int,
  local: Schema.String,
  tailscale: Schema.optionalKey(Schema.String),
});
const SessionSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  cwd: Schema.String,
  startedAt: Schema.String,
  urls: Schema.mutable(Schema.Array(EndpointSchema)),
  log: Schema.String,
});
export type Endpoint = typeof EndpointSchema.Type;
export type Session = typeof SessionSchema.Type;

const startupTimeout = 50_000;
const statePath = () => join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "prex", "sessions");
const sessionPath = (id: string) => join(statePath(), id);
const socketPath = (id: string) => join(sessionPath(id), "control");

export const startSession = Effect.fn("startSession")(function* (
  entry: string, args: readonly string[], name: string, compiled: boolean,
) {
  const fs = yield* FileSystem.FileSystem;
  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const logPath = join(sessionPath(id), "output.log");
  yield* fs.makeDirectory(statePath(), { recursive: true, mode: 0o700 });
  yield* fs.makeDirectory(sessionPath(id), { mode: 0o700 });

  return yield* Effect.scoped(Effect.gen(function* () {
    // The detached worker needs inherited log descriptors and a short-lived IPC channel.
    const log = yield* Effect.acquireRelease(
      task(() => open(logPath, "wx", 0o600)),
      (log) => task(() => log.close()).pipe(Effect.orDie),
    );
    return yield* Effect.callback<Session, Error>((resume) => {
      let child: ChildProcess;
      try {
        child = spawn(process.execPath, [...(compiled ? [] : [entry]), "__session", id, name, ...args], {
          detached: true, stdio: ["ignore", log.fd, log.fd, "ipc"],
        });
      } catch (error) {
        resume(Effect.fail(asError(error)));
        return;
      }
      let finished = false;
      const finish = (result: Effect.Effect<Session, Error>, keepWorker = false) => {
        if (finished) return;
        finished = true;
        if (!keepWorker) child.kill("SIGTERM");
        if (child.connected) child.disconnect();
        child.unref();
        resume(result);
      };
      child.once("error", (error) => finish(Effect.fail(error)));
      child.once("exit", (code) => finish(Effect.fail(new Error(`Session vorzeitig beendet (${code}).`))));
      child.once("disconnect", () => finish(Effect.fail(new Error("Session hat die Startverbindung geschlossen."))));
      child.once("message", (message: { session?: Session; error?: string }) => {
        if (message.session) finish(Effect.succeed(message.session), true);
        else finish(Effect.fail(new Error(message.error ?? "Ungültige Antwort vom Session-Prozess.")));
      });
      return Effect.sync(() => finish(Effect.fail(new Error("Session-Start abgebrochen."))));
    }).pipe(Effect.timeoutOrElse({
      duration: startupTimeout,
      orElse: () => Effect.fail(new Error("Zeitlimit beim Start der Session.")),
    }));
  })).pipe(Effect.mapError((error) => new Error(`${error.message} Log: ${logPath}`)));
});

export const runSession = Effect.fn("runSession")(function* <E, R>(
  id: string,
  name: string,
  run: (signal: AbortSignal, ready: (urls: Endpoint[], cwd: string) => Effect.Effect<void, Error>) => Effect.Effect<number, E, R>,
) {
  if (!process.send || !/^[0-9a-f]{16}$/.test(id)) {
    return yield* Effect.fail(new Error("Ungültiger interner Session-Aufruf."));
  }
  const fs = yield* FileSystem.FileSystem;
  const path = join(sessionPath(id), "session.json");
  const controller = new AbortController();
  const stop = () => controller.abort();
  const waiting = new Set<Socket>();
  const connections = new Set<Socket>();
  const server = createServer((socket) => {
    connections.add(socket);
    socket.on("close", () => {
      connections.delete(socket);
      waiting.delete(socket);
    });
    socket.on("error", () => socket.destroy());
    socket.setTimeout(1000, () => socket.destroy());
    let request = "";
    socket.on("data", (data) => {
      request += data.toString();
      if (request.length > 7) return socket.destroy();
      if (!request.endsWith("\n")) return;
      request = request.trimEnd();
      if (request === "status") socket.end("ok");
      else if (request === "stop") {
        socket.setTimeout(0);
        waiting.add(socket);
        stop();
      } else socket.destroy();
    });
  });
  return yield* Effect.gen(function* () {
    yield* Effect.callback<void, Error>((resume) => {
      server.once("error", (error) => resume(Effect.fail(error)));
      server.listen(socketPath(id), () => resume(Effect.void));
    });
    return yield* run(controller.signal, (urls, cwd) => Effect.gen(function* () {
      const session: Session = {
        id, name, cwd, startedAt: new Date().toISOString(), urls, log: join(sessionPath(id), "output.log"),
      };
      yield* fs.writeFileString(path + ".tmp", JSON.stringify(session), { mode: 0o600, flag: "wx" });
      yield* fs.rename(path + ".tmp", path);
      if (process.connected) process.send?.({ session });
    }).pipe(Effect.uninterruptible));
  }).pipe(
    Effect.ensuring(fs.remove(path, { force: true }).pipe(
      Effect.ensuring(Effect.sync(() => {
        for (const socket of connections) {
          if (waiting.has(socket)) socket.end("ok");
          else socket.destroy();
        }
        if (server.listening) server.close();
      })),
      Effect.orDie,
    )),
    Effect.onError((cause) => Effect.sync(() => {
      if (process.connected) process.send?.({ error: asError(Cause.squash(cause)).message });
    })),
  );
});

function request(session: Session, command: "status" | "stop") {
  return Effect.callback<void, Error>((resume) => {
    const socket = createConnection(socketPath(session.id));
    let response = "";
    socket.on("connect", () => socket.write(command + "\n"));
    socket.on("data", (chunk) => { response += String(chunk); });
    socket.on("error", (error) => resume(Effect.fail(error)));
    socket.on("close", () => resume(response === "ok" ? Effect.void
      : Effect.fail(new Error(`Session ${session.id} ist nicht erreichbar.`))));
    return Effect.sync(() => { socket.destroy(); });
  }).pipe(Effect.timeoutOrElse({
    duration: command === "stop" ? 45_000 : 1500,
    orElse: () => Effect.fail(new Error("Session antwortet nicht.")),
  }));
}

export const listSessions = Effect.fn("listSessions")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const ids = yield* fs.readDirectory(statePath()).pipe(
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed([])),
  );
  const sessions = yield* Effect.forEach(ids.filter((id) => /^[0-9a-f]{16}$/.test(id)), (id) =>
    fs.readFileString(join(sessionPath(id), "session.json")).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(SessionSchema))),
      Effect.filterOrFail((session) => session.id === id, () => new Error("Ungültige Session-ID.")),
      Effect.tap((session) => request(session, "status")),
      Effect.catch(() => Effect.succeed(undefined)),
    ), { concurrency: 32 });
  return sessions.filter((session): session is Session => session !== undefined)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
});

export function selectSession(sessions: Session[], selector?: string): Session {
  const exact = sessions.find(({ id }) => id === selector);
  if (exact) return exact;
  const matches = selector ? sessions.filter(({ name }) => name === selector) : sessions;
  if (matches.length === 1) return matches[0];
  throw new Error(matches.length ? "Mehrere passende Sessions. Gib die ID aus 'prex list' an." : "Keine passende laufende Session.");
}

export const stopSession = (session: Session) => request(session, "stop");
