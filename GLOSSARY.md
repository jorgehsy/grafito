# Grafito

A personal tool: the user talks and Claude draws the idea live on a sketch-style board. This glossary is the naming source for identifiers, files, comments and docs: when code and glossary disagree, the code gets renamed.

## Board

**Board**:
The whole drawing: its zones, elements, connections, annotations and the summary. It holds no coordinates; positions come from the layout.
_Avoid_: tablero, canvas, whiteboard, pizarra, board model

**Zone**:
A titled box on the board that holds one topic, drawn in one zone kind.
_Avoid_: zona, section, frame, panel; a group is something else (see Group)

**Zone kind**:
The shape a zone draws its topic in: one of flow, system, list, compare, mindmap, scale, cycle, timeline, tree or data. It decides which element types the zone accepts and how it is laid out.
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

**Data**:
A zone kind for a data model, made of entities and the relations between them.
_Avoid_: datos, ER diagram, schema zone, model (alone; it collides with the Claude model), table zone

**Element**:
One thing drawn inside a zone, with a label and an element type. Zones, elements, connections and callouts share one id space.
_Avoid_: elemento, el, figura, item, node, shape

**Element type**:
What an element is: step, decision, component, node, item, mark, stage, event, span, branch or entity. Each type belongs to one or two zone kinds.
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

**Group**:
An AWS boundary box inside a system zone that holds components and other groups: AWS Cloud, Region, VPC, Availability Zone, public or private subnet, or a generic one. Groups nest; each component and each group has at most one parent group. Arrows never join a group, and deleting one keeps what was inside it.
_Avoid_: container (an ECS or Docker container is a component), box, boundary, zone

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

**Entity**:
A table of a data model in a data zone: a box with its name on top and one row per field.
_Avoid_: entidad, table (in code), model, class

**Field**:
One row of an entity: a name, an optional type and an optional key mark (`pk` for the primary key, `fk` for a foreign key).
_Avoid_: campo, column (that is a side of a compare zone), attribute, property

**Relation**:
A connection between two entities that carries a cardinality (one to one, one to many, many to one, many to many), drawn with crow's-foot ends instead of an arrowhead. Made by `relate`; a plain `connect` between entities is still an arrow.
_Avoid_: relación, relationship, foreign key (that is a field), association

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

**Zone direction**:
Which way the arrows run in a flow or system zone: horizontal (left to right, peers stacked in a column) or vertical (top to bottom, peers side by side in a row). Claude gives it when a zone is created, from the meaning; without it the layout picks one from the shape of the graph (a long chain is horizontal, a fan of peers wider than it is deep is vertical).
_Avoid_: orientation, rankdir, aspect

**Placement hint**:
An optional "right of" or "below" another zone, given when a zone is created; the only say Claude has in where things go.
_Avoid_: place, posición, coordinates

## Sketch

**Sketch**:
What people draw by hand on top of the board: a set of strokes kept beside the board, in board coordinates. It is not part of the board. Handing it in asks Claude to turn it into board elements.
_Avoid_: drawing (the board is a drawing too), doodle, freehand layer, ink layer

**Stroke**:
One line drawn with the pen without lifting it, with its author and colour.
_Avoid_: trazo, path, line (a line is one of the shapes a stroke can have)

**Kept stroke**:
A stroke that stays as drawn after it was handed in, because Claude made nothing of it. It is not sent again.
_Avoid_: ink (that is architect mode's approved look), leftover, annotation

**Draw dock**:
The floating bar at the top of the board with the hand, pen, eraser, inks and the button that hands in the sketch.
_Avoid_: toolbar (that is the left bar), palette

## Rooms

**Room**:
One board shared by several people, each in their own browser, reached by a link. The server keeps its event log and makes its Claude calls.
_Avoid_: sala, session (a live session is one browser's run), channel, workspace

**Participant**:
Someone in a room, with a name and a colour. Claude is always one of them.
_Avoid_: user, member, peer, collaborator

**Room event**:
One entry in a room's log: something said, an op, a stroke, an erase, a Claude request starting or ending, a reset. Every browser applies the same events in the same order.
_Avoid_: message (that is one kind of event), action, update

**Feed**:
The list in a room of who said or drew what and what Claude answered.
_Avoid_: chat, log, timeline (a zone kind), history

**Invite token**:
The secret a room is made with and a browser must present to join it. It travels in the room link's fragment (`#k=`), never in a request URL. The room id alone opens nothing.
_Avoid_: password, key (the API key is the owner's), room secret, access code

**Room link**:
What a participant is sent to join a room: the page's address with `?room=<id>#k=<invite token>`.
_Avoid_: invite, share URL, public address (that is the tunnel's, and opens no room by itself)

**Share mode**:
The server run by `pnpm share`: one port for the page, the API and the room sockets, reachable from outside through a tunnel, with owner and guest told apart.
_Avoid_: public mode, production, hosted

**Owner**:
The person whose machine runs the server and whose API key pays. In share mode, the browser that opened the owner link; it may use everything.
_Avoid_: admin, host (that is a network name), user

**Guest**:
In share mode, anyone who is not the owner. A guest can load the page and join a room they hold the invite token of, nothing else. Inside the room a guest is a participant like any other.
_Avoid_: visitor, anonymous, viewer (a guest can talk and draw)

**Owner link**:
The address the server prints in its terminal in share mode. Opened on the owner's machine, it marks that browser as the owner's. It works once, and not through the tunnel; a restart prints a new one.
_Avoid_: admin URL, login

**Resume secret**:
What the server gives a browser tab when it joins a room, and the tab presents to come back as the same participant after a drop or a reload. The server makes participant ids; a browser cannot choose one.
_Avoid_: session id, participant token, pid

**Room cap**:
The most a room may spend on Claude in its whole life, in requests and in dollars. Past it, Claude no longer answers in that room; drawing by hand still works.
_Avoid_: quota, budget, rate limit (that is per minute or per connection)

## Ops

**Op**:
One change to the board, as `{ name, input }`, that Claude emits as a tool call. Ops never carry coordinates.
_Avoid_: operación, operation, action, command

**Op name**:
Which change an op makes (`create_zone`, `add_step`, `connect`, `update_summary`…). It is also the tool name Claude sees, so it is wire format.
_Avoid_: tool name (in board code), op type

**Tool definition**:
The name, description and input schema of one op as offered to Claude; the set offered depends on the app mode (live mode and architect mode each have their own op set) and on the enabled icon catalogs.
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

**Hi-fi export**:
The board exported as a clean diagram for a document or a slide: the same render tree and layout as the board, drawn with straight lines, crisp boxes, a system sans font, full-colour service icons and a title block instead of the hand-drawn look. An open proposal is drawn grey and dashed, with a legend.
_Avoid_: clean export, pro export, final render

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
The app mode that plays a demo or a replay, with no Claude calls.
_Avoid_: script mode, modo guion

**Architect mode**:
The app mode where the user and Claude design an AWS architecture together, following the AWS Well-Architected Framework: Claude asks, suggests and pushes back in speech bubbles while it draws on the board. Separate from live mode.
_Avoid_: design mode, chat mode, modo arquitecto, conversation mode

**Speech bubble**:
A short comic-style balloon drawn over the board that carries what Claude says to the user in architect mode. Short, concrete and blunt; never a full explanation. One with a target (a component, group, arrow or proposal) sits beside it with a tail pointing at it; one without, or whose target is gone, is a **general bubble** in the top-right corner.
_Avoid_: burbuja, chat message, reply, tooltip, callout (a callout is an annotation)

**Bubble marker**:
What a speech bubble shrinks to once the next turn starts: a small round marker on the **timeline rail**, the slim strip just above the text box with one marker per turn (muted for a turn that said nothing). Hovering or focusing a marker shows its text, clicking it reopens the bubble, and clicking the rail itself shows or hides every past bubble.
_Avoid_: pin, dot, badge, comment marker

**Turn**:
One user message in architect mode (with any approvals or rejections clicked since the last one) and Claude's answer to it: one speech bubble with at most one question, plus the ops it draws.
_Avoid_: turno, message, exchange, round

**Proposal**:
Something Claude draws in pencil in architect mode on its own initiative (what the user explicitly asks for goes straight to ink), waiting for the user to approve it (it turns to ink) or reject it (it is erased), by typing or with the ✓/✗ toolbar a click on it shows. Alternatives are two proposals drawn side by side (at most 2); keeping one erases the other, and clicking one keeps it. An arrow with a pencil end is pencil under that end's proposal, so ink never depends on an unanswered one. The board text tags its items `[pencil P3]` and lists the open ones under `PROPOSALS`.
_Avoid_: propuesta, draft, suggestion, pending element

**Ink**:
The normal look of an approved part of the board, as opposed to the pencil look of a proposal.
_Avoid_: tinta, final, committed

**Pillar review**:
The architect's check of the design against the six Well-Architected pillars, done in one turn when the user asks for it (or accepts Claude's offer): each pillar gets a status (covered, partial or gap) with one sentence of why, and each risk becomes a finding. It is kept beside the board, never on it, and rebuilt from the session's ops like the bubbles are; later turns keep it true.
_Avoid_: audit, assessment, WA report, checklist

**Finding**:
One risk the pillar review reports: a pillar, a severity (high, medium or low), one plain sentence, usually the board item it is about and the best practice it comes from. Open until a change to the design resolves it. In the **review panel** (the instrument on the right in architect mode) findings are listed worst first; clicking one outlines its item on the board, where a numbered **pin** marks it.
_Avoid_: issue, risk item, warning (a warning is a skipped op), gap (a gap is a pillar status)

**Sketch turn**:
A turn of architect mode whose message is a sketch: the draw dock hands the ink to the architect (described in text, with its picture) instead of to live mode. What the ink shows counts as asked for, so it becomes ink; the strokes are removed once Claude draws from them.
_Avoid_: sketch request (that is live mode's), drawing turn

**Well-Architected digest**:
The short summary of the AWS Well-Architected Framework that Claude works from in architect mode: the pillars, design principles, and every question and best-practice title with its ID. Claude follows it; it never quotes AWS text.
_Avoid_: WA summary, guidance, rulebook, lens

**Demo**:
A recorded sequence of timed chunks (spoken text plus its ops, and sometimes hand-drawn strokes) that plays on the board without Claude.
_Avoid_: script, guion, recording

**Chapter**:
A named stretch of a demo that the player can jump to. A chunk with a title starts one; in a demo with no titles every chunk is a chapter, named after its first words.
_Avoid_: section, scene, step

**Seek**:
Moving the player to another moment of a demo. The board of that moment is rebuilt from an empty one and shown at once, with no animation, so the result depends only on the moment and never on where the player was.
_Avoid_: scrub, jump, rewind

**Replay**:
A session record played back as a demo: each request (or architect turn) is a chunk and a chapter, at the demo's pace and not the session's real clock. Undone instructions are left out.
_Avoid_: playback, restore (restoring reopens the session to keep working on it)

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

**Architect session**:
One run of architect mode, from start to reset: a sequence of turns and the approvals or rejections clicked between them.
_Avoid_: sesión de arquitecto, design session, conversation

**Architect scenario**:
A scripted architect session used to eval prompt changes: a list of steps, each a user message or a click named by meaning (accept or reject all or the newest, choose alternative A or B), some with expectations about the turn that follows. It may begin with a scripted start turn that sets up the board without calling Claude.
_Avoid_: test conversation, script, fixture

**Session record**:
The saved file of a live session or an architect session, tagged with its app mode; it always reopens in that mode. A live record holds the Claude model, shape preference, language (`speechLang`), requests (each with its batch, ops, warnings and prompt version), transcript and summary. An architect record holds its turns and clicks in the order they happened, and the summary. It can be exported, imported and restored by replaying it. Version 3; version 2 records open as live records, version 1 records (0.2.0-alpha.4 and earlier) are rejected.
_Avoid_: registro, registro de sesión, prueba, log, save file

**Claude model**:
Which Claude model answers the requests, chosen by the user.
_Avoid_: modelo, model (alone; it collides with the board)

**Provider**:
Where a Claude model runs and how it is billed: `anthropic-api` (the API, paid per token) or `claude-subscription` (the owner's Claude plan, local only). Every model has one, and the server has one adapter per provider.
_Avoid_: backend, vendor, source

**Plan model**:
A Claude model served by the `claude-subscription` provider, with an id ending in `@subscription`. It has no price; its cost is shown as "included in plan".
_Avoid_: subscription model, free model
