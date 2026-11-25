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

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

declare const PREX_COMPILED: boolean;
export const compiled = typeof PREX_COMPILED !== "undefined" && PREX_COMPILED;

export async function upgrade(args: readonly string[]): Promise<number> {
  if (args.length > 1 || (args[0] && !["--stable", "--nightly"].includes(args[0]))) {
    throw new Error("Usage: prex upgrade [--stable | --nightly]");
  }
  const root = resolve(process.env.PREX_INSTALL ?? resolve(homedir(), ".prex"));
  if (!compiled || process.execPath !== resolve(root, "bin/prex")) {
    throw new Error("Use the package manager that installed Prex, or install from https://prex.djl.foundation/install.");
  }
  const channel = args[0]?.slice(2) ?? (await readFile(resolve(root, "channel"), "utf8")).trim();
  if (channel !== "stable" && channel !== "nightly") throw new Error("Invalid installed channel.");
  const response = await fetch("https://prex.djl.foundation/install", { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Installer download failed (HTTP ${response.status}).`);
  const script = await response.text();
  return new Promise((done, reject) => {
    const child = spawn("bash", ["-s", "--", `--${channel}`], {
      env: { ...process.env, PREX_INSTALL: root }, stdio: ["pipe", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (status) => done(status ?? 1));
    child.stdin.on("error", reject);
    child.stdin.end(script);
  });
}
