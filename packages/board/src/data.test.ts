import { describe, expect, it } from "vitest";
import { applyOp, applyOps, emptyBoard } from "./model";
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { computeLayout, overlaps } from "./layout";
import type { Rect } from "./layout";
import { buildTree } from "./tree";
import { serializeBoard } from "./serialize";

const inside = (r: Rect, z: Rect) => r.x >= z.x && r.y >= z.y && r.x + r.w <= z.x + z.w && r.y + r.h <= z.y + z.h;

const shop: Op[] = [
  op.create_zone({ id: "d", kind: "data", title: "Shop" }),
  op.add_entity({ zone: "d", id: "users", name: "users", fields: [{ name: "id", type: "uuid", key: "pk" }, { name: "email", type: "text" }] }),
  op.add_entity({ zone: "d", id: "orders", name: "orders", fields: [{ name: "id", key: "pk" }, { name: "user_id", key: "fk" }, { name: "total", type: "numeric" }] }),
  op.add_entity({ zone: "d", id: "items", name: "order_items", fields: [{ name: "order_id", key: "fk" }, { name: "product_id", key: "fk" }, { name: "qty", type: "int" }] }),
  op.add_entity({ zone: "d", id: "products", name: "products" }),
  op.relate({ id: "r1", from: "users", to: "orders", cardinality: "one_to_many", label: "places" }),
  op.relate({ id: "r2", from: "orders", to: "items", cardinality: "one_to_many" }),
  op.relate({ id: "r3", from: "items", to: "products", cardinality: "many_to_one" }),
];
const board = () => applyOps(emptyBoard(), shop).board;

describe("data model: the board model", () => {
  it("stores entities with their fields and relations with their cardinality", () => {
    const r = applyOps(emptyBoard(), shop);
    expect(r.warnings).toEqual([]);
    const users = r.board.elements[0];
    expect([users.type, users.label, users.fields]).toEqual(["entity", "users", [{ name: "id", type: "uuid", key: "pk" }, { name: "email", type: "text" }]]);
    expect(r.board.elements[3].fields).toEqual([]);
    expect(r.board.connections.map((c) => [c.id, c.from, c.to, c.cardinality, c.label])).toEqual([
      ["r1", "users", "orders", "one_to_many", "places"], ["r2", "orders", "items", "one_to_many", undefined], ["r3", "items", "products", "many_to_one", undefined],
    ]);
  });
  it("an invalid op is ignored with a warning", () => {
    const b = applyOp(board(), op.create_zone({ id: "s", kind: "system", title: "S" })).board;
    const withComp = applyOp(b, op.add_component({ zone: "s", id: "api", label: "API", type: "service" })).board;
    for (const bad of [
      op.add_entity({ zone: "nope", id: "x", name: "x" }),
      op.add_entity({ zone: "s", id: "x", name: "x" }),
      op.add_entity({ zone: "d", id: "users", name: "dup" }),
      op.add_component({ zone: "d", id: "x", label: "x", type: "database" }),
      op.set_fields({ id: "nope", fields: [] }),
      op.set_fields({ id: "api", fields: [] }),
      op.relate({ id: "r9", from: "users", to: "nope", cardinality: "one_to_one" }),
      op.relate({ id: "r9", from: "users", to: "api", cardinality: "one_to_one" }),
      op.relate({ id: "r1", from: "users", to: "products", cardinality: "one_to_one" }),
    ]) {
      const r = applyOp(withComp, bad);
      expect(r.board, JSON.stringify(bad)).toBe(withComp);
      expect(r.warnings).toHaveLength(1);
    }
  });
  it("set_fields replaces the list; a repeated field name is kept once with a warning", () => {
    const r = applyOp(board(), op.set_fields({ id: "products", fields: [{ name: "id", key: "pk" }, { name: "name", type: " " }, { name: "id" }] }));
    expect(r.board.elements[3].fields).toEqual([{ name: "id", key: "pk" }, { name: "name" }]);
    expect(r.warnings).toEqual(["set_fields: field 'id' is repeated; kept once"]);
  });
  it("update_label renames, delete takes the entity's relations, connect still draws a plain arrow, move_to_zone needs a data zone", () => {
    let b = applyOps(board(), [op.update_label({ id: "users", label: "customers" }), op.connect({ id: "c1", from: "users", to: "products" }), op.update_label({ id: "r2", label: "has" })]).board;
    expect(b.elements[0].label).toBe("customers");
    expect(b.connections.find((c) => c.id === "c1")!.cardinality).toBeUndefined();
    expect(b.connections.find((c) => c.id === "r2")!.label).toBe("has");
    b = applyOp(b, op.delete({ id: "orders" })).board;
    expect(b.connections.map((c) => c.id)).toEqual(["r3", "c1"]);
    const two = applyOps(b, [op.create_zone({ id: "d2", kind: "data", title: "Other" }), op.create_zone({ id: "l", kind: "list", title: "L" })]).board;
    expect(applyOp(two, op.move_to_zone({ id: "users", zone: "d2" })).board.elements[0].zone).toBe("d2");
    expect(applyOp(two, op.move_to_zone({ id: "users", zone: "l" })).warnings).toHaveLength(1);
  });
  it("a data zone takes a direction", () => {
    const r = applyOp(emptyBoard(), op.create_zone({ id: "d", kind: "data", title: "D", direction: "vertical" }));
    expect(r.warnings).toEqual([]);
    expect(r.board.zones[0].direction).toBe("vertical");
  });
});

describe("data model: layout and render tree", () => {
  it("entities sit inside the zone without overlapping, sized by their fields; relations are routed", async () => {
    const b = board();
    const lay = await computeLayout(b);
    const rects = b.elements.map((e) => [e.id, lay.elements[e.id]] as [string, Rect]);
    for (const [id, r] of rects) expect(inside(r, lay.zones.d), id).toBe(true);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) expect(overlaps(rects[i][1], rects[j][1]), `${rects[i][0]} vs ${rects[j][0]}`).toBe(false);
    expect(lay.elements.orders.h).toBeGreaterThan(lay.elements.users.h);
    expect(lay.elements.products.h).toBeLessThan(lay.elements.users.h);
    for (const id of ["r1", "r2", "r3"]) expect(lay.connections[id].pts.length, id).toBeGreaterThanOrEqual(2);
    expect(lay.connections.r1.label?.text).toBe("places");
  });
  it("a field change redraws the entity; a relation carries its cardinality", async () => {
    const b = board();
    const tree = buildTree(b, await computeLayout(b));
    expect(tree.map.get("users")!.data).toMatchObject({ variant: "entity", lines: ["users"], fields: [{ name: "id" }, { name: "email" }] });
    expect(tree.map.get("r3")!.data.cardinality).toBe("many_to_one");
    const b2 = applyOp(b, op.set_fields({ id: "users", fields: [{ name: "id", key: "pk" }] })).board;
    const tree2 = buildTree(b2, await computeLayout(b2));
    expect(tree2.map.get("users")!.sig).not.toBe(tree.map.get("users")!.sig);
    expect(tree2.map.get("orders")!.sig).toBe(tree.map.get("orders")!.sig);
  });
});

describe("data model: board text", () => {
  it("lists each entity's fields and each relation's cardinality", () => {
    const text = serializeBoard(board());
    expect(text).toContain('- d [data] "Shop"');
    expect(text).toContain('- users (entity) "users" @d fields:[id:uuid pk, email:text]');
    expect(text).toContain('- products (entity) "products" @d fields:[]');
    expect(text).toContain('- r1: users -> orders "places" one_to_many');
    expect(text).toContain("- r3: items -> products many_to_one");
  });
});
