import { describe, it, expect } from "vitest";
import { applyOp, emptyMap, type MindMap } from "./model";
import { boxesOverlap, computeLayout, type Box } from "./layout";

function genTree(n: number, seed = 7): MindMap {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let m = applyOp(emptyMap(), { type: "set_root", label: "Raíz del mapa" }).map;
  const ids = ["root"];
  for (let i = 1; i < n; i++) {
    const parent = ids[Math.floor(rnd() * Math.min(ids.length, 1 + i * 0.7))];
    const id = `n${i}`;
    m = applyOp(m, { type: "add_node", id, parent_id: parent, label: "Idea " + "x".repeat(Math.floor(rnd() * 20)) }).map;
    if (rnd() < 0.3) m = applyOp(m, { type: "add_note", node_id: id, text: "Detalle de la idea número " + i }).map;
    ids.push(id);
  }
  return m;
}

describe("computeLayout", () => {
  it("40 nodos sin solapes (nodos y notas)", () => {
    for (const seed of [1, 7, 42]) {
      const m = genTree(40, seed);
      const lay = computeLayout(m);
      const boxes: Box[] = [];
      for (const l of Object.values(lay)) boxes.push(l, ...l.notes);
      expect(Object.keys(lay)).toHaveLength(40);
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) expect(boxesOverlap(boxes[i], boxes[j])).toBe(false);
    }
  });
  it("es determinista", () => {
    const m = genTree(40);
    expect(computeLayout(m)).toEqual(computeLayout(m));
  });
  it("mapa vacío y solo raíz", () => {
    expect(computeLayout(emptyMap())).toEqual({});
    const m = applyOp(emptyMap(), { type: "set_root", label: "A" }).map;
    expect(computeLayout(m).root).toMatchObject({ x: 0, y: 0 });
  });
});
