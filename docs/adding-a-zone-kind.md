# Adding a zone kind

A **zone kind** (see `GLOSSARY.md`) is the shape a zone draws its topic in: flow, system, list, compare, mindmap, scale, cycle, timeline or tree. A kind touches every layer of the pipeline in `ARCHITECTURE.md`. This list was built by grepping the repo for `timeline` and `cycle`; do the same for the kind closest to yours to catch anything added since.

Everything below is in order: do it top to bottom and run `pnpm turbo run typecheck lint test build` at the end. TypeScript finds most omissions, because `ZoneKind` and `ElementType` are closed unions.

## Touch points

1. **Contract: the kind and its ops** (`packages/contract/src/ops.ts`)
   - Add the name to `ZONE_KINDS`.
   - Add one Zod schema per new op (for example `add_stage`) in the op schema table. This is the only definition of an op: `Op`, validation and tool definitions derive from it.
   - If `create_zone` needs a zone-level field (like `center_label` for cycle), add it to the `create_zone` schema.
   - Add the op's description in the tool descriptions table and extend the `kind:` list inside the `create_zone` description. This text is what Claude reads.
   - If the kind has new free-text fields, add them to `TEXT_FIELDS`.
2. **Contract tests and snapshots** (`packages/contract/src/parse.test.ts`, `packages/contract/src/__snapshots__/tools.off.json`, `tools.aws.json`)
   - Add valid and invalid cases for each new op.
   - The tool snapshots change because the tool text changed. Regenerate them (`pnpm --filter @grafito/contract test -u`) and review the diff.
3. **Prompt** (`apps/server/src/prompt/system.ts`, `system.test.ts`)
   - Add a line to the "Choosing the zone kind" list saying when to pick the kind.
   - `system.test.ts` pins the hash of the prompt and of the tool definitions. Update both hashes and bump `PROMPT_VERSION` in `packages/contract`, since saved sessions stamp it.
4. **Board model** (`packages/board/src/model.ts`)
   - Add the new element type to `ElementType`, and its fields to `Element` or `Zone` if needed.
   - Map the type to the kind in `ELEMENT_ZONE`.
   - Add a `case` per new op in `applyOp`: check the zone exists and `zone.kind` matches, push warnings instead of throwing.
   - In `create_zone`, copy any zone-level field.
   - If the element is not part of the implicit flow chain, exclude it in `derivedConnections` (stages are).
   - If the element can carry an emphasis or note, check `update_label` / `emphasize` / `callout` target rules (the `["mark", "stage", "event", "branch"]` list).
5. **Layout** (`packages/board/src/layout/`)
   - New file `<kind>.ts` exporting `layout<Kind>(zone, elements): ZoneLocal`, in the zone's own coordinates starting near (0, 0).
   - Sizes of its elements go in `elementSize` and `elementLines` (`geometry.ts`).
   - Dispatch it in `layoutZone` (`zones.ts`). The result is cached by a key built from the zone and its elements: if the layout reads a new zone field, add it to that key.
   - If the layout needs geometry the other kinds do not have (like `scale` or `spans`), add an optional field to `ZoneLocal` and `BoardLayout` in `types.ts` and copy it in the normalisation step of `layoutZone` and in `computeLayout` (`index.ts`).
6. **Render tree** (`packages/board/src/tree.ts`)
   - Emit a render item for each element type and for any decoration (ring, axis, divider). Give each a stable `key` and a `sig` that changes whenever what is drawn changes, since `diffTrees` animates from these.
7. **Board text for the prompt** (`packages/board/src/serialize.ts`)
   - Print the new zone fields and element fields so Claude sees them on the next request. This is text Claude reads, so it counts as a prompt change.
8. **Web rendering** (`apps/web/src/render/visuals.ts`)
   - Draw each new `variant` of render item.
9. **Web UI** (`apps/web/src/live/ui/ShapeGallery.tsx`, `apps/web/src/i18n/en.ts`, `es.ts`)
   - Add the thumbnail entry, and a `shape.<kind>` string in both dictionaries.
10. **Demo** (`apps/web/src/demos/<kind>.ts`, `apps/web/src/demos/index.ts`, `demos.test.ts`)
    - Optional but recommended: a demo built with `timeline([...])` from `@grafito/board`, registered in `index.ts`. Add its id to `SHORT` in `demos.test.ts` if it is short.
11. **Tests**
    - Model: ops accepted, invalid ops ignored with a warning (`packages/board/src/model.test.ts`, or a dedicated file like `cycle-timeline.test.ts`).
    - Layout: through `computeLayout`, assert elements are inside the zone and do not overlap.
12. **Docs**
    - `GLOSSARY.md`: the list in **Zone kind**, a **Zone kind** entry for the new kind, and any new element name (with `_Avoid_`).
    - `README.md`: the "Drawing shapes" list.
    - `ARCHITECTURE.md`: the layout sentence in the pipeline section.
    - `CHANGELOG.md`: an entry under Unreleased.

## Worked example: a hypothetical `funnel` kind

Stages stacked top to bottom, each narrower than the last, with a conversion note.

1. `ops.ts`: `ZONE_KINDS` gets `"funnel"`; add `add_layer: z.strictObject({ zone: id(...), id: id(...), label: text(...), note: str(...).optional() })`; add its tool description and mention `funnel` in the `create_zone` description.
2. `parse.test.ts`: `ok("add_layer", { zone: "f", id: "l", label: "Visits" })` is true; a missing `label` is false. Regenerate the tool snapshots.
3. `system.ts`: `- funnel: quantities that shrink step by step (conversion). add_layer adds each layer from top to bottom.` Update the two hashes in `system.test.ts` and bump `PROMPT_VERSION`.
4. `model.ts`: `ElementType` gets `"layer"`; `ELEMENT_ZONE` gets `layer: ["funnel"]`; `applyOp` gets `case "add_layer"` modelled on `add_stage`, rejecting zones that are not `funnel`; `derivedConnections` skips `layer` so no implicit arrows appear.
5. `layout/funnel.ts`: `layoutFunnel` stacks the layers, each `elementSize` narrower than the previous, centred on one axis, returning a `ZoneLocal`. `geometry.ts`: `elementSize` gets `case "layer"`. `zones.ts`: `else if (zone.kind === "funnel") content = layoutFunnel(zone, elements);`.
6. `tree.ts`: `layer` elements emit `variant: "layer"` items with `lines`; the `sig` includes the lines and the width.
7. `serialize.ts`: print `layer` elements as it does `stage`.
8. `visuals.ts`: a `v === "layer"` branch draws a trapezoid with the label.
9. `ShapeGallery.tsx`: a `funnel` thumbnail; `shape.funnel` in `en.ts` and `es.ts`.
10. Tests: `model` (wrong zone kind warns), `computeLayout` (layers inside the zone, no overlaps).
11. Docs: GLOSSARY, README, ARCHITECTURE, CHANGELOG.

## Checking you did not miss a place

```sh
grep -rniI --exclude-dir=node_modules --exclude-dir=.git --exclude=CHANGELOG.md -e '<existing kind>' .
```

Every file in the output for an existing kind should have a counterpart for yours.
