# Changes

The full notes for each version are in [Releases](https://github.com/jorgehsy/grafito/releases).

## Unreleased

## v0.2.0-alpha.6 · 2026-10-31

- Mute button: while the mic is on, a button next to the subtitles (or the M key) lets you keep talking without Grafito drawing. Muting first closes the turn, so what you said before still gets drawn.
- Use your Claude subscription (local only): "plan" models (Sonnet 5.5 and Haiku 5.5) in Options → Model, off by default. Turn on with `GRAFITO_SUBSCRIPTION=1` and a `claude` login or `CLAUDE_CODE_OAUTH_TOKEN`. They show "included in plan" instead of dollars.
- Models now carry a provider (see `docs/adr/0004-model-providers.md`).
- The eval takes `--model <id>` and runs the board handler in-process, so it no longer needs a running server.

## v0.2.0-alpha.5 · 2026-10-31

- The first version (Excalidraw mind map, `/api/draw`) is removed.
- The repository is a pnpm + Turborepo monorepo (`apps/*`, `packages/*`).
- The codebase is in English.
- One language setting drives the UI, the speech recognition and the language Claude writes the board in.
- Saved sessions moved from `pruebas/` to `apps/server/sessions/`.
- Demos have English ids, the `architecture` demo is in English, and the URL is `?mode=demo&demo=<id>`.
- The prompt to Claude is in English and ends with the language to draw in (prompt version 2).
- New commands: `pnpm --filter @grafito/server eval instruction ...`, `eval baseline ...` and `eval convert-v1 ...` (turns old session records into version 2 for the eval).
- Server error messages are in English.
- **Breaking:** saved sessions from 0.2.0-alpha.4 and earlier no longer load. Session records are now version 2, with clearer field names (`batch`, `warnings`, `speechLang`) and the prompt version of each request.

## v0.2.0-alpha.4 · 2026-10-27

- AWS icons: turn them on in Options → Icons, and Claude puts the official icon (Lambda, S3, Cognito... 40 services) next to boxes that are AWS services.
- The icons belong to AWS and are not under the MIT license (see `packages/icons/src/aws/NOTICE.md`).
- Options panel in cards: Model, Language and View.

## v0.2.0-alpha.3 · 2026-10-26

- Long arrow labels (more than 22 characters) split into two lines, and the reserved space matches what is drawn.

## v0.2.0-alpha.2 · 2026-10-23

- A box to type to Claude if you have no microphone: Enter or Send submits the text.
- Arrow labels no longer sit on top of blocks.
- Very wide diagrams are drawn top to bottom to use the screen better.
- The `ANTHROPIC_API_KEY` in `.env` takes priority over the one in the shell.
- Work happens on `main` (the `alpha-grafitodesign` branch is retired).

## v0.2.0-alpha.1 · 2026-10-23

First public alpha.

- New paper-style design as the official version.
- Live voice in Spanish: you talk and Claude draws the board.
- Commands with "Grafito, ..." and Undo instruction.
- Drawing shapes: Auto, Map, Flow, Scale, Cycle, Timeline, Tree, System, List and Compare.
- Saved sessions, Restore, Import and Export (JSON and SVG).
- Microphone lock between tabs.
