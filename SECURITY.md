# Security

Grafito is a personal tool meant to run on your own machine. The server has no authentication.

## The Anthropic API key

- The key lives only in `apps/server/.env` as `ANTHROPIC_API_KEY` (copy `apps/server/.env.example`). `.env` files are git-ignored; never commit one.
- `apps/server/src/index.ts` loads that file with `dotenv` and lets it override a key already set in the shell.
- Only the server reads the key: `apps/server/src/board.ts` passes it to the Anthropic client for `POST /api/board`. It is never sent to the browser. The browser only learns whether a usable key exists (`GET /api/health` returns `hasKey: true|false`), and nothing under `apps/web` or `packages/*` reads it.
- Every request to Claude is billed to that key. Each request's cost is shown in the live panel and stored in the session record.

## Running the server

- The server listens on port 8787 on all network interfaces, with no authentication. Anyone who can reach that port can spend your API key and read your saved sessions. Run it only on a trusted network, or behind a firewall.
- Saved sessions are written as JSON under `apps/server/sessions/` (git-ignored). The sessions endpoints accept only safe file names and never read or write outside that folder; a record is capped at 8 MB.
- Session records contain everything you said (the transcript) and everything Claude drew. Treat exported records as private.

## Reporting a vulnerability

Please don't open a public issue with the details. Use GitHub's private vulnerability reporting for this repository (the **Security** tab → **Report a vulnerability**). If that isn't available, open an issue that only asks the repository owner to contact you, without the details.
