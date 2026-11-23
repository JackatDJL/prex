---
name: prex
description: Use when the user asks for a preview, a preview URL, or to start, inspect, share, or stop a local development server. Prex assigns free ports and manages named previews.
---

# Prex

1. Work from the target project and read its local preview instructions and `config/prex.toml`, if present. Prefer the project's named script or existing integration. Use `prex`, or use `npx --yes --package @jackatdjl/prex prex` when the CLI is absent.
2. For a preview that should stay up, use `prex start --json <script>`. For an existing start command, use `prex start --name <name> --json -- <program> [args...]`. Prex sets `PORT` for compatible servers. Use a named script with port placeholders for servers that require a flag or a different environment variable. For an attached process use `prex run -- <program> [args...]`.
3. Report the returned URL and session ID. A background start checks TCP on loopback. If the task needs an application-ready preview, also check the main page or the project's health endpoint.
4. Use `--tailscale` only when the user wants Tailnet access. Report the returned Tailnet URL. For a QR, use `prex qr <id>`, or `prex qri <id> --json` and embed the PNG from the `image` field if the client supports local attachments.
5. Inspect with `prex list --json` or `prex status <id> --json`. Stop temporary previews you created with `prex stop <id>` when finished. Keep previews that the user asked to use running. Use the session ID to avoid stopping another preview with a similar name.

See [Prex docs](https://prex.djl.foundation/docs/) for project configuration, Just, and multi-port examples.
