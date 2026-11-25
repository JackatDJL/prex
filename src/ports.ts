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

import { randomInt } from "node:crypto";
import { homedir } from "node:os";
import { createServer, type Server } from "node:net";
import { Effect, Exit, FileSystem, Path, Schema, Scope } from "effect";
import { attempt, task } from "./failure.js";

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1024, maximum: 65535 }));
const Settings = Schema.Struct({
  version: Schema.Literal(1),
  ports: Schema.Struct({ min: Port, max: Port }),
});
const Reservation = Schema.Struct({
  version: Schema.Literal(1),
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  runId: Schema.String,
  port: Schema.Int,
});

const reserveAttempt = Effect.fn("reserveAttempt")(function* (
  directory: string, candidates: number[], count: number, runId: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const held: Array<{ port: number; close: Effect.Effect<void, Error> }> = [];
  const remove = (file: string) => fs.remove(file, { force: true });
  for (const port of candidates) {
    const server = yield* Effect.acquireRelease(
      probePort(port), (server) => server ? closeServer(server).pipe(Effect.orDie) : Effect.void,
    );
    if (!server) continue;
    const close = closeServer(server);
    const recordPath = path.join(directory, `port-${port}.json`);
    const temp = path.join(directory, `.reservation-${runId}-${port}`);
    const record = JSON.stringify({ version: 1, pid: process.pid, runId, port });
    const acquired = yield* Effect.uninterruptible(Effect.gen(function* () {
      yield* fs.writeFileString(temp, record, { mode: 0o600, flag: "wx" });
      const linked = yield* fs.link(temp, recordPath).pipe(
        Effect.as(true),
        Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.succeed(false)),
        Effect.ensuring(remove(temp).pipe(Effect.ignore)),
      );
      if (linked) {
        yield* Effect.addFinalizer(() => Effect.gen(function* () {
          const current = yield* readReservation(recordPath);
          if (current?.runId === runId) yield* remove(recordPath);
        }).pipe(Effect.orDie));
      }
      return linked;
    }));
    if (!acquired) {
      // Keep the probe bound until reclamation finishes so competing Prex
      // invocations cannot replace the same stale record concurrently.
      const owner = yield* readReservation(recordPath);
      if (owner && (yield* ownerExited(owner.pid))) yield* remove(recordPath);
      yield* close;
      continue;
    }
    held.push({ port, close });
    if (held.length === count) return held;
  }
  return undefined;
});

export const reservePorts = Effect.fn("reservePorts")(function* (count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 5) {
    return yield* Effect.fail(new RangeError(`Port count must be an integer from 1 to 5; received ${count}`));
  }
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configPath = path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "prex", "config.json");
  const range = yield* fs.readFileString(configPath).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Settings))),
    Effect.map(({ ports }) => ports),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed({ min: 41000, max: 41999 })),
    Effect.filterOrFail(({ min, max }) => min <= max, () => new Error("ports.min must be <= ports.max")),
    Effect.mapError((error) => new Error(`Invalid Prex configuration at ${configPath}: ${error.message}`)),
  );
  const capacity = range.max - range.min + 1;
  if (count > capacity) {
    return yield* Effect.fail(new Error(`Cannot reserve ${count} ports from range ${range.min}-${range.max}`));
  }

  const directory = path.join(process.env.XDG_STATE_HOME || path.join(homedir(), ".local", "state"), "prex", "ports");
  yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
  const scope = yield* Scope.Scope;
  const runId = crypto.randomUUID().replaceAll("-", "");
  const maxAttempts = Math.min(8, Math.max(2, capacity));
  for (let remaining = maxAttempts; remaining > 0; remaining--) {
    const lease = yield* Scope.fork(scope);
    const held = yield* reserveAttempt(directory, shuffledPorts(range), count, runId).pipe(Scope.provide(lease));
    if (held) return {
      ports: held.map(({ port }) => port),
      releaseProbes: Effect.forEach(held, ({ close }) => close, { discard: true, concurrency: "unbounded" }),
    };
    yield* Scope.close(lease, Exit.void);
    if (remaining > 1) yield* Effect.sleep(randomInt(10, 60));
  }
  return yield* Effect.fail(new Error(`Unable to reserve ${count} ports in range ${range.min}-${range.max}`));
});

function probePort(port: number) {
  return Effect.callback<Server | undefined, Error>((resume) => {
    const server = createServer((socket) => socket.destroy());
    const onError = (error: NodeJS.ErrnoException) =>
      resume(error.code === "EADDRINUSE" ? Effect.succeed(undefined) : Effect.fail(error));
    server.once("error", onError);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.off("error", onError);
      resume(Effect.succeed(server));
    });
  });
}

function closeServer(server: Server) {
  return task(() => new Promise<void>((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  }));
}

const readReservation = Effect.fn("readReservation")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(path).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Reservation))),
    Effect.catchTag("SchemaError", () => Effect.succeed(undefined)),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
  );
});

function ownerExited(pid: number) {
  return attempt(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH") return true;
      if (code === "EPERM") return false;
      throw error;
    }
  });
}

function shuffledPorts({ min, max }: { min: number; max: number }): number[] {
  const ports = Array.from({ length: max - min + 1 }, (_, index) => min + index);
  for (let index = ports.length - 1; index > 0; index--) {
    const swapIndex = randomInt(index + 1);
    [ports[index], ports[swapIndex]] = [ports[swapIndex], ports[index]];
  }
  return ports;
}
