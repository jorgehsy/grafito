# Architecture

Grafito listens to a talk and draws it live. Claude never draws anything itself: it emits **ops** (small, coordinate-free changes to the board), and the browser lays out and animates the result. Terms in bold are defined in [`GLOSSARY.md`](GLOSSARY.md); decisions are in [`docs/adr/`](docs/adr/).

Some file and identifier names are still Spanish (for example `sello.ts` for the service stamp). They are being renamed to the glossary terms.

## Package map

```
apps/
  web/        Vite + React: rendering engine, live session UI, speech, demos
  server/     Express + Anthropic: POST /api/board, saved sessions, eval script
packages/
  contract/   the browser/server contract: ops, tool definitions, op validation, pricing
  board/      the board engine, no DOM: model, layout, routing, render tree, animation queue
  icons/      icon catalogs: AWS curated list, SVGs, NOTICE, fetch script
  config/     shared tsconfig bases and ESLint flat config
```

Dependencies point one way: `apps/*` → `packages/*`. `board` depends on `contract` and `icons`; `contract` depends on `icons`. `packages/*` never import from `apps/*` and use no DOM or Node APIs (see [ADR 0001](docs/adr/0001-turborepo-monorepo-deep-modules.md)).

| Package | Main files |
| --- | --- |
| `packages/contract` | `ops.ts` (op types and tool definitions), `validate.ts` (op validation and tool sets per catalog), `pricing.ts` (prices, usage, cost) |
| `packages/board` | `model.ts` (board, `applyOp`), `layout.ts`, `route.ts` (routing across zones), `tree.ts` (render tree), `animator.ts` (diff, animation queue), `controller.ts`, `camera.ts`, `player.ts` (demo player), `serialize.ts` (board text), `palette.ts` |
| `packages/icons` | `src/aws/servicios.ts` (curated list), `src/aws/*.svg`, `src/aws/AVISO.md` (NOTICE), `scripts/iconos-aws.ts` |
| `apps/web` | `BoardApp.tsx`, `live/*` (session, scheduler, SSE client, speech, session record, UI), `render/*` (engine, visuals, service stamp), `scripts/*` (demos) |
| `apps/server` | `src/index.ts` (routes), `src/board.ts` (prompt, Claude call, SSE), `src/sessions.ts`, `scripts/eval-instruccion.ts` |

## Pipeline

speech → fragment → `POST /api/board` → Claude tool calls → ops → board model → layout → render tree → animated SVG

1. **Speech.** `apps/web/src/live/speech/webSpeech.ts` wraps the browser's speech recognition behind the `SpeechSource` interface (`speech/types.ts`). Interim results show as subtitles; finished results are added to the **transcript** and grouped by `speech/grouper.ts` (short pause or length limit; longer while the wake word is present).
2. **Fragment.** `live/LivePanel.tsx` hands each grouped text to the **live session** (`live/session.ts`). `live/instruction.ts` splits it at the **wake word** into content and an **instruction**. `live/scheduler.ts` keeps one request in flight and joins the content that arrives meanwhile into one **batch**; each instruction goes alone.
3. **`POST /api/board`.** `live/sse.ts` posts the batch with the **board text** (`packages/board/src/serialize.ts`), the **summary**, the Claude model, the **shape preference**, the **mode** and the enabled **icon catalogs**. In development Vite proxies `/api` to the server on port 8787.
4. **Claude tool calls.** `apps/server/src/board.ts` builds the system prompt (`systemPromptFor`) and the user text (`buildUserText`), picks the tool set for the enabled catalogs (`toolSetFor` in `packages/contract/src/validate.ts`) and streams a Claude response. It retries once, only if no op has been sent yet.
5. **Ops.** Each completed `tool_use` block is parsed and validated (`parseToolBlock` → `validateOp`) and sent to the browser as an SSE `op` event. Invalid ops are sent as warnings and skipped. `usage`, `done` and `error` events carry cost, timings and failures.
6. **Board model.** `live/sse.ts` parses the stream and the session submits each op to `BoardController` (`packages/board/src/controller.ts`), which applies ops one at a time with `applyOp` (`model.ts`). The board holds no coordinates.
7. **Layout.** `computeLayout` (`layout.ts`) positions everything per zone kind: ELK for flow and system, d3-hierarchy for mindmap, stacked rows for list and compare, custom code for scale, cycle, timeline and tree. `route.ts` routes connections between zones around obstacles.
8. **Render tree.** `buildTree` (`tree.ts`) turns board + layout into a flat list of **render items** with stable keys. `diffTrees` (`animator.ts`) compares it with the previous tree, and the **animation queue** plays the result: draw, update and remove in order, moves in parallel, faster when work piles up.
9. **Animated SVG.** `apps/web/src/render/engine.ts` implements the queue's `Sink`: it builds each **visual** with rough.js (`render/visuals.ts`), animates strokes, fills and text, adds the **service stamp** (`render/sello.ts`) and moves the camera (`packages/board/src/camera.ts`).

### Side paths

- **Session records.** `live/record.ts` builds a session record from the session's requests and posts it to `POST /api/sessions`; `apps/server/src/sessions.ts` writes it under `apps/server/sessions/`. Records can also be exported, imported and restored in the browser.
- **Demos.** In demo mode, `Player` (`packages/board/src/player.ts`) plays a demo from `apps/web/src/scripts/*` through the same `BoardController`, without the server.
- **Icons.** `packages/icons` holds the AWS SVGs; `apps/web/src/iconos/aws/index.ts` loads them with Vite's `import.meta.glob` through the `@aws-svg` alias. `pnpm --filter @grafito/icons icons:aws <zip>` refreshes them from AWS's official icon package.
- **Eval.** `apps/server/scripts/eval-instruccion.ts` replays a saved session record and runs an instruction against it, to compare prompt changes.
