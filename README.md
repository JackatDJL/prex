<img src="assets/icon.svg" width="64" height="64" alt="">

# Prex

Prex (Previews Extended) reserves local TCP ports and starts a development command with those ports in its environment.

```sh
bun add -g @jkxrx/prex
prex bun run dev
prex run --ports 2 -- ./dev-stack
```

To work on the source checkout, install its dependencies and build the CLI:

```sh
bun install --frozen-lockfile
bun run build
bun run test
```

The short form passes the program and its arguments through as-is. Use `prex run -- <program> [arguments…]` when the command name conflicts with a Prex option or reserved subcommand. `--ports` accepts 1 to 5; integrations can choose the default when it is omitted. `--profile` selects an integration profile.

Prex runs in the current directory, inherits the environment and standard streams, and returns the child's exit status. The selected ports are printed to stderr. A command or project must use the provided port environment variables for its server to listen on them.

The npm package requires Bun 1.4.4 or newer. The compiled binaries include Bun.

## Project scripts and documentation

Define scripts in `config/prex.toml` and start them with `prex <name>`. A script can reserve up to five named ports and pass them as arguments or environment variables. The repository's own `prex docs` script runs the Fumadocs development server on an assigned port. `just docs` calls the same script.

- [Project configuration](docs/site/content/docs/configuration.mdx)
- [Just recipes](docs/site/content/docs/just.mdx)

The documentation app requires Node.js 22.22 or newer. Install its dependencies with `npm --prefix docs/site ci`. Build the static site with `npm --prefix docs/site run build`. The generated home page is at `docs/site/out/index.html`.

## Sessions, Tailnet and QR

```sh
prex run -- bun run dev             # foreground
prex start -t --name web -- bun run dev
prex list --json
prex status web
prex qr web                        # terminal
prex qri web                       # path to temporary PNG
prex stop web
prex stop-all
```

Each reserved port has a local URL. With `-t` or `--tailscale`, Prex also opens a private Tailscale Serve TCP forwarder and reports the Tailnet URL. Use `--json` for structured output. See the [session guide](docs/site/content/docs/sessions.mdx) for command details.

## Agent Skill

After the docs site goes live, install the Prex Agent Skill in a project, or add `--global` to install it for your user.

```sh
npx skills add https://prex.djl.foundation --skill prex
npx skills add https://prex.djl.foundation --skill prex --global
```

See the [skill source](skills/prex/SKILL.md) and the [docs hosting guide](docs/deployment.md).

With access to the GitHub repo, use `npx skills add JackatDJL/prex --skill prex` or run `npx skills add . --skill prex` from this checkout.

## Linux packages

The **Publish Prex** GitHub Actions workflow builds `.deb`, `.rpm`, and `.pkg.tar.zst` packages from the same version as npm. It currently stores them as a GitHub Actions artifact in this private repository, so the files are available to maintainers with repository access. Public installs use npm for now. See the [Linux installation guide](docs/site/content/docs/linux.mdx).

## License

Prex is licensed under [GNU AGPL v3.0 or later](LICENSE). Copyright © 2026 Jack Ruder. [See the provenance notes](NOTICE.md) for the workflow references.
