import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  dispose(): Promise<void>;
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
export async function prepareRun(input: PrepareRunInput): Promise<PreparedRun> {
  const profile = input.profile === undefined ? undefined : profiles[input.profile];
  if (input.profile !== undefined && !profile) {
    throw new Error(`Unbekanntes Prex-Profil: ${input.profile}`);
  }
  if (input.command.length === 0 && !profile?.command) {
    throw new Error("Es muss ein Startbefehl angegeben werden.");
  }

  const count = profile?.count ?? input.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 5) {
    throw new Error("Die Anzahl der Ports muss eine ganze Zahl zwischen 1 und 5 sein.");
  }
  if (profile && input.count !== undefined && input.count !== profile.count) {
    throw new Error(`Das Profil ${input.profile} benötigt genau ${profile.count} Ports.`);
  }

  let runtimeDirectory: string | undefined;
  try {
    if (profile?.runtimeDirectory) {
      runtimeDirectory = await mkdtemp(join(tmpdir(), "prex-portfolio-"));
      await mkdir(join(runtimeDirectory, "vite-env"));
    }
  } catch (error) {
    if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true, force: true });
    throw error;
  }

  let disposed = false;
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
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (runtimeDirectory) await rm(runtimeDirectory, { recursive: true, force: true });
    },
  };
}
