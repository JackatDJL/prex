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
import { join } from "node:path";
import { test } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { parseArgs } from "./cli.js";

const cli = process.env.PREX_TEST_BINARY ?? join(import.meta.dir, "cli.ts");
const executable = process.env.PREX_TEST_BINARY ? [cli] : [process.execPath, "--no-env-file", cli];
const child = (source: string) => [process.execPath, "-e", source, "--"];
const server = "Bun.listen({hostname:'127.0.0.1',port:Number(process.env.PORT),socket:{data(){}}})";

const fixture = Effect.fn(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "prex-test-" });
  const launch = ([program, ...args]: readonly string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
    Effect.scoped(Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const proc = yield* spawner.spawn(ChildProcess.make(program, args, {
        cwd: options.cwd ?? root, stdin: "ignore",
        env: { ...process.env, XDG_STATE_HOME: root, XDG_CONFIG_HOME: root, TMPDIR: root, ...options.env },
      }));
      const [code, stdout, stderr] = yield* Effect.all([
        proc.exitCode,
        proc.stdout.pipe(Stream.decodeText(), Stream.mkString),
        proc.stderr.pipe(Stream.decodeText(), Stream.mkString),
      ], { concurrency: "unbounded" });
      return { code, stdout, stderr };
    })).pipe(Effect.timeout("20 seconds"));
  const invoke = (args: string[], options?: Parameters<typeof launch>[1]) => launch([...executable, ...args], options);
  const ok = (args: string[], options?: Parameters<typeof invoke>[1]) => invoke(args, options).pipe(
    Effect.tap(({ code, stderr }) => Effect.sync(() => assert.equal(code, 0, stderr))),
    Effect.map(({ stdout }) => stdout),
  );
  return { fs, root, launch, invoke, ok };
});

function integration<A, E>(name: string, program: Effect.Effect<A, E,
  import("effect/Layer").Success<typeof BunServices.layer> | import("effect/Scope").Scope>) {
  test(name, () => Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(BunServices.layer))), 30_000);
}

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

integration("help, argv forwarding, port environment, exit status and start failures", Effect.gen(function* () {
  const { invoke, ok } = yield* fixture();
  assert.match(yield* ok(["--help"]), /Usage:/);
  const result = yield* invoke(["run", "--ports", "1", "--", ...child(
    "console.log(JSON.stringify({args:process.argv.slice(1),port:process.env.PORT,same:process.env.PORT===process.env.PREX_PORT}));process.exit(7)",
  ), "feature A", ""]);
  assert.equal(result.code, 7);
  const [, port] = result.stderr.match(/^Prex-Ports: (\d+)\nhttp:\/\/127.0.0.1:\1\n$/) ?? [];
  assert.ok(port);
  assert.deepEqual(JSON.parse(result.stdout), { args: ["feature A", ""], port, same: true });
  const missing = yield* invoke(["run", "--", "prex-command-that-does-not-exist"]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /^prex: .*prex-command-that-does-not-exist/);
}));

integration("named scripts expand roles from the project root and support zero ports", Effect.gen(function* () {
  const { fs, root, invoke } = yield* fixture();
  const cwd = join(root, "nested");
  yield* fs.makeDirectory(cwd);
  yield* fs.makeDirectory(join(root, "config"));
  const command = child("console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(1),url:process.env.SIGNALING_URL}))");
  yield* fs.writeFileString(join(root, "config", "prex.toml"), `
version = 1
[scripts.web]
ports = ["signalling", "web"]
command = ${JSON.stringify([...command, "--port", "{{port.web}}"])}
env = { SIGNALING_URL = "ws://{{host}}:{{port.signalling}}" }
[scripts.check]
command = ${JSON.stringify(child("process.exit(0)"))}
`);
  const web = yield* invoke(["web", "feature A"], { cwd });
  assert.equal(web.code, 0, web.stderr);
  const [, signalPort, webPort] = /^Prex-Ports: (\d+), (\d+)\n/.exec(web.stderr) ?? [];
  assert.ok(signalPort && webPort && signalPort !== webPort);
  assert.deepEqual(JSON.parse(web.stdout), {
    cwd: yield* fs.realPath(root), args: ["--port", webPort, "feature A"], url: `ws://127.0.0.1:${signalPort}`,
  });
  assert.deepEqual(yield* invoke(["check"], { cwd }), { code: 0, stderr: "", stdout: "" });
}));

integration("portfolio profile sets two roles and removes its runtime directory", Effect.gen(function* () {
  const { fs, invoke } = yield* fixture();
  const output = yield* invoke(["--profile", "portfolio", ...child(
    "console.log(JSON.stringify({app:process.env.PREX_PORT_APP,vite:process.env.PREX_PORT_VITE,dir:process.env.HOMEPAGE_PREVIEW_ENV_DIR,exists:require('node:fs').existsSync(process.env.HOMEPAGE_PREVIEW_ENV_DIR)}))",
  )]);
  assert.equal(output.code, 0, output.stderr);
  const { app, vite, dir, exists } = JSON.parse(output.stdout);
  assert.ok(app && vite && app !== vite && exists);
  assert.equal(yield* fs.exists(dir), false);
  const invalid = yield* invoke(["--ports", "1", "--profile", "portfolio", ...child("")]);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /genau 2 Ports/);
}));

integration("start, list, status, QR, stop and stop-all operate on live sessions", Effect.gen(function* () {
  const { fs, root, invoke, ok } = yield* fixture();
  yield* Effect.addFinalizer(() => invoke(["stop-all", "--json"]).pipe(Effect.ignore));
  const first = JSON.parse(yield* ok(["start", "--name", "web", "--json", "--", ...child(server)]));
  const second = JSON.parse(yield* ok(["start", "--name", "signalling", "--json", "--", ...child(server)]));
  assert.notEqual(first.urls[0].port, second.urls[0].port);
  assert.equal(JSON.parse(yield* ok(["status", "web", "--json"])).id, first.id);
  assert.equal(JSON.parse(yield* ok(["list", "--json"])).length, 2);
  const { url, qr } = JSON.parse(yield* ok(["qr", "web", "--json"]));
  assert.equal(url, first.urls[0].local);
  assert.match(qr, /[▄▀█]/);
  const { image } = JSON.parse(yield* ok(["qri", "web", "--json"]));
  assert.deepEqual(Array.from((yield* fs.readFile(image)).subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(JSON.parse(yield* ok(["stop", "web", "--json"])).id, first.id);
  assert.deepEqual(JSON.parse(yield* ok(["stop-all", "--json"])).map(({ id }: {id: string}) => id), [second.id]);
  assert.deepEqual(JSON.parse(yield* ok(["list", "--json"])), []);
  assert.deepEqual(yield* fs.readDirectory(join(root, "prex", "ports")), []);
}));

integration("foreground JSON and Tailscale cleanup preserve the CLI contract", Effect.gen(function* () {
  const { fs, root, invoke } = yield* fixture();
  yield* fs.writeFileString(join(root, "tailscale"), `#!/bin/sh
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
  const result = yield* invoke(["run", "--json", "-t", "--", ...child("console.log('child output')")],
    { env: { PATH: root + ":" + process.env.PATH } });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "child output\n");
  const [url] = JSON.parse(result.stdout).urls;
  assert.equal(url.tailscale, `http://prex.example.ts.net:${url.port}`);
  assert.equal(yield* fs.readFileString(join(root, "serve-closed")), "closed\n");
}));

integration("custom port range reclaims stale reservations and releases on failure", Effect.gen(function* () {
  const { fs, root, invoke } = yield* fixture();
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = probe.port;
  const directory = join(root, "prex");
  yield* Effect.ensuring(Effect.gen(function* () {
    yield* fs.makeDirectory(join(directory, "ports"), { recursive: true });
    yield* fs.writeFileString(join(directory, "config.json"), JSON.stringify({ version: 1, ports: { min: port, max: port } }));
    const blocked = yield* invoke(["--", ...child("")]);
    assert.equal(blocked.code, 1);
    assert.match(blocked.stderr, /Unable to reserve/);
  }), Effect.sync(() => probe.stop()));
  const record = join(directory, "ports", `port-${port}.json`);
  yield* fs.writeFileString(record, JSON.stringify({ version: 1, pid: 2147483647, port, runId: "stale" }));
  const failed = yield* invoke(["--", "prex-command-that-does-not-exist"]);
  assert.match(failed.stderr, /prex-command-that-does-not-exist/);
  assert.equal(yield* fs.exists(record), false);
  const reused = yield* invoke(["--json", "--", ...child("process.exit(0)")]);
  assert.equal(reused.code, 0, reused.stderr);
  assert.equal(JSON.parse(reused.stdout).urls[0].port, port);
}));

integration("QR accepts a direct URL and upgrade validates arguments and installation", Effect.gen(function* () {
  const { ok, invoke } = yield* fixture();
  assert.equal(JSON.parse(yield* ok(["QR", "https://example.com", "--json"])).url, "https://example.com/");
  const invalid = yield* invoke(["upgrade", "--invalid"]);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /Usage: prex upgrade/);
  const unmanaged = yield* invoke(["upgrade", "--nightly"]);
  assert.equal(unmanaged.code, 1);
  assert.match(unmanaged.stderr, /Use the package manager/);
}));

integration("SIGTERM exits with 143 and frees the foreground port lease", Effect.gen(function* () {
  const { fs, root } = yield* fixture();
  const proc = yield* Effect.acquireRelease(
    Effect.sync(() => Bun.spawn([...executable, "run", "--json", "--", ...child(server)], {
      cwd: root, stdout: "pipe", stderr: "inherit", stdin: "ignore",
      env: { ...process.env, XDG_CONFIG_HOME: root, XDG_STATE_HOME: root },
    })),
    (proc) => Effect.promise(async () => {
      proc.kill("SIGTERM");
      await proc.exited;
    }),
  );
  const reader = proc.stdout.getReader();
  const output = yield* Effect.promise(() => reader.read()).pipe(Effect.timeout("10 seconds"));
  assert.ok(output.value);
  assert.equal(JSON.parse(new TextDecoder().decode(output.value)).urls.length, 1);
  proc.kill("SIGTERM");
  assert.equal(yield* Effect.promise(() => proc.exited).pipe(Effect.timeout("10 seconds")), 143);
  assert.deepEqual(yield* fs.readDirectory(join(root, "prex", "ports")), []);
}));

integration("failed background startup leaves no published session or port lease", Effect.gen(function* () {
  const { fs, root, invoke, ok } = yield* fixture();
  const result = yield* invoke(["start", "--name", "failed", "--json", "--", ...child("process.exit(9)")]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /vorzeitig beendet \(9\).*Log:/);
  assert.deepEqual(JSON.parse(yield* ok(["list", "--json"])), []);
  assert.deepEqual(yield* fs.readDirectory(join(root, "prex", "ports")), []);
}));

integration("managed upgrade downloads the installer and streams it to bash with the selected channel", Effect.gen(function* () {
  const { fs, root, launch } = yield* fixture();
  yield* fs.writeFileString(join(root, "channel"), "nightly\n");
  // Run the real upgrade Effect and bash in an isolated Bun process. Supply
  // the installation identity and HTTP response without touching the network.
  const script = `
    import assert from "node:assert/strict";
    import { Effect } from ${JSON.stringify(import.meta.resolve("effect"))};
    import { BunServices } from ${JSON.stringify(import.meta.resolve("@effect/platform-bun"))};
    import { HttpClient, HttpClientResponse } from ${JSON.stringify(import.meta.resolve("effect/http"))};
    globalThis.PREX_COMPILED = true;
    process.execPath = process.env.PREX_INSTALL + "/bin/prex";
    const { upgrade } = await import(${JSON.stringify(new URL("./upgrade.ts", import.meta.url).href)});
    const client = HttpClient.make((request) => {
      assert.equal(request.url, "https://prex.djl.foundation/install");
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(
        'printf "%s %s\\\\n" "$1" "$PREX_INSTALL"; exit 12'
      )));
    });
    process.exitCode = await Effect.runPromise(upgrade(process.argv.slice(1)).pipe(
      Effect.provideService(HttpClient.HttpClient, client),
      Effect.provide(BunServices.layer),
    ));
  `;
  const options = { env: { PREX_INSTALL: root } };
  const defaultChannel = yield* launch(child(script), options);
  assert.deepEqual(defaultChannel, { code: 12, stdout: `--nightly ${root}\n`, stderr: "" });
  const stable = yield* launch([...child(script), "--stable"], options);
  assert.deepEqual(stable, { code: 12, stdout: `--stable ${root}\n`, stderr: "" });
}));

integration("executable shell scripts preserve arguments and only inherit caller environment", Effect.gen(function* () {
  const { fs, root, ok } = yield* fixture();
  yield* fs.writeFileString(join(root, ".env"), "PREX_DOTENV_TEST=local\n");
  yield* fs.writeFileString(join(root, "plain"), 'printf "%s|%s|%s|%s\\n" "$0" "${PREX_DOTENV_TEST-unset}" "$1" "$2"\n', { mode: 0o700 });
  assert.equal(yield* ok(["--", "./plain", "feature A", ""]), "./plain|unset|feature A|\n");
  assert.equal(yield* ok(["--", "plain", "feature A", ""], { env: { PATH: root + ":" + process.env.PATH } }), `${join(root, "plain")}|unset|feature A|\n`);
}));
