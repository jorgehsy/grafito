import { describe, expect, it } from "vitest";
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { ARCHITECT_ZONE_ID, architectZoneOp } from "./architect";
import { applyOp, applyOps, emptyBoard } from "./model";
import type { Board } from "./model";
import { serializeBoard } from "./serialize";

const Z = ARCHITECT_ZONE_ID;
const db = (id: string, parent?: string): Op => op.add_component({ zone: Z, id, label: id.toUpperCase(), type: "database", ...(parent ? { parent } : {}) });

/** "A VPC with two AZs and a database in each". */
const vpcBoard = (): Board => {
  const r = applyOps(emptyBoard(), [
    architectZoneOp("Architecture"),
    op.add_group({ id: "vpc", kind: "vpc", label: "VPC" }),
    op.add_group({ id: "az1", kind: "availability_zone", label: "AZ a", parent: "vpc" }),
    op.add_group({ id: "az2", kind: "availability_zone", label: "AZ b", parent: "vpc" }),
    db("db1", "az1"),
    db("db2", "az2"),
    op.connect({ id: "c1", from: "db1", to: "db2", label: "replicates" }),
  ]);
  expect(r.warnings).toEqual([]);
  return r.board;
};
const parents = (b: Board) => ({
  groups: Object.fromEntries(b.groups.map((g) => [g.id, g.parent ?? null])),
  components: Object.fromEntries(b.elements.map((e) => [e.id, e.group ?? null])),
});

describe("groups in the system zone", () => {
  it("nest as a tree in the system zone, components inside them", () => {
    const b = vpcBoard();
    expect(b.groups).toEqual([
      { id: "vpc", zone: Z, kind: "vpc", label: "VPC" },
      { id: "az1", zone: Z, kind: "availability_zone", label: "AZ a", parent: "vpc" },
      { id: "az2", zone: Z, kind: "availability_zone", label: "AZ b", parent: "vpc" },
    ]);
    expect(parents(b).components).toEqual({ db1: "az1", db2: "az2" });
    expect(b.zones).toHaveLength(1);
  });

  it("an empty group is allowed", () => {
    const r = applyOps(emptyBoard(), [architectZoneOp("A"), op.add_group({ id: "g", kind: "generic", label: "On-premises" })]);
    expect(r.warnings).toEqual([]);
    expect(r.board.groups).toHaveLength(1);
  });

  it("needs a system zone and a new id", () => {
    const none = applyOp(emptyBoard(), op.add_group({ id: "vpc", kind: "vpc", label: "VPC" }));
    expect(none.warnings).toEqual(["add_group: there is no system zone to draw the group in"]);
    const b = vpcBoard();
    for (const dup of ["vpc", "db1", "c1", Z]) {
      const r = applyOp(b, op.add_group({ id: dup, kind: "vpc", label: "X" }));
      expect(r.board).toBe(b);
      expect(r.warnings).toEqual([`add_group: id '${dup}' already exists`]);
    }
    expect(applyOp(b, db("az1")).warnings).toEqual(["add_component: id 'az1' already exists"]);
  });

  it("an unknown parent is ignored with a warning; the thing is still drawn", () => {
    const b = vpcBoard();
    const g = applyOp(b, op.add_group({ id: "sub", kind: "private_subnet", label: "Private", parent: "db1" }));
    expect(g.warnings).toEqual(["add_group: parent 'db1' is not a group; drawn at the top of the zone"]);
    expect(g.board.groups.at(-1)).toEqual({ id: "sub", zone: Z, kind: "private_subnet", label: "Private" });
    const c = applyOp(b, db("db3", "nope"));
    expect(c.warnings).toEqual(["add_component: parent 'nope' is not a group of the zone; ignored"]);
    expect(c.board.elements.at(-1)!.group).toBeUndefined();
  });

  it("a component's parent group must be in its zone", () => {
    const b = applyOps(vpcBoard(), [op.create_zone({ id: "other", kind: "system", title: "Other" })]).board;
    const r = applyOp(b, op.add_component({ zone: "other", id: "x", label: "X", type: "service", parent: "az1" }));
    expect(r.warnings).toEqual(["add_component: parent 'az1' is not a group of the zone; ignored"]);
  });

  it("update_label renames a group", () => {
    const r = applyOp(vpcBoard(), op.update_label({ id: "az1", label: "us-east-1a" }));
    expect(r.warnings).toEqual([]);
    expect(r.board.groups[1].label).toBe("us-east-1a");
  });
});

describe("arrows join components only", () => {
  it("connect to or from a group is rejected with a warning", () => {
    const b = vpcBoard();
    for (const [from, to] of [["db1", "az2"], ["vpc", "db2"]] as const) {
      const r = applyOp(b, op.connect({ id: "bad", from, to }));
      expect(r.board).toBe(b);
      expect(r.warnings).toEqual([`connect: '${from === "vpc" ? from : to}' is a group; arrows join components only`]);
    }
  });
});

describe("deleting a group lifts its children", () => {
  it("deleting the VPC leaves the AZs at the top of the zone with their databases and arrow", () => {
    const r = applyOp(vpcBoard(), op.delete({ id: "vpc" }));
    expect(r.warnings).toEqual([]);
    expect(parents(r.board)).toEqual({ groups: { az1: null, az2: null }, components: { db1: "az1", db2: "az2" } });
    expect(r.board.connections.map((c) => c.id)).toEqual(["c1"]);
  });
  it("children of a nested group move to that group's parent", () => {
    const r = applyOp(vpcBoard(), op.delete({ id: "az1" }));
    expect(parents(r.board)).toEqual({ groups: { vpc: null, az2: "vpc" }, components: { db1: "vpc", db2: "az2" } });
  });
  it("deleting the zone deletes its groups too", () => {
    const r = applyOp(vpcBoard(), op.delete({ id: Z }));
    expect(r.board.groups).toEqual([]);
    expect(r.board.elements).toEqual([]);
  });
  it("deleting a component in a group leaves the group", () => {
    const r = applyOp(vpcBoard(), op.delete({ id: "db1" }));
    expect(r.board.groups).toHaveLength(3);
    expect(r.board.connections).toEqual([]);
  });
});

describe("set_parent", () => {
  it("moves a component into another group and out of every group", () => {
    const b = vpcBoard();
    const moved = applyOp(b, op.set_parent({ id: "db1", parent: "az2" }));
    expect(moved.warnings).toEqual([]);
    expect(parents(moved.board).components).toEqual({ db1: "az2", db2: "az2" });
    const out = applyOp(moved.board, op.set_parent({ id: "db1", parent: null }));
    expect(parents(out.board).components).toEqual({ db1: null, db2: "az2" });
    expect(out.board.elements[0]).not.toHaveProperty("group");
  });
  it("moves a group with everything inside it", () => {
    const b = applyOps(vpcBoard(), [op.add_group({ id: "vpc2", kind: "vpc", label: "VPC 2" }), op.set_parent({ id: "az2", parent: "vpc2" })]);
    expect(b.warnings).toEqual([]);
    expect(parents(b.board)).toEqual({ groups: { vpc: null, az1: "vpc", az2: "vpc2", vpc2: null }, components: { db1: "az1", db2: "az2" } });
    const top = applyOp(b.board, op.set_parent({ id: "az2", parent: null }));
    expect(parents(top.board).groups.az2).toBeNull();
  });
  it("rejects cycles: a group into itself or into a group it contains", () => {
    const b = applyOps(vpcBoard(), [op.add_group({ id: "sub", kind: "private_subnet", label: "Private", parent: "az1" })]).board;
    for (const [id, parent] of [["vpc", "vpc"], ["vpc", "az1"], ["vpc", "sub"], ["az1", "sub"]]) {
      const r = applyOp(b, op.set_parent({ id, parent }));
      expect(r.board).toBe(b);
      expect(r.warnings).toEqual([`set_parent: cannot put '${id}' inside itself or a group it contains`]);
    }
    expect(applyOp(b, op.set_parent({ id: "sub", parent: "vpc" })).warnings).toEqual([]);
  });
  it("rejects unknown ids, non-group parents, other zones and non-components", () => {
    const b = applyOps(vpcBoard(), [
      op.create_zone({ id: "other", kind: "system", title: "Other" }),
      op.add_component({ zone: "other", id: "x", label: "X", type: "service" }),
      op.create_zone({ id: "f", kind: "flow", title: "F" }),
      op.add_step({ zone: "f", id: "s1", label: "S" }),
    ]).board;
    const cases: [Op, string][] = [
      [op.set_parent({ id: "nope", parent: "az1" }), "set_parent: id 'nope' does not exist"],
      [op.set_parent({ id: "db1", parent: "db2" }), "set_parent: parent 'db2' is not a group"],
      [op.set_parent({ id: "x", parent: "az1" }), "set_parent: group 'az1' is in another zone"],
      [op.set_parent({ id: "s1", parent: "az1" }), "set_parent: 's1' is a step; only components and groups go in a group"],
      [op.set_parent({ id: "c1", parent: "az1" }), "set_parent: id 'c1' does not exist"],
    ];
    for (const [o, w] of cases) {
      const r = applyOp(b, o);
      expect(r.board).toBe(b);
      expect(r.warnings).toEqual([w]);
    }
  });
});

describe("board text", () => {
  it("shows the group tree, components under their group", () => {
    const b = applyOps(vpcBoard(), [db("cache"), op.add_group({ id: "empty", kind: "public_subnet", label: "Public" })]).board;
    expect(serializeBoard(b)).toBe(
      [
        "ZONES",
        '- system [system] "Architecture" color:orange',
        "GROUPS",
        '- vpc [vpc] "VPC" @system',
        '  - az1 [availability_zone] "AZ a"',
        "    - db1",
        '  - az2 [availability_zone] "AZ b"',
        "    - db2",
        '- empty [public_subnet] "Public" @system',
        "ELEMENTS",
        '- db1 (component/database) "DB1" @system group:az1',
        '- db2 (component/database) "DB2" @system group:az2',
        '- cache (component/database) "CACHE" @system',
        "CONNECTIONS",
        '- c1: db1 -> db2 "replicates"',
      ].join("\n"),
    );
  });
  it("a board without groups has no GROUPS section", () => {
    const b = applyOps(emptyBoard(), [architectZoneOp("A"), db("x")]).board;
    expect(serializeBoard(b)).not.toContain("GROUPS");
    expect(serializeBoard(b)).not.toContain("group:");
  });
});
