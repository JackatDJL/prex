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

import { Effect, FileSystem, Path } from "effect";
import { parse } from "smol-toml";

const host = "127.0.0.1";
const rolePattern = /^[a-z][a-z0-9_]*$/;
const variablePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;

function table(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export const findProjectScript = Effect.fn("findProjectScript")(function* (cwd: string, name: string) {
  const fs = yield* FileSystem.FileSystem;
  const { dirname, join, resolve } = yield* Path.Path;
  for (let root = resolve(cwd); ; root = dirname(root)) {
    const path = join(root, "config", "prex.toml");
    const source = yield* fs.readFileString(path).pipe(
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(undefined)),
    );
    if (source !== undefined) {
      const projectRoot = root;
      return yield* Effect.try({
        try: () => {
          const config = parse(source);
          if (config.version !== 1) throw new Error("version muss 1 sein.");
          const scripts = table(config.scripts);
          if (!scripts) throw new Error("[scripts] fehlt oder ist keine Tabelle.");
          return Object.hasOwn(scripts, name) ? decodeScript(projectRoot, scripts[name]) : undefined;
        },
        catch: (error) => new Error(`${path} (Script ${name}): ${String(error instanceof Error ? error.message : error)}`),
      });
    }
    if (dirname(root) === root) return undefined;
  }
});

function decodeScript(cwd: string, value: unknown) {
  const entry = table(value);
  if (!entry) throw new Error("Script muss eine TOML-Tabelle sein.");
  const { command, ports = [], env = {} } = entry;
  if (!strings(command) || !command[0]) throw new Error("command braucht ein nichtleeres Programm und String-Argumente.");
  if (!strings(ports) || ports.length > 5 || new Set(ports).size !== ports.length || !ports.every((role) => rolePattern.test(role))) {
    throw new Error("ports erwartet bis zu fünf eindeutige Rollen aus Kleinbuchstaben, Zahlen und Unterstrichen.");
  }
  const environment = table(env);
  if (!environment || Object.entries(environment).some(([key, value]) =>
    !variablePattern.test(key) || key.startsWith("PREX_") || typeof value !== "string"
  )) {
    throw new Error("env erwartet String-Werte und gültige Variablennamen außerhalb von PREX_*.");
  }

  const roles = ports;

  function render(template: string, assignedPorts?: readonly number[]): string {
    return template.replace(/\{\{([^{}]*)\}\}/g, (_match, key: string) => {
      if (key === "host") return host;
      const index = key.startsWith("port.") ? roles.indexOf(key.slice(5)) : -1;
      if (index < 0) throw new Error(`Unbekannter Platzhalter {{${key}}}.`);
      return String(assignedPorts?.[index] ?? 0);
    });
  }

  for (const template of [...command, ...Object.values(environment) as string[]]) render(template);
  return {
    cwd,
    count: ports.length,
    expand(assignedPorts: readonly number[], extraArgs: readonly string[]) {
      const overrides: NodeJS.ProcessEnv = Object.fromEntries(
        Object.entries(environment).map(([key, template]) => [key, render(template as string, assignedPorts)]),
      );
      for (const [index, role] of ports.entries()) {
        overrides[`PREX_PORT_${role.toUpperCase()}`] = String(assignedPorts[index]);
      }
      return {
        command: [...command.map((arg) => render(arg, assignedPorts)), ...extraArgs],
        environment: overrides,
      };
    },
  };
}
