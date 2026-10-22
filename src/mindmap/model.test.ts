import { describe, it, expect } from "vitest";
import { applyOp, emptyMap, type MindMap, type Op } from "./model";

const run = (m: MindMap, ...ops: Op[]) => ops.reduce((acc, op) => applyOp(acc, op).map, m);
const base = () =>
  run(
    emptyMap(),
    { type: "set_root", label: "Café" },
    { type: "add_node", id: "a", parent_id: "root", label: "A" },
    { type: "add_node", id: "b", parent_id: "a", label: "B" },
    { type: "add_node", id: "c", parent_id: "root", label: "C" },
  );

describe("applyOp", () => {
  it("set_root crea y renombra la raíz", () => {
    const m = run(emptyMap(), { type: "set_root", label: "X" });
    expect(m.rootId).toBe("root");
    expect(run(m, { type: "set_root", label: "Y" }).nodes.root.label).toBe("Y");
  });
  it("add_node / update_node", () => {
    const m = run(base(), { type: "update_node", id: "a", label: "A2" });
    expect(m.nodes.a.label).toBe("A2");
    expect(m.nodes.b.parentId).toBe("a");
  });
  it("move_node cambia el padre", () => {
    expect(run(base(), { type: "move_node", id: "b", new_parent_id: "c" }).nodes.b.parentId).toBe("c");
  });
  it("delete_node borra el subárbol y sus enlaces", () => {
    let m = run(base(), { type: "add_link", from_id: "b", to_id: "c" });
    m = run(m, { type: "delete_node", id: "a" });
    expect(Object.keys(m.nodes).sort()).toEqual(["c", "root"]);
    expect(m.links).toHaveLength(0);
  });
  it("add_note y add_link", () => {
    const m = run(base(), { type: "add_note", node_id: "a", text: "n" }, { type: "add_link", from_id: "a", to_id: "c", label: "x" });
    expect(m.nodes.a.notes).toEqual(["n"]);
    expect(m.links[0]).toMatchObject({ from: "a", to: "c", label: "x" });
  });
  it("ignora ops inválidas con aviso", () => {
    const m = base();
    const cases: Op[] = [
      { type: "add_node", id: "a", parent_id: "root", label: "dup" },
      { type: "add_node", id: "z", parent_id: "nope", label: "z" },
      { type: "update_node", id: "nope", label: "z" },
      { type: "move_node", id: "a", new_parent_id: "b" }, // ciclo
      { type: "move_node", id: "root", new_parent_id: "a" },
      { type: "delete_node", id: "root" },
      { type: "delete_node", id: "nope" },
      { type: "add_note", node_id: "nope", text: "x" },
      { type: "add_link", from_id: "a", to_id: "nope" },
    ];
    for (const op of cases) {
      const r = applyOp(m, op);
      expect(r.warning, op.type).toBeTruthy();
      expect(r.map).toBe(m);
    }
  });
});
