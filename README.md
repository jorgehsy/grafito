<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo-light.svg" alt="grafito" width="420">
  </picture>
</p>

<p align="center">
  <strong>You talk. Claude draws the board live, stroke by stroke.</strong><br>
  <sub>Status: <b>alpha</b> · Voice in Spanish and English · Built with Claude, React and rough.js</sub>
</p>

<p align="center">
  <a href="https://github.com/jorgehsy/grafito/releases"><img src="https://img.shields.io/github/v/release/jorgehsy/grafito?include_prereleases&label=version" alt="Version"></a>
  <a href="https://github.com/jorgehsy/grafito/actions/workflows/ci.yml"><img src="https://github.com/jorgehsy/grafito/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/jorgehsy/grafito" alt="MIT license"></a>
</p>

---

**grafito** turns what you say out loud into a hand-drawn board. You explain an architecture, a process or an idea, and while you talk, zones, boxes, arrows, timelines, trees and notes appear, as if someone were drawing them on a whiteboard next to you.

> **Alpha.** It works, but it changes often and can break. Use it to try things out and tell us what you think.

## What it does

- **Live voice.** You talk and the board draws itself while you speak.
- **Hand-drawn style.** Animated strokes with rough.js, a highlighter and a camera that follows what is new.
- **Drawing shapes.** Auto, Map, Flow, Scale, Cycle, Timeline, Tree, System, Data, List or Compare.
- **Draw too.** Pick the pencil and sketch on the board: Grafito reads your boxes, arrows and scribbles and redraws them clean.
- **Rooms.** Press Collaborate, share the link, and several people talk, type and draw on one board, with Claude as one more participant.
- **Data models.** Entities as tables with fields and keys, relations with crow's-foot ends.
- **Voice commands.** Say *"Grafito, ..."* to ask for changes: *"Grafito, split this into two diagrams"*.
- **Saves itself.** Each session is saved to `apps/server/sessions/`. You can restore, import and export.
- **Hi-fi export.** Export also saves a clean version of the diagram (SVG and PNG), ready for a design document or a slide.
- **Visible cost.** Shows the tokens and the dollar cost of each request.
- **AWS icons.** Turn on the catalog in Options → Icons and Claude puts the official icon (Lambda, S3, Cognito... 40 services) next to boxes that are AWS services.
- **Architect mode.** Design an AWS architecture with Claude: you type or sketch, it draws, asks and pushes back, following the AWS Well-Architected Framework. It can add the data model and review the design pillar by pillar.
- **Script mode.** Demos that need no Claude and cost nothing, to see how it works: a player with chapters and a timeline you can drag. It also plays back any session you exported.

## Language

One language setting in the app drives the interface, the speech recognition and `<html lang>`. It defaults to your browser language. Change it in Options → Language.

Claude writes the board in the language of that setting.

## What you need

| Thing | Detail |
| --- | --- |
| Node.js | 20.19 or newer (22+ recommended) |
| pnpm | Picked up from `package.json` by `corepack enable` |
| Browser | **Chrome** (or Safari). Firefox has no speech recognition. |
| Anthropic key | An API key from [console.anthropic.com](https://console.anthropic.com/). Usage is billed to your account. |
| Microphone | For voice mode. Without one you can type or paste text. |

## Install

You can download the latest version from [Releases](https://github.com/jorgehsy/grafito/releases) (file `grafito-vX.Y.Z-source.tar.gz`) or clone the repository:

```bash
git clone https://github.com/jorgehsy/grafito.git
cd grafito
corepack enable && pnpm install
cp apps/server/.env.example apps/server/.env
```

Open `apps/server/.env` and paste your key:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Only the local server reads the key. It never reaches the browser.

## Use

1. Start everything with one command:

   ```bash
   pnpm dev
   ```

   This starts two things: the server (port `8787`) and the web app (port `5173`).

2. Open **http://localhost:5173/?mode=live** in Chrome.
3. Press **Talk** (the microphone next to the text box, or the space bar) and allow the microphone.
4. Talk. The board draws itself.

The three modes are tabs next to the logo: **Live**, **Script** and **Architect**. You can change mode at any time; the board and your ink start clean in the new one.

### Other ways to use it

- **No microphone:** type or paste text in the box and press Enter or **Send**.
- **Give commands:** say or type *"Grafito"* and then the command. What came before is drawn; what comes after is taken as an instruction. If you do not like the result, use **Undo instruction**.
- **Pick the shape:** in **Options** you choose the drawing shape, the model (Sonnet by default, Haiku is cheaper) and the language (es-CL, es-AR, es-MX, es-ES, en-US).
- **See costs:** press **F3** or the stats button.
- **Draw:** the dock at the top of the board has Move (V), Pen (P), Eraser (E) and four inks. Sketch a box, an arrow, a loop around something or a scribble over it. A moment after you stop, Claude reads the sketch and redraws it clean. Turn **auto** off to decide when: then press the spark button (or Enter). Each read is a request to Claude.
- **Work with others:** press **Collaborate** and send the link. Everyone in the room talks, types and draws on the same board, with live cursors. To invite someone outside your network, see [Share a room over the internet](#share-a-room-over-the-internet).
- **Script mode at no cost:** open **http://localhost:5173/?mode=demo** and pick a demo. To play one right away: `/?mode=demo&demo=architecture&auto=1&speed=2`. Space plays and pauses, ← and → jump between chapters, and the timeline takes you to any moment. `demo=sketch` shows hand drawing turned into a diagram, and `demo=data-model` a data model.
- **Replay a session:** in script mode press **Open a session** (or drop the file on the bar) and pick a `.json` you exported. It plays step by step, with no Claude calls.
- **Move around:** mouse wheel = zoom; drag with the Move tool, or hold Space with any tool, = pan.

### Architect mode

Design an AWS architecture together with Claude. It draws, asks and pushes back like a senior architect would, following the AWS Well-Architected Framework.

- **Enter:** press the **Architect** tab next to the logo, or open **http://localhost:5173/?mode=architect**. You start on a blank board with one system zone.
- **Talk by text:** there is one text box at the bottom. Say what you want to build and press Enter. What you ask for is drawn in ink.
- **Pencil proposals:** what Claude adds on its own is drawn in pencil (grey and sketchy), with a question. Type *"yes"* or *"no"*, or click the sketch and press ✓ or ✗. When the choice depends on you, Claude draws two alternatives side by side: answer *"A"* or *"B"*, or click the one you want.
- **Speech bubbles:** Claude answers in a short bubble that points at what it talks about. Past bubbles shrink to dots on the timeline rail above the text box: hover one to read it, click it to reopen it.
- **Saves itself:** architect mode has its own autosave, apart from live mode, so one never overwrites the other. Switching modes wipes the board without asking; come back and press **Restore** to get the design back, pending pencil included. Export and import work too, and a file reopens in the mode it was saved in.
- **Draw:** the draw dock works here too. Sketch boxes and arrows, a box around components or a cross over one, and the sketch goes to the architect as a turn. What you draw counts as asked for, so it comes back in ink.
- **Data model:** ask for the tables and the architect draws the entities, fields and relations in a second zone under the architecture.
- **Review:** the **Review** button (top right) opens the Well-Architected panel. **Review this design** makes Claude assess the six pillars and list the risks as findings, each pinned on the item it belongs to; you can ask Claude to fix one. Each of those is a request to Claude. Its advice uses a digest of the framework in `packages/wellarchitected/`, adapted from AWS documentation under CC BY-SA 4.0 (see [NOTICE.md](packages/wellarchitected/NOTICE.md)).

Architect turns use Sonnet by default and follow the same key rules as live mode. If you change the architect prompt, run the scripted sessions first: `pnpm --filter @grafito/server eval architect scripts/architect/scenarios` (add `--dry` to see what would be sent without calling Claude).

### Use your Claude subscription (local only)

You can run Claude on your own Claude plan instead of the API. It is for your own machine: Anthropic does not allow offering claude.ai login to other people, so never host this for others.

1. Log in with `claude` (Claude Code), or run `claude setup-token` and put the result in `apps/server/.env` as `CLAUDE_CODE_OAUTH_TOKEN`.
2. Add `GRAFITO_SUBSCRIPTION=1` to `apps/server/.env` and restart.
3. In Options → Model, pick a **plan** model. It shows tokens and "included in plan", no dollars, and counts against your plan limit.

The API key is never sent on a plan call. If a plan model is asked for with the switch off, the request fails with "Plan models are off" instead of billing the API; a restored session picks the default API tile, which shows its price. The eval can run plan models without the switch:

```bash
pnpm --filter @grafito/server eval instruction <record.json> "<instruction>" --model claude-sonnet-5-5@subscription
```

### Share a room over the internet

A room normally works on your machine and, with `GRAFITO_HOST=1`, on your network. To invite someone outside it, Grafito opens a tunnel from your machine (a free Cloudflare quick tunnel, no account):

```bash
brew install cloudflared   # once
pnpm share
```

1. The terminal prints an **owner link** (`http://localhost:8790/api/owner?k=...`). Open it in your browser on this machine: it marks that browser as yours. The link works once; for another browser, restart `pnpm share`. Keep working at `http://localhost:8790`, not at the public address: through the tunnel you are a guest too.
2. Press **Collaborate**, then **Share**, and send the link it shows. It ends in `#k=...`, the room's invite token; without it nobody gets in.
3. Ctrl+C stops everything. The public address is new each time, so old links stop working.

Guests can only load the page and join a room they were sent. Live mode, architect mode, saved sessions and opening rooms stay yours. Whoever has a room link uses Claude at your cost, so each room has limits: 12 people, 12 Claude requests a minute, 300 requests and 5 USD in total by default (`GRAFITO_ROOM_MAX_USD`, `GRAFITO_ROOM_MAX_CALLS` and others in `apps/server/.env`; the full list and what is not protected are in [ADR 0009](docs/adr/0009-rooms-over-a-tunnel.md)). Plan models are off while sharing. `pnpm share --no-tunnel` runs the same thing on your machine only, to try it.

### Saved sessions

- Each session is saved to `apps/server/sessions/` (on your disk, not uploaded to git).
- On reload, you can **Restore** the last session.
- **Export** downloads a `.json`, the board as `.svg`, and the clean diagram as `.hifi.svg` and `.hifi.png`. **Import** loads a `.json`.
- **Clear** wipes the board and your ink and starts a new session. In a room it clears for everyone.

## Privacy

- Your text is sent to the Anthropic API to draw. When Claude reads a sketch, a picture of it goes too.
- In a room, what everyone says, types and draws goes through your server. With `pnpm share`, it travels through Cloudflare's tunnel.
- The browser transcribes your voice. In Chrome, the audio goes through Google's speech service.
- Sessions stay on your disk, in `apps/server/sessions/`.

## Common problems

| What happens | What to do |
| --- | --- |
| "Missing API key in .env" | Check that `apps/server/.env` has your real key and restart `pnpm dev`. |
| The microphone does not start | Use Chrome, open the app through `localhost` and check the microphone permission. |
| "The microphone was activated in another tab" | Only one tab can listen at a time. Press Talk in the tab you want to use. |
| It does not recognize what I say | Change the language in Options to the one you speak. |

## For developers

grafito is a pnpm + Turborepo monorepo. Packages are private and source-only (no build step). See [ARCHITECTURE.md](ARCHITECTURE.md) for the pipeline, [GLOSSARY.md](GLOSSARY.md) for names and [CONTRIBUTING.md](CONTRIBUTING.md) for setup.

```bash
pnpm dev                                         # web on :5173, server on :8787
pnpm turbo run typecheck lint test build         # what CI runs
pnpm e2e                                         # the app driven in a browser (Playwright); never calls Claude
pnpm --filter @grafito/server eval instruction <record.json> "<instruction>" [--dry]  # replay a saved session against an instruction
pnpm --filter @grafito/server eval baseline <dir> [--dry]  # the prompt regression eval: 2 instructions per record
pnpm --filter @grafito/server eval architect scripts/architect/scenarios [--dry] [--runs N]  # architect mode's scripted sessions, checked turn by turn
pnpm --filter @grafito/icons icons:aws <zip>     # reinstall the AWS icons from the official package
```

**How it works, in short:** the voice becomes text in the browser. The text goes to `POST /api/board` (in `apps/server`). Claude answers with *operations* (create zone, add box, connect, etc.) using streaming tools. The browser applies each operation to the board and animates it.

| Package | What is in it |
| --- | --- |
| `apps/web` | Vite + React. Rendering engine, live session UI, speech, drawing, rooms, script mode, browser checks (`e2e/`). |
| `apps/server` | Express + Anthropic. `POST /api/board` (Claude call, streams ops over SSE), rooms over WebSocket, share mode, saved sessions, eval script. |
| `packages/contract` | The browser/server contract. Ops and their tool definitions, op validation, pricing. |
| `packages/board` | The board engine, no DOM. Model (`applyOps`), layout, routing, render tree, animation queue, controller, board text for the prompt. |
| `packages/icons` | Icon catalogs. AWS curated list, SVGs, NOTICE, fetch script. |
| `packages/wellarchitected` | The Well-Architected digest for architect mode. Pillar, question and best-practice titles, NOTICE, fetch script. |
| `packages/config` | Shared tsconfig bases and the ESLint flat config. |

Demo scripts live in `apps/web/src/demos/`; the player UI is in `apps/web/src/script/`.

### Versions and releases

Versions follow [SemVer](https://semver.org/). While in alpha they carry the `-alpha.N` suffix and are marked as *pre-release*. The changes of each version are in [CHANGELOG.md](CHANGELOG.md).

- **CI** (`.github/workflows/ci.yml`): on every push to `main` and every PR it runs types, lint, tests and build, and the browser checks.
- **Release** (`.github/workflows/release.yml`): when a `v*` tag is pushed it checks again, builds and creates the GitHub release with automatic notes and two files (source code and the built `dist/`).

To publish a new version, set `version` in the root `package.json`, then:

```bash
git commit -am "Release v0.2.0-alpha.5"
git tag v0.2.0-alpha.5
git push --follow-tags
```

## Roadmap

- [ ] Cloud speech recognition (for Firefox and better accuracy)
- [ ] More drawing shapes
- [ ] A version published on the web, with nothing to install

## Contributing

Welcome! Open an *issue* with what you found or what you would like. If you send a *pull request*, run `pnpm turbo run typecheck lint test build` first, and `pnpm e2e` if you changed what happens on screen. Reviewers follow [CODING_STANDARDS.md](CODING_STANDARDS.md).

## License

[MIT](LICENSE) © 2026 Jorge Simoes, except the icons in `packages/icons/src/aws/` (see [NOTICE.md](packages/icons/src/aws/NOTICE.md)) and the Well-Architected digest in `packages/wellarchitected/`, adapted from AWS documentation under CC BY-SA 4.0 (see [NOTICE.md](packages/wellarchitected/NOTICE.md)).

Amazon Web Services, AWS and the related service icons are trademarks of Amazon.com, Inc. or its affiliates. Grafito is not affiliated with or endorsed by AWS.

