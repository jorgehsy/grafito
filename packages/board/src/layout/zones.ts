import type { Board, Zone } from "../model";
import { derivedConnections } from "../model";
import { layoutCycle } from "./cycle";
import { layoutElkWithEmph } from "./elk";
import { HEADER, PAD, ZONE_GAP, labelRect, overlaps, rectBottom, rectRight, union } from "./geometry";
import { layoutMindmap } from "./mindmap";
import { layoutScale } from "./scale";
import { layoutStack } from "./stack";
import { layoutTimeline } from "./timeline";
import { layoutTree } from "./tree";
import type { Pt, Rect, ZoneLocal } from "./types";

const ROW_MAX = 2300;
const COMPARE_TITLE_H = 40;

const cache = new Map<string, ZoneLocal>();
export const clearLayoutCache = () => cache.clear();

export async function layoutZone(board: Board, zone: Zone): Promise<ZoneLocal> {
  const elements = board.elements.filter((e) => e.zone === zone.id);
  const ids = new Set(elements.map((e) => e.id));
  const connections =
    zone.kind === "flow" || zone.kind === "system"
      ? [...derivedConnections(board), ...board.connections].filter((c) => ids.has(c.from) && ids.has(c.to))
      : [];
  const circled = board.emphasis.filter((m) => m.style === "circle" && ids.has(m.target)).map((m) => m.target);
  const key = JSON.stringify([zone.kind, zone.title, zone.leftTitle, zone.rightTitle, zone.minLabel, zone.maxLabel, zone.centerLabel, elements, connections, circled]);
  let content = cache.get(key);
  if (!content) {
    if (zone.kind === "scale") content = layoutScale(zone, elements);
    else if (zone.kind === "cycle") content = layoutCycle(zone, elements);
    else if (zone.kind === "timeline") content = layoutTimeline(zone, elements);
    else if (!elements.length) content = { w: 0, h: 0, elements: {}, connections: {} };
    else if (zone.kind === "flow" || zone.kind === "system") content = await layoutElkWithEmph(zone, elements, connections, circled);
    else if (zone.kind === "mindmap") content = layoutMindmap(elements);
    else if (zone.kind === "tree") content = layoutTree(elements);
    else content = layoutStack(zone, elements);
    if (cache.size > 300) cache.clear();
    cache.set(key, content);
  }
  // normalize: content starts at (0,0)
  const all = [...Object.values(content.elements), ...Object.values(content.labels ?? {}), ...(content.scale ? [content.scale.bar] : [])];
  const box = union(all);
  const connectionPts = Object.values(content.connections).flatMap((e) => e.pts);
  const minX = Math.min(box.x, ...connectionPts.map((p) => p.x)), minY = Math.min(box.y, ...connectionPts.map((p) => p.y));
  const maxX = Math.max(rectRight(box), ...connectionPts.map((p) => p.x)), maxY = Math.max(rectBottom(box), ...connectionPts.map((p) => p.y));
  const labelBox = Object.values(content.connections).flatMap((e) => (e.label ? [labelRect(e.label)] : []));
  const lx0 = Math.min(minX, ...labelBox.map((l) => l.x));
  const lx1 = Math.max(maxX, ...labelBox.map(rectRight));
  const ly0 = Math.min(minY, ...labelBox.map((l) => l.y));
  const ly1 = Math.max(maxY, ...labelBox.map(rectBottom));
  const x0 = all.length ? lx0 : 0, y0 = all.length ? ly0 : 0;
  const titleW = Math.max(zone.title.length * 13 + 2 * PAD, zone.kind === "compare" ? 300 : 0, 240);
  const top = HEADER + (zone.kind === "compare" ? COMPARE_TITLE_H : 0);
  const cw = all.length ? lx1 - x0 : 0, ch = all.length ? ly1 - y0 : 0;
  const w = Math.max(titleW, cw + 2 * PAD);
  const h = Math.max(top + 90, top + ch + PAD * 1.4);
  const ox = PAD + (w - 2 * PAD - cw) / 2 - x0; // centers the content
  const oy = top + PAD * 0.4 - y0;
  const sh = (p: Pt): Pt => ({ x: p.x + ox, y: p.y + oy });
  const res: ZoneLocal = { w, h, elements: {}, connections: {}, divider: content.divider !== undefined ? content.divider + ox : undefined, marks: content.marks && Object.fromEntries(Object.entries(content.marks).map(([id, m]) => [id, { ...m, stem: m.stem.map(sh) }])) };
  if (content.spans) res.spans = Object.fromEntries(Object.entries(content.spans).map(([id, p]) => [id, { x0: p.x0 + ox, x1: p.x1 + ox }]));
  if (content.labels) res.labels = Object.fromEntries(Object.entries(content.labels).map(([id, r]) => [id, { x: r.x + ox, y: r.y + oy, w: r.w, h: r.h }]));
  if (content.scale) res.scale = { ...content.scale, bar: { ...content.scale.bar, x: content.scale.bar.x + ox, y: content.scale.bar.y + oy } };
  for (const [id, r] of Object.entries(content.elements)) res.elements[id] = { x: r.x + ox, y: r.y + oy, w: r.w, h: r.h };
  for (const [id, e] of Object.entries(content.connections))
    res.connections[id] = { kind: e.kind, pts: e.pts.map(sh), label: e.label ? { ...e.label, ...sh(e.label) } : undefined };
  return res;
}

export function placeZones(zones: Zone[], sizes: Record<string, { w: number; h: number }>): Record<string, Rect> {
  const placed: Record<string, Rect> = {};
  let rowX = 0, rowY = 0, maxBottom = 0;
  for (const z of zones) {
    const s = sizes[z.id];
    const ref = z.place ? placed[z.place.of] : undefined;
    let x: number, y: number;
    if (z.place && ref) {
      if (z.place.relation === "right_of") { x = rectRight(ref) + ZONE_GAP; y = ref.y; }
      else { x = ref.x; y = rectBottom(ref) + ZONE_GAP; }
    } else {
      if (rowX > 0 && rowX + s.w > ROW_MAX) { rowX = 0; rowY = maxBottom + ZONE_GAP; }
      x = rowX; y = rowY;
    }
    for (let guard = 0; guard < 200; guard++) {
      const hit = Object.values(placed).find((p) => overlaps({ x, y, w: s.w, h: s.h }, p, ZONE_GAP * 0.6));
      if (!hit) break;
      if (z.place && ref) y = rectBottom(hit) + ZONE_GAP;
      else x = rectRight(hit) + ZONE_GAP;
    }
    placed[z.id] = { x, y, w: s.w, h: s.h };
    if (!(z.place && ref)) rowX = x + s.w + ZONE_GAP;
    maxBottom = Math.max(maxBottom, y + s.h);
  }
  return placed;
}
