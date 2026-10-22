// Layout radial puro con d3-hierarchy. Sin React.
import { hierarchy, tree } from "d3-hierarchy";
import type { MindMap, MMNode } from "./model";
import { children } from "./model";

export interface Box {
  x: number; // centro
  y: number;
  w: number;
  h: number;
}
export interface NodeLayout extends Box {
  depth: number;
  angle: number;
  /** Rectángulos de las notas (pegadas debajo del nodo). */
  notes: Box[];
}
export type Layout = Record<string, NodeLayout>;

export const NOTE_W = 150;
const NOTE_GAP = 8;
const PAD = 28;

export function nodeSize(label: string, isRoot: boolean): { w: number; h: number } {
  if (isRoot) return { w: Math.max(190, label.length * 15 + 70), h: 90 };
  const lines = label.length > 22 ? 2 : 1;
  return { w: Math.min(260, Math.max(100, label.length * 11.5 + 40)), h: lines === 2 ? 64 : 44 };
}

export function noteSize(text: string): { w: number; h: number } {
  const lines = Math.max(1, Math.ceil(text.length / 20));
  return { w: NOTE_W, h: 18 + lines * 15 };
}

interface Item {
  id: string;
  children: Item[];
}

function toItem(map: MindMap, n: MMNode): Item {
  return { id: n.id, children: children(map, n.id).map((c) => toItem(map, c)) };
}

export function computeLayout(map: MindMap): Layout {
  const out: Layout = {};
  if (!map.rootId || !map.nodes[map.rootId]) return out;

  const root = tree<Item>()
    .size([2 * Math.PI, 1])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.6) / Math.max(1, a.depth))(
    hierarchy<Item>(toItem(map, map.nodes[map.rootId])),
  );

  // Dimensiones por nodo y radio envolvente (círculo alrededor del centro del nodo
  // que cubre caja + notas): garantiza que dos nodos a distancia >= R1+R2 no se solapan.
  const size: Record<string, { w: number; h: number; R: number; notes: Box[] }> = {};
  root.each((d) => {
    const n = map.nodes[d.data.id];
    const s = nodeSize(n.label, d.depth === 0);
    let y = s.h / 2 + NOTE_GAP; // desde el centro del nodo hacia abajo
    const notes: Box[] = [];
    let maxW = s.w;
    for (const t of n.notes) {
      const ns = noteSize(t);
      notes.push({ x: 0, y: y + ns.h / 2, w: ns.w, h: ns.h });
      y += ns.h + NOTE_GAP;
      maxW = Math.max(maxW, ns.w);
    }
    const down = n.notes.length ? y : s.h / 2;
    const R = Math.hypot(maxW / 2, Math.max(s.h / 2, down));
    size[d.data.id] = { ...s, R, notes };
  });

  const byDepth: Record<number, typeof root[]> = {};
  root.each((d) => {
    (byDepth[d.depth] ??= []).push(d);
  });
  const maxDepth = Math.max(...Object.keys(byDepth).map(Number));

  const radii: number[] = [0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const ring = byDepth[depth].slice().sort((a, b) => a.x - b.x);
    const prev = byDepth[depth - 1];
    const prevR = Math.max(...prev.map((d) => size[d.data.id].R));
    const curR = Math.max(...ring.map((d) => size[d.data.id].R));
    let r = radii[depth - 1] + prevR + curR + PAD;
    for (let i = 0; i < ring.length; i++) {
      if (ring.length < 2) break;
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      let gap = i === ring.length - 1 ? b.x + 2 * Math.PI - a.x : b.x - a.x;
      gap = Math.min(Math.max(gap, 1e-3), Math.PI);
      const need = size[a.data.id].R + size[b.data.id].R + PAD;
      r = Math.max(r, need / (2 * Math.sin(gap / 2)));
    }
    radii[depth] = r;
  }

  root.each((d) => {
    const s = size[d.data.id];
    const r = radii[d.depth];
    const x = r * Math.sin(d.x);
    const y = -r * Math.cos(d.x);
    out[d.data.id] = {
      x,
      y,
      w: s.w,
      h: s.h,
      depth: d.depth,
      angle: d.x,
      notes: s.notes.map((b) => ({ ...b, x: x + b.x, y: y + b.y })),
    };
  });
  return out;
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}
