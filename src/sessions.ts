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
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createConnection, createServer, type Socket } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Endpoint {
  port: number;
  local: string;
  tailscale?: string;
}

export interface Session {
  id: string;
  name: string;
  cwd: string;
  startedAt: string;
  urls: Endpoint[];
  log: string;
}

const startupTimeout = 50_000;
const statePath = () => join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "prex", "sessions");
const sessionPath = (id: string) => join(statePath(), id);
const socketPath = (id: string) => join(sessionPath(id), "control");

export async function startSession(entry: string, args: readonly string[], name: string, compiled = false): Promise<Session> {
  const id = randomUUID().replaceAll("-", "").slice(0, 16);
  await mkdir(statePath(), { recursive: true, mode: 0o700 });
  await mkdir(sessionPath(id), { mode: 0o700 });
  let worker: ChildProcess | undefined;
  try {
    const log = await open(join(sessionPath(id), "output.log"), "wx", 0o600);
    try {
      worker = spawn(process.execPath, [...(compiled ? [] : [entry]), "__session", id, name, ...args], {
        detached: true, stdio: ["ignore", log.fd, log.fd, "ipc"],
      });
    } finally {
      await log.close();
    }
    const child = worker;
    return await new Promise<Session>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Zeitlimit beim Start der Session.")), startupTimeout);
      child.once("error", reject);
      child.once("exit", (code) => reject(new Error(`Session vorzeitig beendet (${code}).`)));
      child.once("message", (message: { session?: Session; error?: string }) => {
        if (message.session) resolve(message.session);
        else reject(new Error(message.error ?? "Ungültige Antwort vom Session-Prozess."));
      });
      child.once("disconnect", () => reject(new Error("Session hat die Startverbindung geschlossen.")));
      child.once("exit", () => clearTimeout(timeout));
      child.once("message", () => clearTimeout(timeout));
      child.once("disconnect", () => clearTimeout(timeout));
      child.once("error", () => clearTimeout(timeout));
    });
  } catch (error) {
    worker?.kill("SIGTERM");
    throw new Error(`${error instanceof Error ? error.message : String(error)} Log: ${join(sessionPath(id), "output.log")}`);
  } finally {
    if (worker?.connected) worker.disconnect();
    worker?.unref();
  }
}

export async function runSession(
  id: string,
  name: string,
  run: (signal: AbortSignal, ready: (urls: Endpoint[], cwd: string) => Promise<void>) => Promise<number>,
): Promise<number> {
  if (!process.send || !/^[0-9a-f]{16}$/.test(id)) throw new Error("Ungültiger interner Session-Aufruf.");
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
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath(id), resolve);
    });
    return await run(controller.signal, async (urls, cwd) => {
      const session: Session = {
        id, name, cwd, startedAt: new Date().toISOString(), urls, log: join(sessionPath(id), "output.log"),
      };
      const path = join(sessionPath(id), "session.json");
      await writeFile(path + ".tmp", JSON.stringify(session), { mode: 0o600, flag: "wx" });
      await rename(path + ".tmp", path);
      if (process.connected) process.send?.({ session });
    });
  } catch (error) {
    if (process.connected) process.send?.({ error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    await rm(join(sessionPath(id), "session.json"), { force: true });
    for (const socket of connections) {
      if (waiting.has(socket)) socket.end("ok");
      else socket.destroy();
    }
    if (server.listening) server.close();
  }
}

function request(session: Session, command: "status" | "stop"): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath(session.id));
    let response = "";
    socket.setTimeout(command === "stop" ? 45_000 : 1500, () => socket.destroy(new Error("Session antwortet nicht.")));
    socket.on("connect", () => socket.write(command + "\n"));
    socket.on("data", (chunk) => { response += String(chunk); });
    socket.on("error", reject);
    socket.on("close", () => response === "ok" ? resolve() : reject(new Error(`Session ${session.id} ist nicht erreichbar.`)));
  });
}

export async function listSessions(): Promise<Session[]> {
  const ids = await readdir(statePath()).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const sessions = await Promise.all(ids.filter((id) => /^[0-9a-f]{16}$/.test(id)).map(async (id) => {
    try {
      const session = JSON.parse(await readFile(join(sessionPath(id), "session.json"), "utf8")) as Session;
      if (session.id !== id) return undefined;
      await request(session, "status");
      return session;
    } catch {
      return undefined;
    }
  }));
  return sessions.filter((session): session is Session => session !== undefined)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function selectSession(sessions: Session[], selector?: string): Session {
  const exact = sessions.find(({ id }) => id === selector);
  if (exact) return exact;
  const matches = selector ? sessions.filter(({ name }) => name === selector) : sessions;
  if (matches.length === 1) return matches[0];
  throw new Error(matches.length ? "Mehrere passende Sessions. Gib die ID aus 'prex list' an." : "Keine passende laufende Session.");
}

export const stopSession = (session: Session) => request(session, "stop");
