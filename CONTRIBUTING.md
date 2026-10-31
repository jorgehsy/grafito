# Contributing

Thanks for helping. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) for how the pieces fit, [`GLOSSARY.md`](GLOSSARY.md) for what things are called, and [`docs/adr/`](docs/adr/) for the decisions behind them.

## Setup

You need Node `^20.19.0 || >=22.12.0` and pnpm (the version is pinned in `package.json` under `packageManager`; `corepack enable` picks it up). npm and yarn are refused by a `preinstall` check.

```sh
pnpm install
cp apps/server/.env.example apps/server/.env   # then put your Anthropic API key in it
pnpm dev                                       # web on :5173, server on :8787
```

## Tasks

Everything runs through Turborepo from the repo root:

| Command | What it runs |
| --- | --- |
| `pnpm dev` | `turbo run dev`: Vite for `apps/web` and `tsx watch` for `apps/server` |
| `pnpm typecheck` | `tsc --noEmit` in every package (plus `tsconfig.test.json` in `board` and `icons`) |
| `pnpm lint` | ESLint in every package |
| `pnpm test` | Vitest in every package that has tests |
| `pnpm build` | the production build of `apps/web` |

Before you push, run what CI runs:

```sh
pnpm turbo run typecheck lint test build
```

Pull requests run the same tasks with `--affected`. To work on one package, use `--filter`, for example `pnpm turbo run test --filter=@grafito/board`.

Packages are source-only: there is no build step between them. The `transit` task in `turbo.json` has no command; it only makes `typecheck`, `lint` and `test` wait on the packages they depend on.

## Package boundaries

- `apps/web` and `apps/server` may import `packages/*`. `packages/*` must never import `apps/*`, and `apps/web` must never import `@grafito/server`.
- Import another package by its name (`@grafito/board`), never by a path into its `src`.
- `packages/*` have no DOM and no Node APIs: their tsconfig has `types: []` and `lib: ["ES2022"]`. Tests and CLI scripts in a package use a separate `tsconfig.test.json` with Node types.
- A dependency must be declared in the package that uses it; pnpm does not hoist undeclared ones.

These rules are enforced by tsconfig and by `no-restricted-imports` in the shared ESLint config (`packages/config/eslint.js`). Each package has a one-line `eslint.config.js` that calls `config({ react, layer })`.

## Code style

- Formatting: see [`.editorconfig`](.editorconfig) (two spaces, LF, final newline).
- Names: use the terms in `GLOSSARY.md`; don't invent synonyms.
- Code, comments and docs are in English. The only exceptions are the speech-recognition language options and the demos ([ADR 0003](docs/adr/0003-english-code-language-follows-user.md)).
- `no-explicit-any` and `react-hooks/exhaustive-deps` are warnings, not errors, because existing code has many hits. Don't add new ones.

### Comments

Keep a comment only when it says **why**, states an **invariant**, or warns about a **gotcha**. Delete:

- banners and section dividers;
- comments that restate the code;
- ticket references with no context;
- `eslint-disable` lines that no longer disable anything. A disable that stays must give its reason.

## TypeScript 6 pin for ESLint

All packages typecheck with TypeScript 7, but typescript-eslint does not accept TS 7 yet. `packages/config` has `typescript@^6` as a devDependency so ESLint uses it. The "unmet peer" warning on install is expected. Remove the pin once typescript-eslint supports TS 7.

## Commits and issues

- Work happens on `main` during the alpha; releases are tags (`v0.2.0-alpha.N`).
- One commit per change, and every commit green.
- Issues live in GitHub Issues. Say which issue a commit closes with `Closes #N`.
