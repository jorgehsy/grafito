# A room is an event log the server keeps, and the server calls Claude

Status: accepted

Several people should work on one board at once, each talking, typing and drawing, with Claude as one more participant. Until now the browser owned everything: it called Claude, applied the ops and kept the record. Two browsers doing that against the same board would send Claude two different boards at once and get ops that contradict each other.

We decided:

- **The server keeps one ordered event log per room** (`packages/contract/src/room.ts`): what people said, every op, every stroke and erase, each Claude request and its end. Every browser applies the same events in the same order, so every browser shows the same board. Someone who joins late, or reconnects, gets the log and replays it.
- **The server makes the Claude calls for a room.** It holds the room's board (the same pure `applyOp`), queues what everyone says, keeps one request in flight and joins the content that arrives meanwhile into one batch, each fragment with its speaker's name. Claude's ops are logged as they stream.
- **Claude is a participant.** It is in every room's presence list with a status (idle, thinking, drawing), and in a room it gets one extra tool, `say`, to answer a direct question or settle a contradiction between two people. The `room` op set is the board set plus `say`.
- **Pointers and strokes in progress are not logged.** They are sent to the others and forgotten.
- **Working alone does not change.** Live mode without a room still runs in the browser, with its record, undo and eval. A room session offers the browser the same `LiveSession` interface, so the UI does not know which one it has.
- **Transport is one WebSocket per browser**, since cursors and growing strokes are many small messages both ways.

Considered: every browser calling Claude and sharing the ops (concurrent requests on diverging boards); a CRDT (the board is a small op log with one writer of meaning, Claude: ordering by the server is enough); moving solo live mode to the server too (a large rewrite of the session, record and eval for no gain to someone working alone).

## Consequences

- Rooms live in the server's memory and are saved to `apps/server/rooms/`; a room is gone when that file is.
- There is no undo in a room, and a room has no login: whoever has the link is in. It is meant for a team's own network. (Since [ADR 0009](0009-rooms-over-a-tunnel.md) a room has an invite token and can be reached from outside through a tunnel.)
- A room's cost is the server's key's cost; every participant sees it.
