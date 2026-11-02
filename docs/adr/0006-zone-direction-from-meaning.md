# A flow or system zone's direction comes from its meaning

Status: accepted

The layered layout of a flow or system zone runs either left to right or top to bottom, and the direction decides which elements line up: ELK puts the elements of one layer in a column when it runs left to right and in a row when it runs top to bottom. Until now the layout chose by size: left to right, unless that was wider than 1000px, in which case it also tried top to bottom and kept whichever was closer to a 1.6 width/height ratio (always, once a zone had groups). The result depended on label lengths and a screen-shaped constant, not on what the diagram said, and in practice most diagrams came out top to bottom with the width unused.

We decided:

- **Claude gives the direction from the meaning.** `create_zone` takes an optional `direction` (`horizontal` | `vertical`) for flow and system zones: horizontal for a sequence, vertical for layers or a fan-out of peers. It is stored on the zone and shown in the board text. Other zone kinds ignore it with a warning.
- **Without it, the layout uses the shape of the graph.** Depth (longest path, skipping arrows back to an earlier element) against breadth (most elements at one depth): wider than deep is top to bottom, otherwise left to right. No pixel sizes take part.
- The size-based choice (`TARGET_ASPECT`, `MAX_RIGHT_W`) is removed.

Considered: making the target ratio follow the real screen (still a size rule, and the same diagram would flip between devices); the shape rule alone (cannot tell a sequence of three from three layers); Claude alone with no fallback (old saved sessions and architect mode's pre-made zone have no direction).

## Consequences

- The board prompt and tool definitions change, so `PROMPT_VERSION` goes to 3. Architect mode does not get `create_zone`, so its prompt version stays.
- Changing the direction of an existing zone is done by recreating the zone, as for any change of representation.
