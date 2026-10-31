# Grafito

A personal tool: the user talks and Claude draws the idea live on a sketch-style board. This glossary is the naming source for identifiers, files, comments and docs: when code and glossary disagree, the code gets renamed.

## Board

**Board**:
The whole drawing: its zones, elements, connections, annotations and the summary. It holds no coordinates; positions come from the layout.
_Avoid_: tablero, canvas, whiteboard, pizarra, board model

**Zone**:
A titled box on the board that holds one topic, drawn in one zone kind.
_Avoid_: zona, section, frame, group, panel

**Zone kind**:
The shape a zone draws its topic in: one of flow, system, list, compare, mindmap, scale, cycle, timeline or tree. It decides which element types the zone accepts and how it is laid out.
_Avoid_: tipo de zona, zone type, forma, template

**Flow**:
A zone kind for a step-by-step process, made of steps and decisions.
_Avoid_: flujo, proceso, process zone

**System**:
A zone kind for an architecture, made of components and their connections.
_Avoid_: sistema, arquitectura, architecture zone

**List**:
A zone kind for a plain list of items.
_Avoid_: lista

**Compare**:
A zone kind with two titled columns of items side by side.
_Avoid_: comparar, comparison, two-column zone

**Mindmap**:
A zone kind for loose ideas branching from a central node; the fallback when no other kind fits.
_Avoid_: mapa mental, mind map

**Scale**:
A zone kind for a quantity along a bar from 0 to 100, with marks for thresholds and an optional level.
_Avoid_: escala, gauge, bar zone

**Cycle**:
A zone kind whose stages sit on a ring and repeat; the last stage leads back to the first.
_Avoid_: ciclo, loop

**Timeline**:
A zone kind with events placed on a time axis and spans bracketing durations under it.
_Avoid_: línea de tiempo, línea temporal, history

**Tree**:
A zone kind for a hierarchy that grows left to right, made of branches.
_Avoid_: árbol, hierarchy zone

**Element**:
One thing drawn inside a zone, with a label and an element type. Zones, elements, connections and callouts share one id space.
_Avoid_: elemento, el, figura, item, node, shape

**Element type**:
What an element is: step, decision, component, node, item, mark, stage, event, span or branch. Each type belongs to one or two zone kinds.
_Avoid_: tipo, ElType, element kind

**Step**:
A box in a flow zone; `after` links it to the previous step.
_Avoid_: paso

**Decision**:
A diamond in a flow zone holding a question; its outcomes are connections.
_Avoid_: decisión, rombo, condition

**Component**:
A part of an architecture in a system zone, drawn by its component type.
_Avoid_: componente, box, service box

**Component type**:
How a component is drawn: actor, client, service, database, queue, storage or external.
_Avoid_: comp, component kind

**Node**:
An idea in a mindmap zone, hanging from a parent node.
_Avoid_: nodo, idea (in code)

**Item**:
A point in a list zone or in one column of a compare zone.
_Avoid_: punto, bullet, entry

**Mark**:
A threshold on a scale zone's bar, with a position, a label, an optional note and a tone. Only scale thresholds are marks.
_Avoid_: marca, umbral, tick, threshold (as a type name)

**Level**:
How far a scale zone's bar is filled; a zone has at most one.
_Avoid_: nivel, fill, progress

**Stage**:
A step on a cycle zone's ring.
_Avoid_: etapa, phase

**Event**:
A point on a timeline zone's axis, with an optional `when` text next to the tick.
_Avoid_: evento, hito, milestone

**Span**:
A bracket under a timeline zone's axis covering a duration from one position to another.
_Avoid_: tramo, llave, range, period

**Branch**:
A box in a tree zone; without a parent it is a root.
_Avoid_: rama, nodo de árbol, tree node

**Tone**:
The color meaning of a mark or span: neutral, warn, danger or ok.
_Avoid_: tono, severity, status

**Connection**:
An arrow between two elements, inside one zone or across zones, optionally labelled, dashed or two-way.
_Avoid_: conexión, conn, edge, arrow, link

**Derived connection**:
A connection implied by an element's `after` or `parent` instead of created by a `connect` op.
_Avoid_: auto connection, implicit edge, conexión implícita

**Annotation**:
A hand-drawn mark on top of the drawing that points at an element or zone: an emphasis, a question mark or a callout.
_Avoid_: marcas, marks, decoration, overlay

**Emphasis**:
An annotation that highlights its target with a circle, an underline or a star.
_Avoid_: énfasis, emph, highlight

**Question mark**:
An annotation that flags its target as open or unresolved, with optional text.
_Avoid_: pregunta, duda, question (alone)

**Callout**:
A short handwritten note with a curved arrow pointing at its target.
_Avoid_: nota, note, comment, tooltip

**Note**:
The short explanation written under the label of a mark, stage, event or branch.
_Avoid_: nota, description, subtitle

**Summary**:
One or two sentences, rewritten by Claude after every request, of everything said so far. It is part of the board and is sent back with each request.
_Avoid_: resumen, recap, context

**Zone color**:
The fill color a zone gets from its creation order; the user can name a zone by its color.
_Avoid_: hue, color index, color de zona

**Placement hint**:
An optional "right of" or "below" another zone, given when a zone is created; the only say Claude has in where things go.
_Avoid_: place, posición, coordinates

## Ops

**Op**:
One change to the board, as `{ name, input }`, that Claude emits as a tool call. Ops never carry coordinates.
_Avoid_: operación, operation, action, command

**Op name**:
Which change an op makes (`create_zone`, `add_step`, `connect`, `update_summary`…). It is also the tool name Claude sees, so it is wire format.
_Avoid_: tool name (in board code), op type

**Tool definition**:
The name, description and input schema of one op as offered to Claude; the set offered depends on the enabled icon catalogs.
_Avoid_: herramienta, schema (alone), tool spec

**Invalid op**:
An op that failed validation or could not be applied; it is skipped and reported as a warning, and the rest of the request goes on.
_Avoid_: aviso, bad op, error op

## Layout and rendering

**Layout**:
The positions and sizes computed for every zone, element and connection from a board. Nothing else stores coordinates.
_Avoid_: colocación, disposición, positions

**Render tree**:
A flat list of render items built from a board and its layout; comparing two render trees tells the animator what to draw, update, move or remove.
_Avoid_: árbol de render, scene graph, virtual DOM

**Render item**:
One drawable entry in the render tree (a zone, element, connection or annotation) with a stable key and a signature of its visual content.
_Avoid_: ítem, RItem, item (alone; that is an element type)

**Animation queue**:
The queue that plays the differences between render trees in order: draw, update, remove in sequence, moves in parallel, faster when work piles up.
_Avoid_: cola de animación, animator queue

**Engine**:
The browser side that turns render items into hand-drawn animated SVG and moves the camera.
_Avoid_: motor, renderer, sink (except as the interface name)

**Visual**:
The hand-drawn SVG of one render item, with a fixed seed so it never jitters between redraws.
_Avoid_: dibujo, drawing, sprite

## Icons

**Icon catalog**:
A provider's set of service icons (today only AWS) that the user turns on or off in the settings. With no catalog enabled, Claude is told nothing about icons.
_Avoid_: catálogo, catálogo de iconos, icon library, pack

**Catalog id**:
The short fixed name of an icon catalog (`aws`). It also prefixes stored service ids.
_Avoid_: prefijo, prefijo de catálogo, catalog prefix

**Service icon**:
The official icon of one concrete service (Lambda, Cognito, S3), shown on an element when that element is that service. It is unrelated to an element's emoji icon.
_Avoid_: icono de servicio, emoji, logo

**Service stamp**:
How a service icon appears on the board: a small tilted icon pinned to the element's top-left corner that pops in during the element's draw, or on its own after a `set_service` op.
_Avoid_: sello, badge, sticker

**Curated list**:
The services of an icon catalog that Grafito recognises (today 40 AWS services). A service outside the list is drawn without a service icon.
_Avoid_: lista curada, servicios, full catalog

**Service id**:
The short fixed name Claude uses to mark an element as a service on the curated list (`s3`, `api-gateway`). Stored on the element with its catalog id in front (`aws:s3`).
_Avoid_: id de servicio, official name, label

**Synonym**:
A spoken word that Claude should read as a given service (`bucket` for `s3`).
_Avoid_: sinónimo, alias

## Live session

**Live mode**:
The app mode where speech goes to Claude and the board draws from the ops it returns.
_Avoid_: modo Claude, claude mode, en vivo

**Demo mode**:
The app mode that plays a demo, with no Claude calls.
_Avoid_: script mode, modo guion

**Demo**:
A recorded sequence of timed chunks (spoken text plus its ops) that plays on the board without Claude.
_Avoid_: script, guion, recording

**Live session**:
One run of live mode, from start to reset: it turns fragments into requests, keeps one request in flight and feeds the returned ops to the board.
_Avoid_: sesión, prueba, conversation

**Fragment**:
A piece of finished text entering the live session: grouped speech results or typed text. The wake word splits it into content and an instruction.
_Avoid_: fragmento, final, chunk, utterance

**Wake word**:
The word "Grafito" said aloud; what follows it is an instruction for Claude, not content.
_Avoid_: palabra de activación, hotword, trigger word

**Mode**:
Whether a request carries content or an instruction.
_Avoid_: modo, kind, TextKind, BoardMode

**Content**:
Speech about the topic, which Claude draws.
_Avoid_: contenido, dictation, talk

**Instruction**:
A spoken order about the drawing itself ("make this a tree", "delete that"), which Claude applies to what is already on the board and never draws.
_Avoid_: instrucción, orden, command, prompt

**Batch**:
The text sent in one request: consecutive content fragments joined together, or one instruction alone.
_Avoid_: delta, lote, tanda, buffer

**Request**:
One call to Claude for one batch, with its ops, timings, usage, cost and invalid ops.
_Avoid_: petición, log entry, turn, call

**Undo**:
Reverting the last applied instruction; content requests cannot be undone.
_Avoid_: deshacer, rollback

**Shape preference**:
The user's preferred zone kind for new zones, or "auto" to let Claude choose.
_Avoid_: forma, forma del dibujo, shape (alone), style

**Board text**:
The compact plain-text form of the board (no coordinates) sent to Claude with every request.
_Avoid_: serialización, serialized board, snapshot

**Transcript**:
Every finished speech result of a live session, in order, with its time.
_Avoid_: transcripción, subtitles, log

**Session record**:
The saved file of a live session: Claude model, shape preference, language, requests, transcript and summary. It can be exported, imported and restored.
_Avoid_: registro, registro de sesión, prueba, log, save file

**Claude model**:
Which Claude model answers the requests, chosen by the user.
_Avoid_: modelo, model (alone; it collides with the board)
