# Changes

The full notes for each version are in [Releases](https://github.com/jorgehsy/grafito/releases).

## Unreleased

## v0.2.0-alpha.9 · 2026-11-11

- **A new interface.** The controls are now dark graphite instruments on the paper; what comes and goes (options, notices, dialogs) is a white slip; handwriting is only Claude's voice and the board.
  - The three modes are tabs by the logo, and the one you are in shows its name. The microphone moved next to the text box: talk or type in the same place.
  - The stats panel is a drawer on the right and the board moves over for it instead of being covered. It shows in live mode only. The captions stay hidden until something is said.
  - One motion system (three speeds, two curves) for every control, and `prefers-reduced-motion` turns it all off. The logo draws itself on load, and again for as long as Claude is drawing.
  - The styles share one set of tokens (`apps/web/src/ui/tokens.css`). Every panel reserves its room through the `--free-*` variables on `.v2`, and the board's `<svg>` follows, so the camera always frames the paper you can see.
  - Switching modes now also clears your ink and stops a live request still in flight, so neither lands on the other mode's board.
- **Share a room over the internet.** `pnpm share` builds the front, opens a Cloudflare quick tunnel (needs `cloudflared`; it tells you how to install it) and serves everything on one port. Every room now has an invite token: the link is `?room=<id>#k=<token>` and the id alone opens nothing, on your own network too, so links to rooms made before this no longer work. While sharing, guests can only load the page and join a room they were sent; live mode, architect mode, saved sessions and opening rooms need the owner link the terminal prints. Rooms have limits (people, message rate and size, Claude requests per minute, and a cap of 300 requests and 5 USD per room by default), each with a `GRAFITO_*` variable, and the room tells you when one is hit. See `docs/adr/0009-rooms-over-a-tunnel.md`.
- Rooms: the server now says who each participant is (a browser can no longer join under someone else's id), and nobody can be named Claude. Each tab is its own participant and keeps it across a reload. A rename is remembered after a reload. An export from a room now includes the board the room was started from, and can be made before Claude draws anything. A sketch the room refuses (cap reached, Claude busy) stops "reading" at once instead of after two minutes. Erased ink no longer stays in the room's log.
- The mode tabs are never locked. While a demo plays, another mode stops it. In a room, another mode leaves the room (Back returns to it), and the room bar has a Leave button beside Share. Dragging the board no longer shakes your cursor on other people's screens.
- **Architect mode: draw, data models and a real review.** Architect prompt version 6.
  - The draw dock works in architect mode: sketch boxes, arrows, a box around components or a cross over one, and the sketch goes to the architect as a turn (the picture and the strokes). What you draw counts as asked for, so it comes back in ink; a "?" by something asks about it.
  - Ask for the tables and the architect draws a data model (entities, fields, relations) in a second zone under the architecture. It only draws one when asked; otherwise it offers it.
  - **Well-Architected review panel** (the "Review" button, top right). "Review this design" makes the architect assess all six pillars (covered, partial or gap, with why) and list the risks as findings: severity, pillar, the item on the board and the best-practice ID. Click a finding, or its numbered pin on the diagram, to point at the item; "Ask Claude to fix it" sends that as a turn. Findings close as the design changes. The review is saved with the session (as ops) and comes back on restore; older architect sessions still open.

- **Hi-fi export.** Export now also saves `<id>.hifi.svg` and `<id>.hifi.png` (2x): the same board, in the same positions, drawn as a clean diagram for a design document or a slide. Straight connectors with real arrowheads, crisp boxes, a system sans font, AWS icons in full colour, a title block (from the summary), the date and a legend only when it says something. Every drawing shape is covered. In architect mode, what you accepted is drawn as final and open proposals are grey and dashed, with a legend entry. The SVG is standalone: no web font, no outside files.
- **Draw with Claude.** A dock at the top of the board has a pen, an eraser and four inks. Sketch a box, an arrow, a loop around something, a scribble over it or a question mark, and Grafito reads the drawing and redraws it clean: new elements, arrows, highlights, deletions. With "auto" on it reads about two seconds after your last stroke; otherwise press ✨ or Enter. Ink it cannot make sense of stays as ink. Hold Space (or use the middle button) to pan while drawing. See `docs/adr/0007-sketch-beside-the-board.md`.
- **Rooms: one board, several people.** "Collaborate" opens a room from the board on screen and gives you a link (`?room=<id>`). Everyone who opens it talks, types and draws on the same board, with live cursors, each person's ink in their colour and an activity feed. Claude is one more participant: it shows what it is doing (thinking, drawing), draws what anyone says, and answers a direct question in the feed. The server keeps the room and makes the Claude calls (`/api/rooms`, WebSocket); rooms are saved to `apps/server/rooms/`. Set `GRAFITO_HOST=1` to let other machines on your network reach the dev server. No undo or import inside a room. See `docs/adr/0008-rooms-server-keeps-the-log.md`.
- **Data models.** A new drawing shape, Data: entities drawn as tables with their fields (primary and foreign keys marked) and relations with crow's-foot ends (one to one, one to many, many to many). Say "a user has many orders" and it is drawn as a data model. New demo: `?mode=demo&demo=data-model`.
- Prompt version 4 (the `data` zone kind and its tools). A request can now be a `sketch`.
- The empty board in live mode shows the three ways in: talk, type or draw.
- **A real player for demos.** Demo mode's controls moved from the header to a transport bar at the bottom:
  - A timeline with one segment per chapter. Click or drag it to go to any moment, forwards or backwards; the board is rebuilt for that moment at once, with no animation, and playback goes on from there.
  - Previous and next chapter, elapsed and total time, the current chapter's title, and speed (0.5x to 2x).
  - Keys: Space plays and pauses, ← and → jump between chapters. With the timeline focused, the arrows move 5 seconds.
  - The demo list shows each demo's name, one line about it, its length and its chapters. The empty board shows the chosen demo and a Play button.
- **Replay a saved session.** "Open a session" in demo mode (or dropping the `.json` on the bar) plays an exported session like a demo, with no Claude calls: each request is a chapter, its text is the subtitle and its ops are drawn in order. Live and architect records both work; undone instructions are left out, and an architect replay does not show Claude's speech bubbles.
- New demo with hand drawing: `?mode=demo&demo=sketch`. Strokes appear as if drawn with the pen, pulse while they are read, and give way to the clean diagram.
- `?auto=1` now plays the demo named by `?demo=` (it used to play the first one).
- For contributors: `pnpm e2e` drives the app in a browser with Playwright (modes, ink, a room with two people) and never calls Claude; CI runs it. Lint warnings are capped at their current count in every package. `CODING_STANDARDS.md` lists what reviewers check by hand.

## v0.2.0-alpha.8 · 2026-11-02

- Flow and system diagrams pick left-to-right or top-to-bottom from what they mean, no longer from their width: Claude says which when it creates the zone (a sequence runs across, layers and peers stack so peers share a row), and without it a long chain runs across and a fan of peers runs down. Prompt version 3.

## v0.2.0-alpha.7 · 2026-11-02

- **Architect mode**: design an AWS architecture with Claude. Press the new compass button in the toolbar (next to live and demo) or open `?mode=architect`. You start on a blank board with one system zone and type in one text box at the bottom; Claude draws in the system zone and answers in a short speech bubble (Sonnet 5.5 by default; `POST /api/architect`).
  - Claude's advice follows the AWS Well-Architected Framework, and when nothing big is left open it offers a review against the six pillars, one gap per turn. The framework titles in `packages/wellarchitected/` are CC BY-SA 4.0 (see its `NOTICE.md`).
  - Claude can draw AWS groups (AWS Cloud, Region, VPC, Availability Zone, public and private subnets) as nested boxes in AWS's colours, only when they mean something. Deleting a group keeps what was inside it.
  - What you ask for is drawn in ink. What Claude adds on its own is drawn in pencil (grey and sketchy) with a question: type "yes" or "no", or click the sketch for a small ✓/✗ toolbar. When the right choice depends on you, Claude draws two alternatives side by side: answer "A" or "B", or click the one you want. Claude hears about your clicks with your next message.
  - An arrow from something you asked for to a pencil proposal is drawn in pencil with that proposal: rejecting the proposal erases the arrow too, and accepting it inks the arrow.
  - The speech bubble points at what it talks about (a component, group or pencil proposal), or sits in the corner for a general remark. Past bubbles shrink to small markers on a timeline rail above the text box: hover one to read it, click it to reopen the bubble, click the rail to show or hide them all.
  - The session autosaves in its own slot (live and architect mode never overwrite each other) and to `sessions/`. Switching modes wipes the board without asking; coming back offers to restore it, with pending pencil proposals and the bubble rail as they were. Export, import and clear work in architect mode too, and a file reopens in the mode it was saved in.
- Session records are now version 3 and name their mode; version 2 files still open (as live sessions) and are written back as version 3.
- `pnpm --filter @grafito/server eval architect <scenarios>` runs scripted architect sessions (6 English scenarios and a Spanish one) through Claude and checks each turn by rule: one bubble, one question at most, two alternatives at most, real Well-Architected ids, and ink, pencil, bubble-only or "keep these?" where the scenario expects it. Each run is saved as a session record you can import.
  - Each scenario runs 3 times by default (`--runs N`), and a step passes when it passes in most of its runs; the table ends with each step's pass rate. The ink check accepts Claude's own pencil additions beside what you asked for, and a scenario can start from a scripted board (`start`).
- A plan model asked for while `GRAFITO_SUBSCRIPTION` is off now fails with "Plan models are off" instead of running on a paid API model (ADR 0004).

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
