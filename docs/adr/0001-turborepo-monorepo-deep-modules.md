# pnpm + Turborepo monorepo of deep, DOM-free packages

Status: accepted

Grafito started as one Vite app with a `server/` folder beside it. Browser code, server code and the pure board engine imported each other freely, so nothing stopped DOM or Node code from leaking into the logic that both sides share. We want a codebase that a community can maintain, extend and fork.

We split it into a pnpm + Turborepo monorepo, kept deliberately light:

- Two apps (`apps/web`, `apps/server`) and four packages (`packages/contract`, `board`, `icons`, `config`).
- Packages are private and source-only: apps import their TypeScript directly, with no build step and no remote cache.
- `packages/*` hold only code that runs anywhere: no DOM, no Node. Anything that touches `document`, `localStorage`, `fetch`, speech or React stays in `apps/web`.
- Each package hides a lot behind a small interface (a deep module). Code goes through a package's name and its `index.ts`, never through a path into its `src`.
- Boundaries are enforced three ways: pnpm strictness (a package sees only the dependencies it declares), per-package tsconfig (`packages/*` get no DOM or Node libs), and ESLint `no-restricted-imports` in CI.

We rejected npm workspaces without Turborepo (no task graph or caching), and built, published-style packages (a build step for every change, for no benefit while everything is private).

## Consequences

- Turbo has a `transit` task with no command so that `typecheck`, `lint` and `test` wait on their dependencies' sources without forcing a build.
- Tests and CLI scripts inside a package need Node, so `board` and `icons` have a second `tsconfig.test.json` with Node types, and `typecheck` runs both.
- The AWS SVGs live in `packages/icons` but are loaded by Vite in `apps/web` through the `@aws-svg` alias. Icon data must never import the Vite loader, or Node scripts that reach it break.
- CLI scripts live in the package they serve; there is no root `scripts/` folder.
