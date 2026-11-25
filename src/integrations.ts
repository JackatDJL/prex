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

import { Effect, FileSystem } from "effect";
import { join } from "node:path";

export interface PrepareRunInput {
  cwd: string;
  profile?: string;
  count?: number;
  command: readonly string[];
}

export interface PreparedRun {
  count: number;
  command: readonly string[];
  environment(ports: readonly number[]): NodeJS.ProcessEnv;
}

type Integration = {
  count: number;
  roles: readonly string[];
  command?: readonly string[];
  environment: (ports: readonly number[], runtimeDirectory?: string) => NodeJS.ProcessEnv;
  runtimeDirectory?: boolean;
};

const portfolio: Integration = {
  count: 2,
  roles: ["app", "vite"],
  runtimeDirectory: true,
  environment: ([appPort, vitePort], runtimeDirectory) => {
    if (appPort === undefined || vitePort === undefined || !runtimeDirectory) {
      throw new Error("Das Portfolio-Profil benötigt zwei Ports und ein Laufzeitverzeichnis.");
    }
    return {
      PREX_PORT: String(appPort),
      PORT: String(appPort),
      PREX_HOST: "127.0.0.1",
      PREX_PORT_1: String(appPort),
      PREX_PORT_2: String(vitePort),
      PREX_PORT_APP: String(appPort),
      PREX_PORT_VITE: String(vitePort),
      SERVER_PORT: String(appPort),
      SERVER_HOST: "127.0.0.1",
      HOMEPAGE_PREVIEW_VITE_PORT: String(vitePort),
      HOMEPAGE_PREVIEW_HOST: "127.0.0.1",
      HOMEPAGE_PREVIEW_HOT_FILE: join(runtimeDirectory, "vite.hot"),
      HOMEPAGE_PREVIEW_ENV_DIR: join(runtimeDirectory, "vite-env"),
    };
  },
};

const profiles: Readonly<Record<string, Integration>> = { portfolio };

/**
 * Prepares profile-specific run state. The caller reserves `count` ports and
 * merges `environment(ports)` over its inherited process environment.
 */
export const prepareRun = Effect.fn("prepareRun")(function* (input: PrepareRunInput) {
  const fs = yield* FileSystem.FileSystem;
  const profile = input.profile !== undefined && Object.hasOwn(profiles, input.profile)
    ? profiles[input.profile]
    : undefined;
  if (input.profile !== undefined && !profile) {
    return yield* Effect.fail(new Error(`Unbekanntes Prex-Profil: ${input.profile}`));
  }
  if (input.command.length === 0 && !profile?.command) {
    return yield* Effect.fail(new Error("Es muss ein Startbefehl angegeben werden."));
  }

  const count = profile?.count ?? input.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 5) {
    return yield* Effect.fail(new Error("Die Anzahl der Ports muss eine ganze Zahl zwischen 1 und 5 sein."));
  }
  if (profile && input.count !== undefined && input.count !== profile.count) {
    return yield* Effect.fail(new Error(`Das Profil ${input.profile} benötigt genau ${profile.count} Ports.`));
  }

  const runtimeDirectory = profile?.runtimeDirectory
    ? yield* fs.makeTempDirectoryScoped({ prefix: "prex-portfolio-" })
    : undefined;
  if (runtimeDirectory) yield* fs.makeDirectory(join(runtimeDirectory, "vite-env"));

  return {
    count,
    command: profile?.command ?? input.command,
    environment(assignedPorts) {
      if (assignedPorts.length !== count) {
        throw new Error(`Erwartet werden ${count} Ports, erhalten wurden ${assignedPorts.length}.`);
      }
      const overrides: NodeJS.ProcessEnv = {
        PREX_PORT: String(assignedPorts[0]),
        PORT: String(assignedPorts[0]),
        PREX_HOST: "127.0.0.1",
      };
      for (let index = 0; index < assignedPorts.length; index += 1) {
        overrides[`PREX_PORT_${index + 1}`] = String(assignedPorts[index]);
      }
      for (const [index, role] of (profile?.roles ?? []).entries()) {
        overrides[`PREX_PORT_${role.toUpperCase()}`] = String(assignedPorts[index]);
      }
      return { ...overrides, ...(profile?.environment(assignedPorts, runtimeDirectory) ?? {}) };
    },
  } satisfies PreparedRun;
});
