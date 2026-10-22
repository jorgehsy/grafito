// Convierte mapa + layout en elementos de Excalidraw. IDs estables derivados de los ids de nodo.
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { MindMap } from "./model";
import { children } from "./model";
import type { Layout } from "./layout";

const PALETTE = [
  { fill: "#ffc9c9", stroke: "#e03131" },
  { fill: "#b2f2bb", stroke: "#2f9e44" },
  { fill: "#a5d8ff", stroke: "#1971c2" },
  { fill: "#d0bfff", stroke: "#6741d9" },
  { fill: "#ffd8a8", stroke: "#e8590c" },
  { fill: "#99e9f2", stroke: "#0c8599" },
  { fill: "#fcc2d7", stroke: "#c2255c" },
  { fill: "#e9ecef", stroke: "#495057" },
];
const FONT = 5; // Excalifont (manuscrita)

function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 2147483647;
}

export function branchColors(map: MindMap): Record<string, { fill: string; stroke: string }> {
  const out: Record<string, { fill: string; stroke: string }> = {};
  if (!map.rootId) return out;
  children(map, map.rootId).forEach((c, i) => {
    const col = PALETTE[i % PALETTE.length];
    const stack = [c.id];
    while (stack.length) {
      const id = stack.pop()!;
      out[id] = col;
      children(map, id).forEach((k) => stack.push(k.id));
    }
  });
  return out;
}

export const nodeEid = (id: string) => `n-${id}`;
export const edgeEid = (id: string) => `e-${id}`;
export const noteEid = (id: string, i: number) => `note-${id}-${i}`;
export const linkEid = (id: string) => `l-${id}`;

type B = { x: number; y: number; w: number; h: number };
/** Punto del borde de `b` en dirección a `to` (+ holgura). */
function edgePoint(b: B, to: { x: number; y: number }, ellipse: boolean, gap = 4) {
  const dx = to.x - b.x, dy = to.y - b.y;
  const hw = b.w / 2 + gap, hh = b.h / 2 + gap;
  const t = ellipse
    ? 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2 || 1e-9)
    : Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: b.x + dx * t, y: b.y + dy * t };
}

function arrowGeom(map: MindMap, layout: Layout, from: string, to: string) {
  const a = layout[from], b = layout[to];
  const p1 = edgePoint(a, b, from === map.rootId);
  const p2 = edgePoint(b, a, to === map.rootId);
  return { x: p1.x, y: p1.y, points: [[0, 0], [p2.x - p1.x, p2.y - p1.y]], width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y) };
}

export function buildElements(map: MindMap, layout: Layout): any[] {
  if (!map.rootId || !layout[map.rootId]) return [];
  const colors = branchColors(map);
  const sk: any[] = [];

  // 1) formas y notas
  for (const n of Object.values(map.nodes)) {
    const l = layout[n.id];
    if (!l) continue;
    const isRoot = n.id === map.rootId;
    const col = colors[n.id] ?? { fill: "#fff3bf", stroke: "#f08c00" };
    sk.push({
      type: isRoot ? "ellipse" : "rectangle",
      id: nodeEid(n.id),
      x: l.x - l.w / 2,
      y: l.y - l.h / 2,
      width: l.w,
      height: l.h,
      backgroundColor: isRoot ? "#ffec99" : col.fill,
      strokeColor: isRoot ? "#e67700" : col.stroke,
      fillStyle: "hachure",
      roughness: 1,
      strokeWidth: isRoot ? 3 : 2,
      roundness: isRoot ? null : { type: 3 },
      seed: seedOf(n.id),
      label: { text: n.label, fontSize: isRoot ? 26 : 20, fontFamily: FONT, strokeColor: "#1e1e1e" },
    });
    n.notes.forEach((t, i) => {
      const b = l.notes[i];
      sk.push({
        type: "rectangle",
        id: noteEid(n.id, i),
        x: b.x - b.w / 2,
        y: b.y - b.h / 2,
        width: b.w,
        height: b.h,
        backgroundColor: "#fff3a3",
        strokeColor: "#e0c200",
        fillStyle: "solid",
        roughness: 1,
        strokeWidth: 1,
        roundness: null,
        seed: seedOf(`${n.id}-${i}`),
        label: { text: t, fontSize: 14, fontFamily: FONT, strokeColor: "#5c4a00" },
      });
    });
  }

  // 2) aristas del árbol
  for (const n of Object.values(map.nodes)) {
    if (!n.parentId || !layout[n.id] || !layout[n.parentId]) continue;
    const col = colors[n.id] ?? { stroke: "#495057" };
    sk.push({
      type: "arrow",
      id: edgeEid(n.id),
      ...arrowGeom(map, layout, n.parentId, n.id),
      strokeColor: col.stroke,
      strokeWidth: 2,
      roughness: 1,
      endArrowhead: null,
      seed: seedOf(`e-${n.id}`),
    });
  }

  // 3) enlaces transversales (discontinuos, con etiqueta)
  for (const lk of map.links) {
    if (!layout[lk.from] || !layout[lk.to]) continue;
    sk.push({
      type: "arrow",
      id: linkEid(lk.id),
      ...arrowGeom(map, layout, lk.from, lk.to),
      strokeColor: "#868e96",
      strokeStyle: "dashed",
      strokeWidth: 2,
      roughness: 1,
      seed: seedOf(lk.id),
      ...(lk.label ? { label: { text: lk.label, fontSize: 16, fontFamily: FONT, strokeColor: "#495057" } } : {}),
    });
  }

  const els: any[] = convertToExcalidrawElements(sk, { regenerateIds: false } as any) as any[];
  // Enlazar flechas a sus formas (bindings) a mano, con geometría ya calculada.
  const bindPairs: [string, string, string][] = [];
  for (const n of Object.values(map.nodes)) if (n.parentId && layout[n.id] && layout[n.parentId]) bindPairs.push([edgeEid(n.id), nodeEid(n.parentId), nodeEid(n.id)]);
  for (const lk of map.links) if (layout[lk.from] && layout[lk.to]) bindPairs.push([linkEid(lk.id), nodeEid(lk.from), nodeEid(lk.to)]);
  const byId0 = new Map(els.map((e) => [e.id, e]));
  for (const [aid, from, to] of bindPairs) {
    const arrow = byId0.get(aid);
    if (!arrow) continue;
    arrow.startBinding = { elementId: from, focus: 0, gap: 4 };
    arrow.endBinding = { elementId: to, focus: 0, gap: 4 };
    for (const sid of [from, to]) {
      const sh = byId0.get(sid);
      if (sh) sh.boundElements = [...(sh.boundElements ?? []), { id: aid, type: "arrow" }];
    }
  }
  // Los textos enlazados nacen con id aleatorio: fijarlo para que no parpadee.
  const byId = new Map(els.map((e) => [e.id, e]));
  for (const e of els) {
    if (e.type === "text" && e.containerId) {
      const container = byId.get(e.containerId);
      const newId = `t-${e.containerId}`;
      if (container?.boundElements) {
        container.boundElements = container.boundElements.map((b: any) => (b.id === e.id ? { ...b, id: newId } : b));
      }
      e.id = newId;
      e.seed = seedOf(newId);
    }
  }
  // Los elementos con botones arriba deben quedar por encima de las flechas
  return els;
}

/** Empuja a la escena. Los elementos nuevos entran con un fundido de ~300 ms. */
export function pushScene(api: any, elements: any[], knownIds: Set<string>, opts: { fit: boolean } = { fit: true }): Set<string> {
  const ids = new Set(elements.map((e) => e.id));
  const fresh = new Set(elements.filter((e) => !knownIds.has(e.id)).map((e) => e.id));
  const withOpacity = (t: number) =>
    elements.map((e) => (fresh.has(e.id) ? { ...e, opacity: Math.round((e.opacity ?? 100) * t) } : e));

  api.updateScene({ elements: withOpacity(fresh.size ? 0 : 1) });
  if (opts.fit && elements.length) api.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.75, animate: false });

  if (fresh.size) {
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / 300);
      api.updateScene({ elements: withOpacity(t) });
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  return ids;
}
