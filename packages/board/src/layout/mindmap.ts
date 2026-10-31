import { hierarchy, tree } from "d3-hierarchy";
import type { Element } from "../model";
import { elementSize, rectRight } from "./geometry";
import type { ZoneLocal } from "./types";

export function layoutMindmap(elements: Element[]): ZoneLocal {
  const out: ZoneLocal = { w: 0, h: 0, elements: {}, connections: {} };
  if (!elements.length) return out;
  const byId = new Map(elements.map((e) => [e.id, e]));
  const root = elements.find((e) => !e.parent || !byId.has(e.parent))!;
  interface N { id: string; kids: N[] }
  const kidsOf = (id: string): N[] =>
    elements.filter((e) => e.parent === id).map((e) => ({ id: e.id, kids: kidsOf(e.id) }));
  const rootNode: N = { id: root.id, kids: kidsOf(root.id) };
  // other parentless ideas hang off the central one
  for (const e of elements) if (e.id !== root.id && (!e.parent || !byId.has(e.parent))) rootNode.kids.push({ id: e.id, kids: kidsOf(e.id) });
  const h = hierarchy<N>(rootNode, (n) => n.kids);
  tree<N>().nodeSize([62, 1]).separation((a, b) => {
    const ha = elementSize(byId.get(a.data.id)!).h, hb = elementSize(byId.get(b.data.id)!).h;
    return (ha / 2 + hb / 2 + 22) / 62;
  })(h);
  const colW: number[] = [];
  h.each((n) => { colW[n.depth] = Math.max(colW[n.depth] ?? 0, elementSize(byId.get(n.data.id)!).w); });
  const colX: number[] = [];
  let x = 0;
  colW.forEach((w, d) => { colX[d] = x; x += w + 90; });
  let minY = Infinity;
  h.each((n) => { minY = Math.min(minY, n.x! - elementSize(byId.get(n.data.id)!).h / 2); });
  h.each((n) => {
    const s = elementSize(byId.get(n.data.id)!);
    out.elements[n.data.id] = { x: colX[n.depth], y: n.x! - s.h / 2 - minY, w: s.w, h: s.h };
  });
  // parent -> child connections (horizontal curves)
  h.each((n) => {
    if (!n.parent) return;
    const a = out.elements[n.parent.data.id], b = out.elements[n.data.id];
    const p0 = { x: rectRight(a) + 3, y: a.y + a.h / 2 }, p3 = { x: b.x - 6, y: b.y + b.h / 2 };
    const dx = (p3.x - p0.x) / 2;
    out.connections[`auto:${n.data.id}`] = { kind: "curve", pts: [p0, { x: p0.x + dx, y: p0.y }, { x: p3.x - dx, y: p3.y }, p3] };
  });
  return out;
}
