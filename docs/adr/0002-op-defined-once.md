# A valid op is defined once and checked on both sides

Status: accepted (implementation: #16)

An op crosses three borders: Claude emits it as a tool call, the server streams it to the browser over SSE, and the browser also loads ops from restored and imported session records. Today the shape of an op is written down in more than one place: TypeScript types and JSON Schema tool definitions in `packages/contract/src/ops.ts`, an Ajv validator in `packages/contract/src/validate.ts` used only by the server, shape checks inside `applyOp` in `packages/board/src/model.ts`, and `as Op` casts in the browser. These can drift apart, and a bad op from an old record reaches the board unchecked.

We decided that a valid op is defined exactly once, in `packages/contract`, and that every border parses it through the same interface: `parseOp(input, catalogs)` and `toolDefs(catalogs)`. The server parses each completed tool block; the browser parses every SSE op, restored record and imported file. `applyOps` keeps only the checks that need the board (does this id exist, is this zone the right kind).

Whether the single source is a Zod schema (exported with `z.toJSONSchema`) or JSON Schema plus `json-schema-to-ts` is settled by a short spike: Zod only if its output matches today's tool definitions except for key order.

## Consequences

- Snapshot tests of the tool definitions make any change to what Claude sees show up as a diff.
- Shape tests move from `packages/board` to `packages/contract`.
