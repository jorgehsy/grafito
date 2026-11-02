# Changes

The full notes for each version are in [Releases](https://github.com/jorgehsy/grafito/releases).

## Unreleased

- **Architect mode**: design an AWS architecture with Claude. Press the new compass button in the toolbar (next to live and demo) or open `?mode=architect`. You start on a blank board with one system zone and type in one text box at the bottom; Claude draws in the system zone and answers in a short speech bubble (Sonnet 5.5 by default; `POST /api/architect`).
  - Claude's advice follows the AWS Well-Architected Framework, and when nothing big is left open it offers a review against the six pillars, one gap per turn. The framework titles in `packages/wellarchitected/` are CC BY-SA 4.0 (see its `NOTICE.md`).
  - Claude can draw AWS groups (AWS Cloud, Region, VPC, Availability Zone, public and private subnets) as nested boxes in AWS's colours, only when they mean something. Deleting a group keeps what was inside it.
  - What you ask for is drawn in ink. What Claude adds on its own is drawn in pencil (grey and sketchy) with a question: type "yes" or "no", or click the sketch for a small ✓/✗ toolbar. When the right choice depends on you, Claude draws two alternatives side by side: answer "A" or "B", or click the one you want. Claude hears about your clicks with your next message.
  - The speech bubble points at what it talks about (a component, group or pencil proposal), or sits in the corner for a general remark. Past bubbles shrink to small markers on a timeline rail above the text box: hover one to read it, click it to reopen the bubble, click the rail to show or hide them all.
  - The session autosaves in its own slot (live and architect mode never overwrite each other) and to `sessions/`. Switching modes wipes the board without asking; coming back offers to restore it, with pending pencil proposals and the bubble rail as they were. Export, import and clear work in architect mode too, and a file reopens in the mode it was saved in.
- Session records are now version 3 and name their mode; version 2 files still open (as live sessions) and are written back as version 3.
- `pnpm --filter @grafito/server eval architect <scenarios>` runs scripted architect sessions (6 English scenarios and a Spanish one) through Claude and checks each turn by rule: one bubble, one question at most, two alternatives at most, real Well-Architected ids, and ink, pencil, bubble-only or "keep these?" where the scenario expects it. Each run is saved as a session record you can import.

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
