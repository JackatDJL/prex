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

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseArgs } from "./cli.js";

test("short form preserves child arguments exactly", () => {
  const options = parseArgs(["bun", "run", "dev", "", "--label", "feature A"]);
  assert.deepEqual(options, {
    help: false,
    command: ["bun", "run", "dev", "", "--label", "feature A"],
  });
});

test("run form parses profile and port count before the separator", () => {
  const options = parseArgs(["run", "--ports", "2", "--profile", "portfolio", "--", "composer", "dev", "--turbo"]);
  assert.deepEqual(options, {
    help: false,
    count: 2,
    profile: "portfolio",
    command: ["composer", "dev", "--turbo"],
  });
});

test("short form accepts options before the program", () => {
  const options = parseArgs(["--profile", "vite", "--ports", "1", "node", "server.js"]);
  assert.deepEqual(options, {
    help: false,
    count: 1,
    profile: "vite",
    command: ["node", "server.js"],
  });
});

test("invalid counts and a missing run separator are rejected", () => {
  assert.throws(() => parseArgs(["run", "--ports", "0", "--", "dev"]), /1 bis 5/);
  assert.throws(() => parseArgs(["run", "dev"]), /nach '--'/);
});

test("the CLI forwards exact child arguments, port environment, and exit status", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "prex-cli-test-"));
  const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
  const childCode = "console.log(JSON.stringify({ args: process.argv.slice(1), port: process.env.PREX_PORT, same: process.env.PORT === process.env.PREX_PORT })); process.exit(7)";

  try {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const cli = spawn(process.execPath, [
        cliPath,
        "run", "--ports", "1", "--", process.execPath, "-e", childCode, "feature A", "",
      ], {
        env: { ...process.env, XDG_STATE_HOME: stateHome },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      cli.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
      cli.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
      cli.once("error", reject);
      cli.once("close", (code) => resolve({ code, stdout, stderr }));
    });

    assert.equal(result.code, 7);
    assert.deepEqual(JSON.parse(result.stdout), {
      args: ["feature A", ""],
      port: result.stderr.match(/Prex-Ports: (\d+)/)?.[1],
      same: true,
    });
    assert.match(result.stderr, /^Prex-Ports: (\d+)\nhttp:\/\/127\.0\.0\.1:\1\n$/);
  } finally {
    await rm(stateHome, { recursive: true, force: true });
  }
});

test("a child start error is reported and exits unsuccessfully", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "prex-cli-error-test-"));
  const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
  try {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      const cli = spawn(process.execPath, [cliPath, "run", "--", "prex-command-that-does-not-exist"], {
        env: { ...process.env, XDG_STATE_HOME: stateHome },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      cli.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
      cli.once("error", reject);
      cli.once("close", (code) => resolve({ code, stderr }));
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^prex: spawn prex-command-that-does-not-exist ENOENT\n$/);
  } finally {
    await rm(stateHome, { recursive: true, force: true });
  }
});

test("named scripts use the project root and pass named ports through flags and URLs", async () => {
  const root = await mkdtemp(join(tmpdir(), "prex-project-test-"));
  const subfolder = join(root, "nested");
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  const code = "console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(1),url:process.env.SIGNALING_URL}))";
  try {
    await mkdir(join(root, "config"));
    await mkdir(subfolder);
    await writeFile(join(root, "config", "prex.toml"), `
version = 1
[scripts.web]
ports = ["signalling", "web"]
command = [${JSON.stringify(process.execPath)}, "-e", ${JSON.stringify(code)}, "--", "--port", "{{port.web}}"]
env = { SIGNALING_URL = "ws://{{host}}:{{port.signalling}}" }
[scripts.check]
command = [${JSON.stringify(process.execPath)}, "-e", "process.exit(0)"]
`);
    const options = {
      cwd: subfolder,
      encoding: "utf8" as const,
      env: { ...process.env, XDG_STATE_HOME: root, XDG_CONFIG_HOME: join(root, "global") },
    };
    const web = spawnSync(process.execPath, [cli, "web", "feature A"], options);
    assert.equal(web.status, 0, web.stderr);
    const [, signalPort, webPort] = /^Prex-Ports: (\d+), (\d+)\n/.exec(web.stderr) ?? [];
    assert.ok(signalPort && webPort && signalPort !== webPort);
    assert.deepEqual(JSON.parse(web.stdout), {
      cwd: await realpath(root), args: ["--port", webPort, "feature A"], url: `ws://127.0.0.1:${signalPort}`,
    });
    const check = spawnSync(process.execPath, [cli, "check"], options);
    assert.equal(check.status, 0, check.stderr);
    assert.equal(check.stderr, "");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("background previews expose URLs, produce QR codes, and stop by name or in bulk", async () => {
  const root = await mkdtemp(join(tmpdir(), "prex-sessions-"));
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  const server = "require('node:net').createServer().listen(Number(process.env.PORT), '127.0.0.1')";
  const invoke = (...args: string[]) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: "utf8", timeout: 40_000,
      env: { ...process.env, XDG_STATE_HOME: root, XDG_CONFIG_HOME: root, TMPDIR: root },
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return result.stdout;
  };
  try {
    const first = JSON.parse(invoke("start", "--name", "web", "--json", "--", process.execPath, "-e", server));
    const second = JSON.parse(invoke("start", "--name", "signalling", "--json", "--", process.execPath, "-e", server));
    assert.notEqual(first.urls[0].port, second.urls[0].port);
    assert.equal(JSON.parse(invoke("status", "web", "--json")).id, first.id);
    assert.equal(JSON.parse(invoke("list", "--json")).length, 2);
    const { url, qr } = JSON.parse(invoke("qr", "web", "--json"));
    assert.equal(url, first.urls[0].local);
    assert.match(qr, /[▄▀█]/);
    const { image } = JSON.parse(invoke("qri", "web", "--json"));
    assert.deepEqual((await readFile(image)).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(JSON.parse(invoke("stop", "web", "--json")).id, first.id);
    assert.deepEqual(JSON.parse(invoke("stop-all", "--json")).map((session: { id: string }) => session.id), [second.id]);
    assert.deepEqual(JSON.parse(invoke("list", "--json")), []);
  } finally {
    invoke("stop-all", "--json");
    await rm(root, { recursive: true, force: true });
  }
});

test("foreground JSON stays separate from child output and cleans up Tailscale Serve", async () => {
  const root = await mkdtemp(join(tmpdir(), "prex-tail-test-"));
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url));
  try {
    await writeFile(join(root, "tailscale"), `#!/bin/sh
case "$1:$2" in
  status:--json) echo '{"BackendState":"Running","Self":{"DNSName":"prex.example.ts.net."}}';;
  serve:status) echo '{}';;
  serve:--tcp=*)
    test "$3" = "tcp://127.0.0.1:\${2#--tcp=}" || exit 9
    trap 'echo closed > "$XDG_STATE_HOME/serve-closed"; exit 0' TERM
    echo 'Press Ctrl+C to exit.'
    while :; do sleep .1; done;;
  *) exit 9;;
esac
`, { mode: 0o700 });
    const result = spawnSync(process.execPath, [cli, "run", "--json", "-t", "--", process.execPath, "-e", "console.log('child output')"], {
      cwd: root, encoding: "utf8", timeout: 30_000,
      env: { ...process.env, PATH: root + ":" + process.env.PATH, XDG_STATE_HOME: root, XDG_CONFIG_HOME: root },
    });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    assert.equal(result.stderr, "child output\n");
    const [url] = JSON.parse(result.stdout).urls;
    assert.equal(url.tailscale, `http://prex.example.ts.net:${url.port}`);
    assert.equal(await readFile(join(root, "serve-closed"), "utf8"), "closed\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
