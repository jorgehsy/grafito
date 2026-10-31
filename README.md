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
- **Drawing shapes.** Auto, Map, Flow, Scale, Cycle, Timeline, Tree, System, List or Compare.
- **Voice commands.** Say *"Grafito, ..."* to ask for changes: *"Grafito, split this into two diagrams"*.
- **Saves itself.** Each session is saved to `apps/server/sessions/`. You can restore, import and export (JSON and SVG).
- **Visible cost.** Shows the tokens and the dollar cost of each request.
- **AWS icons.** Turn on the catalog in Options → Icons and Claude puts the official icon (Lambda, S3, Cognito... 40 services) next to boxes that are AWS services.
- **Script mode.** Demos that need no Claude and cost nothing, to see how it works.

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
3. Press **Talk** (or the space bar) and allow the microphone.
4. Talk. The board draws itself.

### Other ways to use it

- **No microphone:** type or paste text in the box and press Enter or **Send**.
- **Give commands:** say or type *"Grafito"* and then the command. What came before is drawn; what comes after is taken as an instruction. If you do not like the result, use **Undo instruction**.
- **Pick the shape:** in **Options** you choose the drawing shape, the model (Sonnet by default, Haiku is cheaper) and the language (es-CL, es-AR, es-MX, es-ES, en-US).
- **See costs:** press **F3** or the stats button.
- **Demo at no cost:** open **http://localhost:5173/?mode=demo** and pick a demo. To play one right away: `/?mode=demo&demo=architecture&auto=1&speed=2`.
- **Move around:** mouse wheel = zoom, drag = pan.

### Saved sessions

- Each session is saved to `apps/server/sessions/` (on your disk, not uploaded to git).
- On reload, you can **Restore** the last session.
- **Export** downloads a `.json` and the board as `.svg`. **Import** loads a `.json`.
- **Clear** starts a new session.

## Privacy

- Your text is sent to the Anthropic API to draw.
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
pnpm --filter @grafito/server eval instruction <record.json> "<instruction>" [--dry]  # replay a saved session against an instruction
pnpm --filter @grafito/server eval baseline <dir> [--dry]  # the prompt regression eval: 2 instructions per record
pnpm --filter @grafito/icons icons:aws <zip>     # reinstall the AWS icons from the official package
```

**How it works, in short:** the voice becomes text in the browser. The text goes to `POST /api/board` (in `apps/server`). Claude answers with *operations* (create zone, add box, connect, etc.) using streaming tools. The browser applies each operation to the board and animates it.

| Package | What is in it |
| --- | --- |
| `apps/web` | Vite + React. Rendering engine, live session UI, speech, demos. |
| `apps/server` | Express + Anthropic. `POST /api/board` (Claude call, streams ops over SSE), saved sessions, eval script. |
| `packages/contract` | The browser/server contract. Ops and their tool definitions, op validation, pricing. |
| `packages/board` | The board engine, no DOM. Model (`applyOps`), layout, routing, render tree, animation queue, controller, board text for the prompt. |
| `packages/icons` | Icon catalogs. AWS curated list, SVGs, NOTICE, fetch script. |
| `packages/config` | Shared tsconfig bases and the ESLint flat config. |

Demo scripts live in `apps/web/src/demos/`.

### Versions and releases

Versions follow [SemVer](https://semver.org/). While in alpha they carry the `-alpha.N` suffix and are marked as *pre-release*. The changes of each version are in [CHANGELOG.md](CHANGELOG.md).

- **CI** (`.github/workflows/ci.yml`): on every push to `main` and every PR it runs types, lint, tests and build.
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

Welcome! Open an *issue* with what you found or what you would like. If you send a *pull request*, run `pnpm turbo run typecheck lint test build` first.

## License

[MIT](LICENSE) © 2026 Jorge Simoes, except the icons in `packages/icons/src/aws/` (see [NOTICE.md](packages/icons/src/aws/NOTICE.md)).

Amazon Web Services, AWS and the related service icons are trademarks of Amazon.com, Inc. or its affiliates. Grafito is not affiliated with or endorsed by AWS.

