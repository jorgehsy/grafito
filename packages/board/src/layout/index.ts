// Pure layout (no React): positions zones on the board and elements inside each zone.
// ELK (layered) for flow/system; d3-hierarchy for mindmap; custom code for tree, scale, cycle, timeline; stacked rows for list/compare.
import type { Board } from "../model";
import { derivedConnections, findElement } from "../model";
import { Router } from "../route";
import { connectionMid, placeLabel, routeCurve } from "./edges";
import { HEADER, PAD, center, emphasisRect, labelRect, maxLen, overlaps, rectBottom, rectRight, union, wrapText } from "./geometry";
import { placeZones, layoutZone } from "./zones";
import type { BoardLayout, ConnectionGeom, Rect } from "./types";

const CALLOUT_CW = 12.2;
const CALLOUT_LH = 29;

export async function computeLayout(board: Board): Promise<BoardLayout> {
  const locals = await Promise.all(board.zones.map((z) => layoutZone(board, z)));
  const sizes: Record<string, { w: number; h: number }> = {};
  board.zones.forEach((z, i) => (sizes[z.id] = { w: locals[i].w, h: locals[i].h }));
  const zoneRects = placeZones(board.zones, sizes);
  const out: BoardLayout = { zones: zoneRects, elements: {}, connections: {}, callouts: {}, dividers: {}, scales: {}, marks: {}, spans: {}, labels: {}, bounds: { x: 0, y: 0, w: 0, h: 0 } };

  board.zones.forEach((z, i) => {
    const o = zoneRects[z.id];
    const loc = locals[i];
    for (const [id, r] of Object.entries(loc.elements)) out.elements[id] = { x: r.x + o.x, y: r.y + o.y, w: r.w, h: r.h };
    for (const [id, e] of Object.entries(loc.connections))
      out.connections[id] = {
        kind: e.kind,
        pts: e.pts.map((p) => ({ x: p.x + o.x, y: p.y + o.y })),
        label: e.label ? { ...e.label, x: e.label.x + o.x, y: e.label.y + o.y } : undefined,
      };
    if (loc.divider !== undefined) out.dividers[z.id] = o.x + loc.divider;
    if (loc.scale) out.scales[z.id] = { ...loc.scale, bar: { ...loc.scale.bar, x: loc.scale.bar.x + o.x, y: loc.scale.bar.y + o.y } };
    for (const [id, p] of Object.entries(loc.spans ?? {})) out.spans[id] = { x0: p.x0 + o.x, x1: p.x1 + o.x };
    for (const [id, r] of Object.entries(loc.labels ?? {})) out.labels[id] = { x: r.x + o.x, y: r.y + o.y, w: r.w, h: r.h };
    for (const [id, m] of Object.entries(loc.marks ?? {})) out.marks[id] = { ...m, stem: m.stem.map((p) => ({ x: p.x + o.x, y: p.y + o.y })) };
  });

  const allElements = Object.values(out.elements);
  const elZone = new Map(board.elements.map((e) => [e.id, e.zone]));
  const circles = board.emphasis.flatMap((m) => (m.style === "circle" && out.elements[m.target] ? [emphasisRect(out.elements[m.target])] : []));
  const labelObs = [...allElements, ...circles];
  const takenLabels: Rect[] = [];
  for (const e of Object.values(out.connections)) if (e.label) takenLabels.push(labelRect(e.label));

  // connections ELK didn't resolve: between zones -> orthogonal through the corridors; otherwise bezier
  const pending = [...derivedConnections(board), ...board.connections].filter((c) => !out.connections[c.id] && out.elements[c.from] && out.elements[c.to]);
  const needsRouter = pending.some((c) => elZone.get(c.from) !== elZone.get(c.to));
  const router = needsRouter
    ? new Router({
        bounds: union(Object.values(out.zones)),
        elements: allElements,
        zones: Object.values(out.zones),
        headers: board.zones.map((z) => {
          const r = out.zones[z.id];
          return { x: r.x, y: r.y, w: Math.min(r.w, z.title.length * 13 + 2 * PAD), h: HEADER };
        }),
      })
    : null;
  for (const c of pending) {
    const a = out.elements[c.from], b = out.elements[c.to];
    const cross = elZone.get(c.from) !== elZone.get(c.to);
    let g: ConnectionGeom | undefined;
    if (cross && router) {
      const pts = router.route(a, b);
      if (pts) g = { kind: "poly", pts, cross: true };
    }
    if (!g) {
      const obstacles = allElements.filter((r) => r !== a && r !== b);
      g = routeCurve(a, b, obstacles, 0.12);
      if (cross) g.cross = true;
    }
    if (c.label) {
      const m = placeLabel(g, c.label, labelObs, takenLabels);
      g.label = { x: m.x, y: m.y, text: c.label };
      takenLabels.push(labelRect(g.label));
    }
    out.connections[c.id] = g;
  }

  // callouts with an arrow
  const taken: Rect[] = [...takenLabels];
  const rectOf = (id: string): Rect | undefined => out.elements[id] ?? out.zones[id] ?? connectionMid(out, id);
  for (const co of board.callouts) {
    const tr = rectOf(co.target);
    if (!tr) continue;
    const lines = wrapText(co.text, 20);
    const box: Rect = { x: 0, y: 0, w: maxLen(lines) * CALLOUT_CW + 24, h: lines.length * CALLOUT_LH + 14 };
    const targetEl = findElement(board, co.target);
    const zr = out.zones[targetEl?.zone ?? co.target] ?? tr;
    const placed = placeCallout(box, tr, zr, Object.values(out.zones), [...allElements, ...circles], taken);
    taken.push(placed);
    const obstacles = allElements.filter((r) => r !== tr);
    const arrow = routeCurve(placed, tr, obstacles, 0.25);
    out.callouts[co.id] = { box: placed, lines, arrow };
  }

  out.bounds = union([...Object.values(out.zones), ...Object.values(out.callouts).map((c) => c.box)]);
  return out;
}

function placeCallout(box: Rect, target: Rect, zone: Rect, zones: Rect[], elements: Rect[], taken: Rect[]): Rect {
  const t = center(target);
  const cands: Rect[] = [];
  for (let k = 0; k < 8; k++) {
    const d = 30 + k * 30;
    for (const s of [-1, 0, 1]) {
      const cy = Math.min(Math.max(t.y - box.h / 2 + s * (box.h + 12), zone.y), rectBottom(zone) - box.h);
      const cx = Math.min(Math.max(t.x - box.w / 2 + s * (box.w + 12), zone.x), rectRight(zone) - box.w);
      cands.push({ ...box, x: rectRight(zone) + d, y: cy });
      cands.push({ ...box, x: cx, y: zone.y - d - box.h });
      cands.push({ ...box, x: zone.x - d - box.w, y: cy });
      cands.push({ ...box, x: cx, y: rectBottom(zone) + d });
    }
  }
  const dist = (c: Rect) => Math.hypot(center(c).x - t.x, center(c).y - t.y);
  const free = cands.filter((c) => ![...zones, ...elements, ...taken].some((o) => overlaps(c, o, 14))).sort((a, b) => dist(a) - dist(b));
  return free[0] ?? cands[0];
}

export type { BoardLayout, ConnectionGeom, MarkGeom, Pt, Rect, ScaleGeom, SpanGeom } from "./types";
export { bezierAt } from "./edges";
export { LABEL_LH, LABEL_SIZE, labelLines, labelRect, overlaps } from "./geometry";
export { clearLayoutCache } from "./zones";
