## Package map

pnpm + Turborepo monorepo. Packages are private and source-only (no build step). See `ARCHITECTURE.md` for the pipeline and `GLOSSARY.md` for names.

- `apps/web`: Vite + React. Rendering engine, live session UI, speech, demos.
- `apps/server`: Express + Anthropic. `POST /api/board` (Claude call, streams ops over SSE), saved sessions, eval script.
- `packages/contract`: the browser/server contract. Ops and their tool definitions, op validation, pricing.
- `packages/board`: the board engine, no DOM. Model (`applyOps`), layout, routing, render tree, animation queue, controller, board text for the prompt.
- `packages/icons`: icon catalogs. AWS curated list, SVGs, NOTICE, fetch script.
- `packages/wellarchitected`: the Well-Architected digest for the architect prompt. Pillar, question and best-practice titles, NOTICE (CC BY-SA 4.0), fetch script.
- `packages/config`: shared tsconfig bases and the ESLint flat config.

`packages/*` must not import from `apps/*`, and must not use DOM or Node APIs. Check with `pnpm turbo run typecheck lint test build`.

UI behaviour (modes, ink, rooms): check with `pnpm e2e` (Playwright, `apps/web/e2e`; it never calls Claude) instead of driving a browser by hand. When reviewing a diff, read `CODING_STANDARDS.md`.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (jorgehsy/grafito), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
