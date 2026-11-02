import { describe, expect, it } from "vitest";
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { ARCHITECT_ZONE_ID, architectZoneOp } from "./architect";
import { alternativesOf, applyOp, applyOps, emptyBoard, openProposals } from "./model";
import type { Board } from "./model";
import { serializeBoard } from "./serialize";
import { computeLayout } from "./layout";
import { buildTree } from "./tree";
import { diffTrees } from "./animator";

const Z = ARCHITECT_ZONE_ID;
const comp = (id: string, type: "service" | "database" | "storage", proposal?: string, parent?: string): Op =>
  op.add_component({ zone: Z, id, label: id, type, ...(proposal ? { proposal } : {}), ...(parent ? { parent } : {}) });
const conn = (id: string, from: string, to: string, proposal?: string): Op => op.connect({ id, from, to, ...(proposal ? { proposal } : {}) });

function run(ops: Op[], from: Board = emptyBoard()): Board {
  const r = applyOps(from, ops);
  expect(r.warnings).toEqual([]);
  return r.board;
}

/** "Let's build a React webpage": Route 53 -> CloudFront -> S3, all Claude's own idea (P1). */
const staticSite = (): Board =>
  run([
    architectZoneOp("Architecture"),
    op.propose({ id: "P1", label: "Static site" }),
    comp("dns", "service", "P1"),
    comp("cdn", "service", "P1"),
    comp("site", "storage", "P1"),
    conn("c1", "dns", "cdn", "P1"),
    conn("c2", "cdn", "site", "P1"),
  ]);

/** An API in ink (the user asked for it) with two database alternatives: P2 (A) and P3 (B). */
const twoDatabases = (): Board =>
  run([
    architectZoneOp("Architecture"),
    comp("api", "service"),
    op.propose({ id: "P2", label: "Relational" }),
    comp("rds", "database", "P2"),
    conn("c1", "api", "rds", "P2"),
    op.propose({ id: "P3", label: "Key-value", alternative_to: "P2" }),
    comp("ddb", "database", "P3"),
    conn("c2", "api", "ddb", "P3"),
  ]);

const ids = (b: Board) => ({
  elements: b.elements.map((e) => e.id),
  groups: b.groups.map((g) => g.id),
  connections: b.connections.map((c) => c.id),
  proposals: b.proposals.map((p) => p.id),
});

describe("proposals: propose", () => {
  it("opens a proposal; drawing ops that name it are pencil, those that do not are ink", () => {
    const b = run([comp("api", "service")], staticSite());
    expect(b.proposals).toEqual([{ id: "P1", label: "Static site" }]);
    expect(b.elements.map((e) => [e.id, e.proposal ?? null])).toEqual([["dns", "P1"], ["cdn", "P1"], ["site", "P1"], ["api", null]]);
    expect(b.connections.every((c) => c.proposal === "P1")).toBe(true);
  });

  it("groups can be proposed too", () => {
    const b = run([op.propose({ id: "P1", label: "Private network" }), op.add_group({ id: "vpc", kind: "vpc", label: "VPC", proposal: "P1" }), comp("db", "database", "P1", "vpc")], run([architectZoneOp("A")]));
    expect(b.groups).toEqual([{ id: "vpc", zone: Z, kind: "vpc", label: "VPC", proposal: "P1" }]);
    expect(b.elements[0]).toMatchObject({ id: "db", group: "vpc", proposal: "P1" });
  });

  it("a proposal id cannot reuse a taken id, and a drawn id cannot reuse a proposal's", () => {
    const b = staticSite();
    expect(applyOp(b, op.propose({ id: "P1", label: "Again" })).warnings).toEqual(["propose: id 'P1' already exists"]);
    expect(applyOp(b, op.propose({ id: "cdn", label: "X" })).warnings).toEqual(["propose: id 'cdn' already exists"]);
    expect(applyOp(b, comp("P1", "service")).warnings).toEqual(["add_component: id 'P1' already exists"]);
  });

  it("a drawing op naming a proposal that is not open is not drawn", () => {
    const b = staticSite();
    for (const o of [comp("x", "service", "P9"), op.add_group({ id: "g", kind: "vpc", label: "VPC", proposal: "P9" }), conn("c9", "dns", "site", "P9")]) {
      const r = applyOp(b, o);
      expect(r.board).toBe(b);
      expect(r.warnings).toEqual([`${o.name}: proposal 'P9' is not open; not drawn`]);
    }
  });

  it("alternative_to pairs two open proposals; a third one or an unknown id opens on its own with a warning", () => {
    const b = twoDatabases();
    expect(b.proposals).toEqual([{ id: "P2", label: "Relational" }, { id: "P3", label: "Key-value", alternativeTo: "P2" }]);
    expect(alternativesOf(b, "P2")).toEqual(["P2", "P3"]);
    expect(alternativesOf(b, "P3")).toEqual(["P2", "P3"]);
    const third = applyOp(b, op.propose({ id: "P4", label: "Document", alternative_to: "P3" }));
    expect(third.warnings).toEqual(["propose: 'P3' already has an alternative (at most 2 side by side); P4 opens on its own"]);
    expect(third.board.proposals.at(-1)).toEqual({ id: "P4", label: "Document" });
    const unknown = applyOp(b, op.propose({ id: "P4", label: "Cache", alternative_to: "P9" }));
    expect(unknown.warnings).toEqual(["propose: 'P9' is not an open proposal; P4 opens on its own"]);
    expect(alternativesOf(unknown.board, "P4")).toEqual(["P4"]);
  });

  it("openProposals lists them in order with their alternatives", () => {
    const b = run([op.propose({ id: "P4", label: "Cache" })], twoDatabases());
    expect(openProposals(b)).toEqual([
      { id: "P2", label: "Relational", alternatives: ["P2", "P3"] },
      { id: "P3", label: "Key-value", alternatives: ["P2", "P3"] },
      { id: "P4", label: "Cache", alternatives: [] },
    ]);
  });
});

describe("proposals: accept", () => {
  it("turns everything drawn under it to ink and closes it", () => {
    const b = run([op.accept({ proposal: "P1" })], staticSite());
    expect(ids(b)).toEqual({ elements: ["dns", "cdn", "site"], groups: [], connections: ["c1", "c2"], proposals: [] });
    expect([...b.elements, ...b.connections].some((x) => "proposal" in x)).toBe(false);
  });

  it("accepting one alternative erases the other, with its arrows", () => {
    const b = run([op.accept({ proposal: "P3" })], twoDatabases());
    expect(ids(b)).toEqual({ elements: ["api", "ddb"], groups: [], connections: ["c2"], proposals: [] });
    const a = run([op.accept({ proposal: "P2" })], twoDatabases());
    expect(ids(a)).toEqual({ elements: ["api", "rds"], groups: [], connections: ["c1"], proposals: [] });
  });

  it("leaves other open proposals alone", () => {
    const b = run([op.propose({ id: "P4", label: "Cache" }), comp("cache", "database", "P4"), op.accept({ proposal: "P2" })], twoDatabases());
    expect(ids(b).proposals).toEqual(["P4"]);
    expect(b.elements.find((e) => e.id === "cache")!.proposal).toBe("P4");
  });

  it("an unknown or closed proposal is a warning and changes nothing", () => {
    const b = staticSite();
    const r = applyOp(b, op.accept({ proposal: "P9" }));
    expect(r).toEqual({ board: b, warnings: ["accept: proposal 'P9' is not open"] });
    const closed = run([op.accept({ proposal: "P1" })], b);
    expect(applyOp(closed, op.accept({ proposal: "P1" })).warnings).toEqual(["accept: proposal 'P1' is not open"]);
  });
});

describe("proposals: reject", () => {
  it("erases everything drawn under it, and ink arrows touching it", () => {
    const b = run([comp("api", "service"), conn("c3", "api", "cdn"), op.reject({ proposal: "P1" })], staticSite());
    expect(ids(b)).toEqual({ elements: ["api"], groups: [], connections: [], proposals: [] });
  });

  it("rejecting one alternative leaves the other open, on its own", () => {
    const b = run([op.reject({ proposal: "P2" })], twoDatabases());
    expect(ids(b)).toEqual({ elements: ["api", "ddb"], groups: [], connections: ["c2"], proposals: ["P3"] });
    expect(b.proposals).toEqual([{ id: "P3", label: "Key-value" }]);
    expect(alternativesOf(b, "P3")).toEqual(["P3"]);
  });

  it("erases proposed groups; ink inside them moves up to the group's parent", () => {
    const b = run([
      architectZoneOp("A"),
      op.add_group({ id: "vpc", kind: "vpc", label: "VPC" }),
      op.propose({ id: "P1", label: "Two AZs" }),
      op.add_group({ id: "az1", kind: "availability_zone", label: "AZ a", parent: "vpc", proposal: "P1" }),
      op.add_group({ id: "sub", kind: "private_subnet", label: "Private", parent: "az1", proposal: "P1" }),
      comp("db", "database", undefined, "sub"),
      comp("standby", "database", "P1", "az1"),
      op.reject({ proposal: "P1" }),
    ]);
    expect(ids(b)).toEqual({ elements: ["db"], groups: ["vpc"], connections: [], proposals: [] });
    expect(b.elements[0].group).toBe("vpc");
  });

  it("an unknown proposal is a warning and changes nothing", () => {
    const b = staticSite();
    expect(applyOp(b, op.reject({ proposal: "P9" }))).toEqual({ board: b, warnings: ["reject: proposal 'P9' is not open"] });
  });

  it("a closed proposal's id can open again, with no stale alternative link", () => {
    const b = run([op.reject({ proposal: "P2" }), op.propose({ id: "P2", label: "Again" })], twoDatabases());
    expect(alternativesOf(b, "P2")).toEqual(["P2"]);
    expect(alternativesOf(b, "P3")).toEqual(["P3"]);
  });
});

describe("proposals: board text", () => {
  it("tags pencil items and lists the open proposals, alternatives as A and B", () => {
    const b = run([op.propose({ id: "P4", label: "Private network" }), op.add_group({ id: "vpc", kind: "vpc", label: "VPC", proposal: "P4" })], twoDatabases());
    const text = serializeBoard(b);
    expect(text).toContain('- vpc [vpc] "VPC" @system [pencil P4]');
    expect(text).toContain('- api (component/service) "api" @system\n');
    expect(text).toContain('- rds (component/database) "rds" @system [pencil P2]');
    expect(text).toContain("- c2: api -> ddb [pencil P3]");
    expect(text.split("PROPOSALS\n")[1]).toBe(
      '- P2 "Relational" (A; alternative to P3)\n- P3 "Key-value" (B; alternative to P2)\n- P4 "Private network"',
    );
  });

  it("has no PROPOSALS section and no tags once everything is answered", () => {
    const text = serializeBoard(run([op.accept({ proposal: "P2" })], twoDatabases()));
    expect(text).not.toMatch(/PROPOSALS|pencil/);
  });
});

describe("proposals: render tree and layout", () => {
  it("pencil is in the item data, not in sig: accepting is an ink task, not a redraw", async () => {
    const before = staticSite();
    const after = run([op.accept({ proposal: "P1" })], before);
    const t0 = buildTree(before, await computeLayout(before));
    const t1 = buildTree(after, await computeLayout(after));
    for (const key of ["dns", "cdn", "site", "c1", "c2"]) {
      expect(t0.map.get(key)!.data.pencil).toBe(true);
      expect(t1.map.get(key)!.data.pencil).toBeUndefined();
      expect(t1.map.get(key)!.sig).toBe(t0.map.get(key)!.sig);
    }
    expect(t0.map.get(Z)!.data.pencil).toBeUndefined();
    const diff = diffTrees(t0, t1);
    expect(diff.sequential).toEqual(["dns", "cdn", "site", "c1", "c2"].map((key) => ({ kind: "ink", key })));
  });

  it("rejecting is a delete task: the existing fade", async () => {
    const before = staticSite();
    const after = run([op.reject({ proposal: "P1" })], before);
    const diff = diffTrees(buildTree(before, await computeLayout(before)), buildTree(after, await computeLayout(after)));
    expect(diff.sequential).toEqual([{ kind: "delete", keys: ["dns", "cdn", "site", "c1", "c2"] }]);
  });

  it("proposed groups are pencil too", async () => {
    const b = run([architectZoneOp("A"), op.propose({ id: "P1", label: "Net" }), op.add_group({ id: "vpc", kind: "vpc", label: "VPC", proposal: "P1" })]);
    expect(buildTree(b, await computeLayout(b)).map.get("vpc")!.data.pencil).toBe(true);
  });

  it("two alternatives sit next to each other even when ink comes between them", async () => {
    const b = run([
      architectZoneOp("A"),
      comp("api", "service"),
      op.propose({ id: "P2", label: "Relational" }),
      comp("rds", "database", "P2"),
      conn("c1", "api", "rds", "P2"),
      comp("queue", "service"),
      conn("c3", "api", "queue"),
      op.propose({ id: "P3", label: "Key-value", alternative_to: "P2" }),
      comp("ddb", "database", "P3"),
      conn("c2", "api", "ddb", "P3"),
    ]);
    const lay = await computeLayout(b);
    const [rds, ddb, queue] = ["rds", "ddb", "queue"].map((id) => lay.elements[id]);
    // the three share a layer; the alternatives are neighbours in it, the ink queue is not between them
    const across = (r: { x: number; y: number }) => (lay.elements.api.x < rds.x ? r.y : r.x);
    const order = [["rds", across(rds)], ["ddb", across(ddb)], ["queue", across(queue)]].sort((a, b) => (a[1] as number) - (b[1] as number)).map((x) => x[0]);
    expect(Math.abs(order.indexOf("rds") - order.indexOf("ddb"))).toBe(1);
  });
});
