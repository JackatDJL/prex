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

import { Effect, FileSystem, Path, Stream } from "effect";
import { HttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { homedir } from "node:os";

declare const PREX_COMPILED: boolean;
export const compiled = typeof PREX_COMPILED !== "undefined" && PREX_COMPILED;

export const upgrade = Effect.fn("upgrade")(function* (args: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const { resolve } = yield* Path.Path;
  if (args.length > 1 || (args[0] && !["--stable", "--nightly"].includes(args[0]))) {
    return yield* Effect.fail(new Error("Usage: prex upgrade [--stable | --nightly]"));
  }
  const root = resolve(process.env.PREX_INSTALL ?? resolve(homedir(), ".prex"));
  if (!compiled || process.execPath !== resolve(root, "bin/prex")) {
    return yield* Effect.fail(new Error("Use the package manager that installed Prex, or install from https://prex.djl.foundation/install."));
  }
  const channel = args[0]?.slice(2) ?? (yield* fs.readFileString(resolve(root, "channel"))).trim();
  if (channel !== "stable" && channel !== "nightly") return yield* Effect.fail(new Error("Invalid installed channel."));
  const script = yield* HttpClient.get("https://prex.djl.foundation/install").pipe(
    Effect.flatMap((response) => response.status >= 200 && response.status < 300
      ? response.text
      : Effect.fail(new Error(`Installer download failed (HTTP ${response.status}).`))),
    Effect.timeout("15 seconds"),
  );
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  return yield* spawner.exitCode(ChildProcess.make("bash", ["-s", "--", `--${channel}`], {
    env: { ...process.env, PREX_INSTALL: root },
    stdin: Stream.make(new TextEncoder().encode(script)),
    stdout: "inherit",
    stderr: "inherit",
  }));
});
