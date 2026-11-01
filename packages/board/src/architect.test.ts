import { describe, expect, it } from "vitest";
import { op } from "@grafito/contract";
import { ARCHITECT_ZONE_ID, architectZoneOp } from "./architect";
import { applyOps, emptyBoard } from "./model";

describe("architect board", () => {
  it("starts with one system zone that Claude's components can go into", () => {
    const r = applyOps(emptyBoard(), [architectZoneOp("Architecture"), op.add_component({ zone: ARCHITECT_ZONE_ID, id: "bucket", label: "Bucket", type: "storage" })]);
    expect(r.warnings).toEqual([]);
    expect(r.board.zones).toEqual([{ id: "system", kind: "system", title: "Architecture", n: 0 }]);
    expect(r.board.elements.map((e) => e.zone)).toEqual(["system"]);
  });
});
