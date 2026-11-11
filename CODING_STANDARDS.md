# Coding standards

Read this when you **review** a diff. It holds only the rules a tool cannot check. Each one comes from a bug that passed typecheck, lint and tests.

Rules a tool does check are not repeated here:

- Package boundaries, unused names, the warning cap: ESLint (`packages/config/eslint.js`, `--max-warnings` in each `lint` script).
- No DOM or Node in `packages/*`: tsconfig.
- Formatting, names, comments, language: [`CONTRIBUTING.md`](CONTRIBUTING.md#code-style) and [`GLOSSARY.md`](GLOSSARY.md).

## A mode owns what it starts

Leaving a mode (live, script, architect) or a room stops everything that mode started: requests in flight, the mic, a playing script, timers, and the ink drawn on its board.

- Ask of every new long-lived thing: what stops it when the mode changes?
- Hiding the UI is not stopping. A request that lands after the change draws on the wrong board.
- Found as: a live request drawing on the architect board; ink surviving a mode change and being sent to Claude in the next sketch turn.

## Getting out is never disabled

The mode tabs, Leave and Clear stay enabled. If something is in the way (a script playing, a room), pressing the control ends that thing; the button's title says so.

- A disabled control with no visible reason is a bug report waiting to happen.
- Found as: mode tabs locked while a script played and inside a room.

## One function reads a record

A record (live, architect, room log) is turned into a board by one function. A second reader (replay, export, room seed, script mode) calls it, or shares its steps; it does not list op kinds again.

- When a diff adds an op or a zone kind, look for every place that walks a record's ops and check they all go through the shared path.
- Found as: script-mode replay of an architect record dropping the data model, because it did not insert the data zone that `replayArchitect` inserts; room export missing the seeded board.

## Spending is counted on every way out

Anything that calls Claude adds to its counters in a `finally`, and its cap is checked where the work is taken off the queue, not only where it is put on.

- Reset, abort, disconnect and error are ways out too.
- Found as: a room's USD cap bypassed by sending `reset` mid-request; twelve queued requests all running past the cap.

## What crosses modes, rooms or pointer tools gets a browser check

Unit tests see one module. A change to how modes switch, what Clear clears, what a second person in a room sees, or what a pointer tool does comes with a check in `apps/web/e2e` (run with `pnpm e2e`).

- The checks never call Claude: open the app through `open()` in `apps/web/e2e/app.ts`.
- A change that only moves pixels does not need one.

## One rule sets a layout variable for a state

The shell's free area (`--free-l/t/r/b`, `--band-r` in `apps/web/src/board.css`) is set by `:has()` rules. When a diff adds one, check that no earlier rule with higher specificity sets the same variable for the same state.

- Found as: `--free-b: 132px` for architect mode never applying, because `.v2:has(.subtitles[hidden])` won.
