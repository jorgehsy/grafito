import type { Element } from "../model";
import { elementSize, rectRight } from "./geometry";
import type { ZoneLocal } from "./types";

const TREE_COL_GAP = 76;
const TREE_ROW_GAP = 14;
const TREE_ROOT_GAP = 30;

/** Left-to-right tree: one column per depth (width = the widest label of the level),
 *  siblings stacked in arrival order, each parent centered on its children, with elbow connectors. */
export function layoutTree(elements: Element[]): ZoneLocal {
  const out: ZoneLocal = { w: 0, h: 0, elements: {}, connections: {} };
  if (!elements.length) return out;
  const byId = new Map(elements.map((e) => [e.id, e]));
  // a missing parent, or one that doesn't precede the child, counts as a root (avoids cycles)
  const order = new Map(elements.map((e, k) => [e.id, k]));
  const parentOf = (e: Element) => (e.parent && byId.has(e.parent) && order.get(e.parent)! < order.get(e.id)! ? e.parent : undefined);
  const kids = new Map<string | undefined, Element[]>();
  for (const e of elements) {
    const p = parentOf(e);
    kids.set(p, [...(kids.get(p) ?? []), e]);
  }
  const size = new Map(elements.map((e) => [e.id, elementSize(e)]));
  const depth = new Map<string, number>();
  const walk = (e: Element, d: number) => { depth.set(e.id, d); for (const k of kids.get(e.id) ?? []) walk(k, d + 1); };
  for (const r of kids.get(undefined) ?? []) walk(r, 0);
  const colW: number[] = [];
  for (const e of elements) colW[depth.get(e.id)!] = Math.max(colW[depth.get(e.id)!] ?? 0, size.get(e.id)!.w);
  const colX: number[] = [];
  let x = 0;
  colW.forEach((w, d) => { colX[d] = x; x += w + TREE_COL_GAP; });
  const cy = new Map<string, number>(); // vertical center of each node
  const subtree = (e: Element): string[] => [e.id, ...(kids.get(e.id) ?? []).flatMap(subtree)];
  /** places the subtree from yStart and returns its bottom edge */
  const place = (e: Element, yStart: number): number => {
    const s = size.get(e.id)!;
    const ks = kids.get(e.id) ?? [];
    if (!ks.length) { cy.set(e.id, yStart + s.h / 2); return yStart + s.h; }
    let y = yStart, bottom = yStart;
    for (const k of ks) { bottom = place(k, y); y = bottom + TREE_ROW_GAP; }
    let c = (cy.get(ks[0].id)! + cy.get(ks[ks.length - 1].id)!) / 2;
    if (c - s.h / 2 < yStart) { // the parent is taller than its children: shift the whole subtree down
      const dy = yStart - (c - s.h / 2);
      for (const k of ks) for (const id of subtree(k)) cy.set(id, cy.get(id)! + dy);
      c += dy; bottom += dy;
    }
    cy.set(e.id, c);
    return Math.max(bottom, c + s.h / 2);
  };
  let y = 0;
  for (const r of kids.get(undefined) ?? []) y = place(r, y) + TREE_ROOT_GAP;
  for (const e of elements) {
    const s = size.get(e.id)!;
    out.elements[e.id] = { x: colX[depth.get(e.id)!], y: cy.get(e.id)! - s.h / 2, w: s.w, h: s.h };
  }
  // bracket connectors: parent -> shared vertical run -> horizontal to each child
  for (const e of elements) {
    const p = parentOf(e);
    if (!p) continue;
    const a = out.elements[p], b = out.elements[e.id];
    const pc = a.y + a.h / 2, cc = b.y + b.h / 2;
    const mx = colX[depth.get(p)!] + colW[depth.get(p)!] + TREE_COL_GAP / 2;
    const pts = Math.abs(pc - cc) < 0.5
      ? [{ x: rectRight(a) + 3, y: pc }, { x: b.x - 4, y: cc }]
      : [{ x: rectRight(a) + 3, y: pc }, { x: mx, y: pc }, { x: mx, y: cc }, { x: b.x - 4, y: cc }];
    out.connections[`br:${e.id}`] = { kind: "poly", pts };
  }
  return out;
}
