import { randomBytes, randomInt } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { mkdir, link, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";

const DEFAULT_MIN = 41000;
const DEFAULT_MAX = 41999;
const MAX_PORT_COUNT = 5;
const RESERVATION_PREFIX = "port-";
const TEMP_PREFIX = ".reservation-";

type PortRange = { min: number; max: number };
type Reservation = { version: 1; pid: number; runId: string; port: number };

/** Reserve one to five independently selected IPv4 loopback TCP ports. */
export async function reservePorts(
  count: number,
): Promise<{ ports: readonly number[]; releaseProbes(): Promise<void>; release(): Promise<void> }> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_PORT_COUNT) {
    throw new RangeError(`Port count must be an integer from 1 to ${MAX_PORT_COUNT}; received ${count}`);
  }

  const { directory, range } = await loadConfigAndStateDirectory();
  const capacity = range.max - range.min + 1;
  if (count > capacity) {
    throw new Error(`Cannot reserve ${count} ports from range ${range.min}-${range.max}`);
  }

  const runId = randomBytes(16).toString("hex");
  const held: Array<{ port: number; server: Server; path: string }> = [];
  const maxAttempts = Math.min(8, Math.max(2, capacity));

  try {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidates = shuffledPorts(range);
      for (const port of candidates) {
        const server = await probePort(port);
        if (!server) continue;

        const path = reservationPath(directory, port);
        try {
          // link() publishes a fully-written record atomically and fails if another
          // cooperating invocation already owns this port.
          const tempPath = join(directory, `${TEMP_PREFIX}${runId}-${port}`);
          const record: Reservation = { version: 1, pid: process.pid, runId, port };
          await writeFile(tempPath, JSON.stringify(record), { mode: 0o600, flag: "wx" });
          try {
            await link(tempPath, path);
          } finally {
            await unlink(tempPath).catch(() => undefined);
          }
          held.push({ port, server, path });
          if (held.length === count) return createLease(held, runId);
        } catch (error) {
          await closeServer(server);
          if (isCode(error, "EEXIST")) {
            await removeReservationIfOwnerExited(path);
            continue;
          }
          throw error;
        }
      }

      await releaseHeld(held, runId);
      if (attempt + 1 < maxAttempts) await delay(randomInt(10, 60));
    }
  } catch (error) {
    await releaseHeld(held, runId);
    throw error;
  }

  await releaseHeld(held, runId);
  throw new Error(`Unable to reserve ${count} ports in range ${range.min}-${range.max}`);
}

function createLease(
  held: Array<{ port: number; server: Server; path: string }>,
  runId: string,
) {
  let releaseProbesPromise: Promise<void> | undefined;
  let releasePromise: Promise<void> | undefined;

  const releaseProbes = (): Promise<void> => {
    if (releaseProbesPromise) return releaseProbesPromise;
    releaseProbesPromise = Promise.all(held.map(({ server }) => closeServer(server))).then(() => undefined);
    return releaseProbesPromise;
  };

  const release = (): Promise<void> => {
    if (releasePromise) return releasePromise;
    releasePromise = (async () => {
      let closeError: unknown;
      try {
        await releaseProbes();
      } catch (error) {
        closeError = error;
      }
      const errors = await Promise.all(held.map(async ({ path }) => {
        try {
          const record = parseReservation(await readFile(path, "utf8"));
          if (record?.runId === runId) await unlink(path);
          return undefined;
        } catch (error) {
          if (isCode(error, "ENOENT")) return undefined;
          return error;
        }
      }));
      const error = errors.find(Boolean) ?? closeError;
      if (error) throw error;
    })();
    return releasePromise;
  };

  return { ports: held.map(({ port }) => port), releaseProbes, release };
}

async function releaseHeld(
  held: Array<{ port: number; server: Server; path: string }>,
  runId: string,
): Promise<void> {
  await Promise.all(held.map(async ({ server, path }) => {
    await closeServer(server).catch(() => undefined);
    try {
      const record = parseReservation(await readFile(path, "utf8"));
      if (record?.runId === runId) await unlink(path);
    } catch (error) {
      if (!isCode(error, "ENOENT")) throw error;
    }
  }));
  held.length = 0;
}

async function probePort(port: number): Promise<Server | undefined> {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen({ host: "127.0.0.1", port, exclusive: true });
    });
    return server;
  } catch (error) {
    await closeServer(server).catch(() => undefined);
    if (isCode(error, "EADDRINUSE")) return undefined;
    throw error;
  }
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function loadConfigAndStateDirectory(): Promise<{ directory: string; range: PortRange }> {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const configPath = join(configHome, "prex", "config.json");
  let range: PortRange = { min: DEFAULT_MIN, max: DEFAULT_MAX };
  try {
    const parsed: unknown = JSON.parse(await readFile(configPath, "utf8"));
    if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.ports)) {
      throw new Error("expected { version: 1, ports: { min, max } }");
    }
    const { min, max } = parsed.ports;
    if (!validPort(min) || !validPort(max) || min > max) {
      throw new Error("ports.min and ports.max must be integers from 1024 to 65535, with min <= max");
    }
    range = { min, max };
  } catch (error) {
    if (!isCode(error, "ENOENT")) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid Prex configuration at ${configPath}: ${detail}`, { cause: error });
    }
  }

  const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  const directory = join(stateHome, "prex", "ports");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return { directory, range };
}

function shuffledPorts({ min, max }: PortRange): number[] {
  const ports = Array.from({ length: max - min + 1 }, (_, index) => min + index);
  for (let index = ports.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [ports[index], ports[swapIndex]] = [ports[swapIndex], ports[index]];
  }
  return ports;
}

function reservationPath(directory: string, port: number): string {
  return join(directory, `${RESERVATION_PREFIX}${port}.json`);
}

function parseReservation(value: string): Reservation | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.version !== 1 || !Number.isSafeInteger(parsed.pid) ||
        typeof parsed.pid !== "number" || parsed.pid < 1 ||
        typeof parsed.runId !== "string" || !Number.isInteger(parsed.port)) return undefined;
    return parsed as unknown as Reservation;
  } catch {
    return undefined;
  }
}

async function removeReservationIfOwnerExited(path: string): Promise<void> {
  let record: Reservation | undefined;
  try {
    record = parseReservation(await readFile(path, "utf8"));
  } catch (error) {
    if (isCode(error, "ENOENT")) return;
    throw error;
  }
  // A malformed record is kept conservatively. A live PID is also kept: PID
  // reuse may delay reclamation, but cannot make us erase another live run.
  if (!record) return;
  try {
    process.kill(record.pid, 0);
  } catch (error) {
    if (isCode(error, "ESRCH")) {
      await unlink(path).catch((unlinkError) => {
        if (!isCode(unlinkError, "ENOENT")) throw unlinkError;
      });
    } else if (!isCode(error, "EPERM")) {
      throw error;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validPort(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 1024 && value <= 65535;
}

function isCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}
