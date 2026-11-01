import { describe, expect, it } from "vitest";
import { ARCHITECT_ZONE_ID, applyOps, emptyBoard } from "@grafito/board";
import { op } from "@grafito/contract";
import type { Board } from "@grafito/board";
import { createArchitectSession } from "./session";

function harness(start: Board = emptyBoard()) {
  let board = start;
  const session = createArchitectSession({
    board: { submit: async (ops) => { board = applyOps(board, ops).board; }, clear: () => { board = emptyBoard(); } },
    zoneTitle: () => "Architecture",
  });
  return { session, board: () => board };
}

describe("architect session", () => {
  it("starts on a blank board with only the app-made system zone", async () => {
    const left = applyOps(emptyBoard(), [op.create_zone({ id: "f", kind: "flow", title: "Live leftovers" })]).board;
    const h = harness(left);
    h.session.start();
    await Promise.resolve();
    expect(h.board().zones).toEqual([expect.objectContaining({ id: ARCHITECT_ZONE_ID, kind: "system", title: "Architecture" })]);
    expect(h.board().elements).toEqual([]);
  });
});
