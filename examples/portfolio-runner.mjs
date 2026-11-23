import { spawn } from "node:child_process";

const host = process.env.HOMEPAGE_PREVIEW_HOST ?? "127.0.0.1";
const appPort = process.env.SERVER_PORT;
const vitePort = process.env.HOMEPAGE_PREVIEW_VITE_PORT;
const envDir = process.env.HOMEPAGE_PREVIEW_ENV_DIR;
const hotFile = process.env.HOMEPAGE_PREVIEW_HOT_FILE;

if (!appPort || !vitePort || !envDir || !hotFile) {
  throw new Error("Das Portfolio-Profil muss beide Ports, envDir und Hot-Datei setzen.");
}

const vite = spawn("bun", [
  "run", "--no-env-file", "vite", "--host", host, "--port", vitePort,
  "--strictPort",
], { stdio: "inherit", env: process.env });
let app;
let stopping = false;
let spawnError;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  app?.kill("SIGTERM");
  vite.kill("SIGTERM");
  process.exitCode = code;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stop(0));
}
vite.once("exit", (code) => {
  if (!stopping) stop(code ?? 1);
});
vite.once("error", (error) => {
  spawnError = error;
  console.error(error);
  stop(1);
});

async function waitFor(url, child, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error(`${label} wurde vor der Bereitschaft beendet.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(750) });
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} wurde innerhalb von 30 Sekunden nicht bereit: ${url}`);
}

try {
  await waitFor(`http://${host}:${vitePort}/@vite/client`, vite, "Vite");
  app = spawn("php", ["artisan", "serve", "--host", host, "--port", appPort], {
    stdio: "inherit",
    env: process.env,
  });
  app.once("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
  app.once("error", (error) => {
    spawnError = error;
    console.error(error);
    stop(1);
  });
  await waitFor(`http://${host}:${appPort}/up`, app, "Laravel");
  await new Promise((resolve) => {
    app.once("exit", resolve);
    vite.once("exit", resolve);
  });
} catch (error) {
  console.error(error);
  stop(1);
}
