import { describe, expect, it } from "vitest";
import { ARCHITECT_ZONE_ID, applyOps, architectDataZoneOp, architectZoneOp, emptyBoard, emptyReview, reviewOf } from "@grafito/board";
import { op } from "@grafito/contract";
import { findingKeys, listedFindings, PIN, pinSpot, reviewStats, targetLabel } from "./review";

const Z = ARCHITECT_ZONE_ID;
const board = applyOps(emptyBoard(), [
  architectZoneOp("Architecture"),
  op.add_group({ id: "vpc", kind: "vpc", label: "VPC" }),
  op.add_component({ zone: Z, id: "api", label: "API", type: "service", parent: "vpc" }),
  op.add_component({ zone: Z, id: "db", label: "Orders DB", type: "database" }),
  op.connect({ id: "c1", from: "api", to: "db" }),
  op.connect({ id: "c2", from: "api", to: "db", label: "writes" }),
  op.propose({ id: "P1", label: "Cache" }),
  op.add_component({ zone: Z, id: "cache", label: "Cache", type: "service", proposal: "P1" }),
  architectDataZoneOp("Data model"),
  op.add_entity({ zone: "data", id: "orders", name: "orders" }),
]).board;

const review = reviewOf([
  op.assess_pillar({ pillar: "REL", status: "gap", note: "One of everything." }),
  op.assess_pillar({ pillar: "SEC", status: "partial", note: "No auth." }),
  op.add_finding({ id: "F1", pillar: "SEC", severity: "low", text: "a", target: "api" }),
  op.add_finding({ id: "F2", pillar: "REL", severity: "high", text: "b", target: "db" }),
  op.add_finding({ id: "F3", pillar: "REL", severity: "medium", text: "c" }),
  op.add_finding({ id: "F4", pillar: "COST", severity: "high", text: "d", target: "gone" }),
  op.resolve_finding({ id: "F4" }),
]);

describe("reviewStats", () => {
  it("has all six pillars in framework order, assessed or not, with their open findings", () => {
    const s = reviewStats(review);
    expect(s.pillars.map((p) => [p.pillar, p.status, p.findings])).toEqual([["OPS", null, 0], ["SEC", "partial", 1], ["REL", "gap", 2], ["PERF", null, 0], ["COST", null, 0], ["SUS", null, 0]]);
    expect(s.pillars[2].note).toBe("One of everything.");
    expect(s).toMatchObject({ assessed: 2, open: 3, resolved: 1, worst: "high", bySeverity: { high: 1, medium: 1, low: 1 } });
  });
  it("an empty review has nothing assessed and no worst severity", () => {
    expect(reviewStats(emptyReview())).toMatchObject({ assessed: 0, open: 0, resolved: 0, worst: null, bySeverity: { high: 0, medium: 0, low: 0 } });
  });
  it("the worst severity follows what is still open", () => {
    expect(reviewStats(reviewOf([op.resolve_finding({ id: "F2" })], review)).worst).toBe("medium");
  });
});

describe("listedFindings", () => {
  it("numbers the open findings worst first; a pillar filter keeps the numbers", () => {
    expect(listedFindings(review).map((x) => [x.n, x.finding.id])).toEqual([[1, "F2"], [2, "F3"], [3, "F1"]]);
    expect(listedFindings(review, "SEC").map((x) => [x.n, x.finding.id])).toEqual([[3, "F1"]]);
    expect(listedFindings(review, "OPS")).toEqual([]);
  });
});

describe("what a finding points at", () => {
  it("a component, group, connection or entity by its key; a proposal by its items; nothing for no target or a gone one", () => {
    expect(findingKeys(board, { target: "db" })).toEqual(["db"]);
    expect(findingKeys(board, { target: "vpc" })).toEqual(["vpc"]);
    expect(findingKeys(board, { target: "c1" })).toEqual(["c1"]);
    expect(findingKeys(board, { target: "orders" })).toEqual(["orders"]);
    expect(findingKeys(board, { target: "P1" })).toEqual(["cache"]);
    expect(findingKeys(board, { target: "gone" })).toEqual([]);
    expect(findingKeys(board, {})).toEqual([]);
    expect(findingKeys(board, { target: Z })).toEqual([]);
  });
  it("is called by its label; an arrow by its label or its two ends", () => {
    expect(targetLabel(board, "db")).toBe("Orders DB");
    expect(targetLabel(board, "vpc")).toBe("VPC");
    expect(targetLabel(board, "orders")).toBe("orders");
    expect(targetLabel(board, "c1")).toBe("API → Orders DB");
    expect(targetLabel(board, "c2")).toBe("writes");
    expect(targetLabel(board, "gone")).toBeNull();
    expect(targetLabel(board, undefined)).toBeNull();
  });
});

describe("pinSpot", () => {
  it("centres the pin on the item's top-left corner; the pins of one item sit side by side", () => {
    expect(pinSpot({ left: 100, top: 50 }, 0)).toEqual({ left: 100 - PIN / 2, top: 50 - PIN / 2 });
    expect(pinSpot({ left: 100, top: 50 }, 2).left - pinSpot({ left: 100, top: 50 }, 1).left).toBe(PIN + 2);
    expect(pinSpot({ left: 100.4, top: 50.6 }, 0)).toEqual({ left: 89, top: 40 });
  });
});
