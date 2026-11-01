# Can the board engine show pencil, ink and speech bubbles?

Research for issue #34 (map #31). Facts only, no decision. Sources are the local code at commit `8ad5fd2` (paths relative to the repo root). The terms **Speech bubble**, **Bubble marker**, **Proposal** and **Ink** (as a state, pencil vs ink) are not in `GLOSSARY.md` on this commit; `INK` exists only as a color constant (`packages/board/src/palette.ts:5`).

## How a drawing flows today

- `BoardController.submit` applies each op, lays out, builds the tree, diffs and pushes tasks (`packages/board/src/controller.ts:31-51`).
- `buildTree` emits one `RenderItem` per drawable: `{key, kind, sig, hue, geom, data, under?}` (`packages/board/src/tree.ts:35-46`). Kinds are a closed union: `zone | element | connection | emphasis | question | callout` (`tree.ts:8`).
- `diffTrees` (`packages/board/src/animator.ts:15-33`): key gone -> `delete`; same key, different `sig` -> `update`; new key -> `draw` (sorted by `KIND_ORDER`, `animator.ts:13`); geom or hue change -> parallel `move`. `sig` is "visual content, no position or color" (`tree.ts:38`), so a color-only change is not an `update`.
- The engine implements `Executor`/`Sink` (`apps/web/src/render/engine.ts:59`). `draw` = stroke the paths with a pen, fade fills, stamp, write text (`engine.ts:118-146`). `update` = red strike-through of the old text, rebuild the visual, rewrite the text (`engine.ts:148-171`). `remove` = 300 ms fade/shrink (`engine.ts:173-189`).
- Visuals are rough.js, seeded from the item key so a rebuild never jitters (`apps/web/src/render/visuals.ts:15-19, 47, 83`). Roughness is multiplied by `ROUGH_SCALE = 0.62` (`visuals.ts:13, 84`).
- SVG layers are fixed at construction: `zone, under, connection, element, ann` (`engine.ts:65, 85`), selected by `layerOf` (`engine.ts:384-387`): everything that is not zone/connection/element goes to `ann`. Layers are plain `<g>` appended in that order, so `ann` is on top.
- `exportSvg` clones the live svg and inlines computed styles, including `display` and `visibility` (`apps/web/src/render/svg-export.ts:1-4, 9-18`), so a hidden layer would also be hidden in the export.

## How annotations work (the reusable part)

| Aspect | Where |
| --- | --- |
| Board state: `emphasis[]`, `questions[]` (keyed by target) and `callouts[]` (own id); `Callout = {id, target, text}` | `packages/board/src/model.ts:52, 58-60` |
| Ops `emphasize`, `mark_question`, `add_callout`; target must be an element, zone or connection (`isTarget`, `model.ts:78`); emphasis and question replace the previous one for that target | `model.ts:262-279`; schemas `packages/contract/src/ops.ts:133-134`, descriptions `ops.ts:170-171` |
| Cascade: deleting a target removes its annotations | `removeRefs`, `model.ts:96-101` |
| Layout: only callouts get layout (box + curved arrow, placed to avoid zones, elements, circles and labels); emphasis and question are positioned directly in `buildTree` from the target rect | `packages/board/src/layout/index.ts:80-95`; `tree.ts:178-208` |
| Target rect for element, zone or connection midpoint | `targetRect`, `tree.ts:179-190` |
| Keys: `emphasis:<target>`, `q:<target>`, callout id | `tree.ts:198, 204, 213` |
| Draw: rough circle/underline/star in red, `?` badge in red, callout text + blue curved arrow with arrowhead | `visuals.ts:302-318` |
| Bounds include callout boxes but not emphasis or question | `layout/index.ts:97` |
| Prompt text: `CALLOUTS` section and `ANNOTATIONS` line | `packages/board/src/serialize.ts:51-58` |

Reusable for a speech bubble: the callout pipeline (op -> `Callout` -> `placeCallout` + `routeCurve` -> render item with box + curved pts -> text + rough arrow) already points a note at an element, zone or connection with obstacle-aware placement. A speech bubble has the same data shape (`id, target, text`) with a different frame (closed outline with a tail instead of free text and an arrow).

## (1) Pencil look on element / connection / zone, animated switch to ink

**What exists**
- Each kind's colors, widths and roughness are set in one function, `buildVisual` (`visuals.ts:150-320`), through `Builder.rough` (`visuals.ts:82-97`). Ink is the constant `INK` (`palette.ts:5`); zones and elements use per-hue `OUTLINES`/`FILLS` (`palette.ts:1-4`).
- A hue change already re-renders a drawn item without redrawing: `syncGeometry` -> `applyGeom` rebuilds the visual with `buildVisual` + `showAll` (`engine.ts:234-285`). It is a swap, not an animated change. Geometry changes are tweened with `lerpGeom` (`engine.ts:48-57`).
- Two precedents for changing an already drawn item: the strike-then-rewrite `update` (`engine.ts:148-171`) and the in-place `restamp` for `set_service`, which has no redraw and whose data field is kept out of `sig` (`tree.ts:13`, `engine.ts:238, 255-269`).
- A stroke-by-stroke pen animation over any `Visual` exists: `hideForDraw` + `drawStrokes` (`visuals.ts:325+`, `engine.ts:287-301`), driven by `vis.strokes` and `getTotalLength`.

**What is missing**
- No per-item pencil/ink state: not in `RenderItem`/`ItemData` (`tree.ts:10-46`), nor in the model's zone, element or connection types (`model.ts`, `Board` at line 54).
- No pencil style: nothing varies stroke color, width, opacity or roughness by state; `ROUGH_SCALE` is global (`visuals.ts:13`).
- `sig` excludes color. A state flip must either enter `sig` (then `diffTrees` emits `update`, which runs the strike-through and text rewrite, not a "line gets darker" effect) or live in `data` outside `sig` and be handled in `syncGeometry` by a dedicated engine method, like `restamp`.
- Nothing in the contract or ops marks "proposed" vs "confirmed" (`ops.ts`); every op writes straight to the board.

**Change size (rough)**
- Pencil look only, no animation: small-medium. One state field on `RenderItem.data` plus style parameters threaded through the ~12 branches of `buildVisual`; touches `tree.ts` and `visuals.ts`.
- Animated pencil -> ink: medium. A new engine method modelled on `restamp`: build the ink visual, `hideForDraw`, run `drawStrokes` over it, swap. Needs the `sig` decision. `animator.test.ts` covers the diff side; the engine has no unit tests (only `stamp.test.ts`).
- The source of the state (what makes an item pencil): model + op changes, see (2); medium.

## (2) Erase a rejected proposal

**What exists**
- Removal is a first-class animation: `diffTrees` emits one `delete` task with all gone keys (`animator.ts:18-19`), the engine fades and shrinks them in 300 ms (`engine.ts:173-189`); at INSTANT speed it removes at once (`engine.ts:176`).
- Model `delete` cascades: zone -> elements -> connections -> annotations (`model.ts:335-358`, `removeRefs` `model.ts:96-101`). Callouts delete by id (`model.ts:352`).
- Derived connections are rebuilt from the model, so they go when their elements go (`derivedConnections`, `tree.ts:166`).

**What is missing**
- No proposal group: nothing ties several pencil items (a zone, its elements, connections) together so they can be accepted (-> ink) or rejected (-> erase) as a unit. A proposal is N items with N ids.
- The erase effect is one fade/shrink for every item, not an eraser motion (`engine.ts:178-186`). `SeqTask delete` carries only `keys` (`animator.ts:9`) and `Executor.remove(keys, speed)` has no reason (`animator.ts:45`), so a different effect for "rejected" needs both extended.
- `delete` of an element is lossy for reverting: it re-parents children and clears `after` on others (`model.ts:340-348`). Rejecting a proposal must remove only what the proposal added.
- `submit` runs a layout per op (`controller.ts:34-48`); rejecting N items as N deletes costs N layouts unless a batch op is added.

**Change size (rough)**
- Rejecting by `delete` per item: small, works today with the fade-out; cost is N ops and N layouts.
- Proposal grouping with accept/reject ops and cascade: medium. Touches `ops.ts` (ops and tool defs), `model.ts` (group field, cascade like `removeRefs`), `serialize.ts`, `parse.ts` catalog sets, tests.
- A distinct eraser animation: small-medium, inside `Engine.remove` (`engine.ts:173`) plus a reason on the delete task and executor signature.

## (3) Speech bubble pointing at an element + minimized bubble marker on a togglable layer

**What exists**
- The callout data, layout, placement and render path as a template (table above). Target resolution already covers element, zone and connection (`tree.ts:179-190`, `model.ts:78`).
- Annotations already sit in their own SVG group, `layers.ann` (`engine.ts:65, 85, 386`). Hiding it is one `style.display` assignment on a `<g>`.
- The `question` kind is the nearest thing to a minimized marker: a 34x34 badge at the target's corner with optional text beside it (`tree.ts:200-208`, `visuals.ts:308-311`).
- The `Shown` map keeps each item's visual group and layer (`engine.ts:19-25, 70`), so swapping a bubble between expanded and marker could reuse the `update`/`applyGeom` replace pattern (`engine.ts:148, 271`).

**What is missing**
- A bubble frame: `visuals.ts` has no closed outline with a tail. The callout draws text plus a separate curved arrow (`visuals.ts:312-318`). rough.js polygon and path with fill are available through `Builder.rough` (`visuals.ts:88-95`), so the drawing is within existing means.
- Bubble state and speaker: `Callout` has `id, target, text` only (`model.ts:52`); no open/minimized state, no author. Annotation colors are fixed per kind (red for emphasis and question, blue for callout, `visuals.ts:302-318`).
- Layer toggle: `layers` is private and there is a single `ann` group for emphasis, question and callout (`engine.ts:65, 386`). Toggling only bubbles needs a new layer key plus a `layerOf` branch. The engine's public surface has no visibility control (`setPaused`, `setFollow`, `exportSvg`, `reset`, `engine.ts:108, 191-209`) and there is no UI control; `BoardApp.tsx:44` constructs the engine, so the toggle state would live in React and be pushed in.
- Camera and hidden layers: `draw` calls `setFocus` and updates `lastActive` (`engine.ts:128-129`) regardless of the layer, so the camera would follow invisible drawing unless draw skips focus for hidden layers. `bounds` includes callout boxes (`layout/index.ts:97`), so hidden bubbles would still affect the framing.
- Export: a hidden layer exports hidden (`svg-export.ts:2-4, 15-17`). Whether the export should include bubbles is open.
- Click handling: the engine's pointer handlers are pan and zoom only (`engine.ts:415-442`); expanding a marker by click is new hit-testing.
- Prompt and contract side: a new annotation type needs a board-text section (`serialize.ts:51-58`), op schema and tool description (`ops.ts:134, 171`), `parse.ts` catalog sets, the server prompt (`apps/server/src/prompt/*`) and session record replay (`packages/contract/src/record.ts`).

**Change size (rough)**
- Speech bubble as a callout variant (frame + tail, same data): small-medium. A `style` field on `Callout` or a new kind in the union (`tree.ts:8`, `KIND_ORDER` `animator.ts:13`, `layerOf` `engine.ts:384-387`, `translates` `visuals.ts:153`), one new branch in `buildVisual`, a tail-target tweak in `layout/index.ts:80-95`.
- Minimized marker with expand/collapse: medium. A second visual per item and a swap; state in `data` so diff and animation are reused; click hit-testing is new.
- Togglable layer: small for show/hide of one group (new layer key, `layerOf` branch, public method, one React control); medium if camera focus, bounds, export and animation skipping while hidden must be right.
- Op/model/prompt side for a new annotation type: medium, following `add_callout` end to end (`ops.ts`, `model.ts`, `removeRefs`, `serialize.ts`, `parse.ts`, server prompt, `record.ts`, tests).

## Summary table

| Capability | Exists | Reusable | Must change | Size |
| --- | --- | --- | --- | --- |
| Pencil look | Styles centralised in `buildVisual` / `Builder.rough` | rough.js options, key-seeded stability | state field, per-kind style params | small-medium |
| Pencil -> ink animation | `drawStrokes` pen animation, in-place change precedent (`restamp`) | `hideForDraw`, `drawStrokes`, swap | new engine method, `sig` decision | medium |
| Proposal as a unit | none | `delete` + cascade (`removeRefs`) | grouping, accept/reject ops | medium |
| Erase animation | fade/shrink `remove` | `AnimationQueue` delete task | optional eraser effect, reason on task | small-medium |
| Speech bubble | callout pipeline | data shape, placement, routing, text writing | bubble frame + tail, new variant | small-medium |
| Bubble marker | `question` badge | small-badge pattern | second visual, toggle, click handling | medium |
| Togglable layer | `ann` group | one `<g>` per layer | new layer key, public API, UI, camera and export decisions | small-medium |
