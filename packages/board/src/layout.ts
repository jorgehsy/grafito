// Pure layout (no React): positions zones on the board and elements inside each zone.
// ELK (layered, RIGHT) for flow/system; d3-hierarchy for mindmap; stacked rows for list/compare.
import ELK from "elkjs/lib/elk.bundled.js";
import { hierarchy, tree } from "d3-hierarchy";
import type { Board, Connection, Element, Zone } from "./model";
import { derivedConnections, findElement, findZone } from "./model";
import { Router } from "./route";

export interface Pt { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface ConnectionGeom {
  /** poly: orthogonal polyline (ELK). curve: 4 control points of a cubic bezier. */
  kind: "poly" | "curve";
  pts: Pt[];
  label?: { x: number; y: number; text: string };
  /** connection between zones (drawn lighter) */
  cross?: boolean;
}
export interface BoardLayout {
  zones: Record<string, Rect>;
  elements: Record<string, Rect>;
  connections: Record<string, ConnectionGeom>;
  callouts: Record<string, { box: Rect; lines: string[]; arrow: ConnectionGeom }>;
  /** compare: absolute x of each zone's divider line */
  dividers: Record<string, number>;
  /** scale: bar per zone (absolute rect with the end labels; x0 = start of the bar relative to rect.x) */
  scales: Record<string, ScaleGeom>;
  /** scale: side and stem of each mark */
  marks: Record<string, MarkGeom>;
  /** timeline: absolute x (start and end) of each span's bracket */
  spans: Record<string, SpanGeom>;
  /** loose texts with their own box: `when:<event>` (timeline) and `center:<zone>` (cycle) */
  labels: Record<string, Rect>;
  bounds: Rect;
}
export interface SpanGeom { x0: number; x1: number }
export interface ScaleGeom { bar: Rect; x0: number; w: number; h: number }
/** stem: [far edge of the bar, near edge (where the notch goes), attachment point on the box] */
export interface MarkGeom { side: "above" | "below"; stem: Pt[] }

export const FONT = 20;
export const CHAR_W = 10.1;
export const LINE_H = 24;
export const HEADER = 50;
export const PAD = 26;
export const ZONE_GAP = 150;
export const LABEL_SIZE = 21;
export const LABEL_LH = 24;
/** Arrow labels longer than this are split into two lines. */
const LABEL_MAX_1LINE = 22;
const LABEL_CW = 10.3;
const CALLOUT_CW = 12.2;
const CALLOUT_LH = 29;
const ROW_MAX = 2300;
const COMPARE_TITLE_H = 40;
export const SCALE_W = 720;
export const SCALE_BAR_H = 34;
export const SCALE_STEM = 34;
const MARK_LABEL_CW = 11.0;
const MARK_NOTE_CW = 9.1;
const MARK_LABEL_LH = 27;
const MARK_NOTE_LH = 22;
const MARK_GAP = 14;
const TL_BASE_W = 760;
const TL_STEM = 46;
const TL_WHEN_H = 24;
const TL_WHEN_CW = 9.8;
const TL_LANE_H = 44;
const TL_LANE_GAP = 4;
const CYCLE_MARGIN = 26;

export function wrapText(text: string, max: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
const maxLen = (lines: string[]) => Math.max(...lines.map((l) => [...l].length));
/** Arrow label: one line if short; otherwise two as even as possible (cut at the space closest to the middle). */
export function labelLines(text: string): string[] {
  const t = text.trim();
  if ([...t].length <= LABEL_MAX_1LINE) return [t];
  let cut = -1;
  for (let i = 0; i < t.length; i++) if (t[i] === " " && (cut < 0 || Math.abs(i - t.length / 2) < Math.abs(cut - t.length / 2))) cut = i;
  return cut < 0 ? [t] : [t.slice(0, cut), t.slice(cut + 1)];
}

/** Visible lines of an element (the icon goes before the first). */
export function elementLines(e: Element): string[] {
  const wrap = e.type === "mark" || e.type === "event" || e.type === "span" || e.type === "branch" ? 18 : e.type === "stage" ? 16 : e.type === "decision" ? 14 : e.type === "item" ? 28 : e.type === "node" ? 20 : e.comp === "actor" ? 14 : 18;
  const lines = wrapText(e.label, wrap);
  if (e.icon) lines[0] = `${e.icon} ${lines[0]}`;
  return lines;
}

/** Lines of the explanation of a mark, stage or event (below its label). */
export const markNoteLines = (e: Element): string[] => (e.note ? wrapText(e.note, 22) : []);

export function elementSize(e: Element): { w: number; h: number } {
  const lines = elementLines(e);
  const tw = maxLen(lines) * CHAR_W;
  const th = lines.length * LINE_H;
  switch (e.type) {
    case "step": return { w: Math.max(130, tw + 40), h: Math.max(56, th + 28) };
    case "decision": return { w: Math.max(180, tw * 1.9 + 20), h: Math.max(104, th * 2 + 24) };
    case "node": return { w: Math.max(110, tw + 40), h: th + 26 };
    case "item": return { w: tw + 36, h: th + 10 };
    case "mark": {
      const nl = markNoteLines(e);
      return {
        w: Math.max(maxLen(lines) * MARK_LABEL_CW, nl.length ? maxLen(nl) * MARK_NOTE_CW : 0) + 14,
        h: lines.length * MARK_LABEL_LH + nl.length * MARK_NOTE_LH + 10,
      };
    }
    case "stage":
    case "branch":
    case "event": {
      const nl = markNoteLines(e);
      return {
        w: Math.max(e.type === "stage" ? 130 : e.type === "branch" ? 90 : 100, maxLen(lines) * MARK_LABEL_CW, nl.length ? maxLen(nl) * MARK_NOTE_CW : 0) + 34,
        h: lines.length * MARK_LABEL_LH + nl.length * MARK_NOTE_LH + 26,
      };
    }
    case "span": {
      const w = [...e.label].length * LABEL_CW + 16;
      return { w, h: TL_LANE_H };
    }
    case "component":
      switch (e.comp) {
        case "actor": return { w: Math.max(96, tw + 16), h: 86 + th };
        case "client": return { w: Math.max(160, tw + 40), h: Math.max(96, th + 70) };
        case "database": return { w: Math.max(130, tw + 40), h: Math.max(100, th + 66) };
        case "queue": return { w: Math.max(170, tw + 66), h: Math.max(78, th + 48) };
        case "storage": return { w: Math.max(140, tw + 50), h: Math.max(94, th + 54) };
        case "external": return { w: Math.max(180, tw + 70), h: Math.max(96, th + 58) };
        default: return { w: Math.max(140, tw + 40), h: Math.max(68, th + 30) };
      }
  }
}

export const rectRight = (r: Rect) => r.x + r.w;
export const rectBottom = (r: Rect) => r.y + r.h;
export const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export function overlaps(a: Rect, b: Rect, m = 0): boolean {
  return a.x < rectRight(b) + m && b.x < rectRight(a) + m && a.y < rectBottom(b) + m && b.y < rectBottom(a) + m;
}
const inflate = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
/** Box (with a background patch) of a connection label centered at (x, y). */
export function labelRect(l: { x: number; y: number; text: string }): Rect {
  const lines = labelLines(l.text);
  const w = maxLen(lines) * LABEL_CW + 14, h = lines.length * LABEL_LH + 8;
  return { x: l.x - w / 2, y: l.y - h / 2, w, h };
}
/** Emphasis ellipse around an element: roomy so it doesn't clip its corners. */
export function emphasisRect(r: Rect): Rect {
  const w = r.w * 1.25 + 16, h = r.h * 1.25 + 16;
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
}
function samplePath(g: ConnectionGeom, step = 8): { p: Pt; s: number }[] {
  const raw: Pt[] = [];
  if (g.kind === "curve") for (let i = 0; i <= 40; i++) raw.push(bezierAt(g.pts, i / 40));
  else raw.push(...g.pts);
  const out: { p: Pt; s: number }[] = [{ p: raw[0], s: 0 }];
  let s = 0;
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1], b = raw[i];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const k = Math.max(1, Math.ceil(l / step));
    for (let j = 1; j <= k; j++) out.push({ p: { x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k }, s: s + (l * j) / k });
    s += l;
  }
  return out;
}
/** Point on the path, as close to its middle as possible, where the label overlaps no boxes or other labels. */
export function placeLabel(g: ConnectionGeom, text: string, obstacles: Rect[], taken: Rect[]): Pt {
  const pts = samplePath(g);
  const total = pts[pts.length - 1].s;
  const order = pts.filter((q) => q.s >= Math.min(24, total / 3) && q.s <= total - Math.min(24, total / 3));
  const cand = (order.length ? order : pts).slice().sort((a, b) => Math.abs(a.s - total / 2) - Math.abs(b.s - total / 2));
  const bad = (r: Rect) => obstacles.some((o) => overlaps(r, o, 2)) || taken.some((o) => overlaps(r, o, 4));
  for (const q of cand) if (!bad(labelRect({ ...q.p, text }))) return q.p;
  // no gap on the line: shift perpendicularly
  for (const off of [26, -26, 40, -40]) {
    for (const q of cand) {
      for (const pt of [{ x: q.p.x, y: q.p.y + off }, { x: q.p.x + off, y: q.p.y }]) if (!bad(labelRect({ ...pt, text }))) return pt;
    }
  }
  return cand[0].p;
}
function union(rs: Rect[]): Rect {
  if (!rs.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map(rectRight)) - x, h: Math.max(...rs.map(rectBottom)) - y };
}
/** Point on r's border in the direction of `to` from its center. */
function clip(r: Rect, to: Pt, out = 4): Pt {
  const c = center(r);
  const dx = to.x - c.x, dy = to.y - c.y;
  if (!dx && !dy) return c;
  const sx = dx ? (r.w / 2 + out) / Math.abs(dx) : Infinity;
  const sy = dy ? (r.h / 2 + out) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);
  return { x: c.x + dx * s, y: c.y + dy * s };
}
export function bezierAt(p: Pt[], t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * p[0].x + 3 * u * u * t * p[1].x + 3 * u * t * t * p[2].x + t * t * t * p[3].x,
    y: u * u * u * p[0].y + 3 * u * u * t * p[1].y + 3 * u * t * t * p[2].y + t * t * t * p[3].y,
  };
}
function hits(p: Pt[], obstacles: Rect[]): number {
  let n = 0;
  for (const o of obstacles) {
    for (let i = 1; i < 24; i++) {
      const q = bezierAt(p, i / 24);
      if (q.x > o.x && q.x < rectRight(o) && q.y > o.y && q.y < rectBottom(o)) { n++; break; }
    }
  }
  return n;
}

/** Bezier curve between two rectangles; tries lateral offsets to dodge obstacles. */
export function routeCurve(a: Rect, b: Rect, obstacles: Rect[], curvature = 0.1): ConnectionGeom {
  const ca = center(a), cb = center(b);
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  const dist = Math.hypot(dx, dy) || 1;
  const n = { x: -dy / dist, y: dx / dist };
  const obs = obstacles.map((o) => inflate(o, 4));
  let best: Pt[] | null = null;
  let bestHits = Infinity;
  for (const off of [0, 1, -1, 2, -2, 3.5, -3.5, 5, -5]) {
    const o = off * 60 + curvature * dist;
    const c1 = { x: ca.x + dx * 0.33 + n.x * o, y: ca.y + dy * 0.33 + n.y * o };
    const c2 = { x: ca.x + dx * 0.66 + n.x * o, y: ca.y + dy * 0.66 + n.y * o };
    const p = [clip(a, c1), c1, c2, clip(b, c2, 6)];
    const h = hits(p, obs);
    if (h < bestHits) { best = p; bestHits = h; }
    if (h === 0) break;
  }
  return { kind: "curve", pts: best! };
}

interface ZoneLocal {
  w: number;
  h: number;
  elements: Record<string, Rect>;
  connections: Record<string, ConnectionGeom>;
  /** compare: x of the divider line */
  divider?: number;
  scale?: ScaleGeom;
  marks?: Record<string, MarkGeom>;
  spans?: Record<string, SpanGeom>;
  labels?: Record<string, Rect>;
  /** flow/system: direction ELK used */
  dir?: "RIGHT" | "DOWN";
}

const elk = new ELK();

function longestSegmentMid(pts: Pt[]): Pt {
  let best = 0, mid = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (l > best) { best = l; mid = { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 }; }
  }
  return mid;
}

async function layoutElk(zone: Zone, elements: Element[], connections: Connection[], extraObs: Rect[], dir: "RIGHT" | "DOWN" = "RIGHT"): Promise<ZoneLocal> {
  const sizes = Object.fromEntries(elements.map((e) => [e.id, elementSize(e)]));
  const hasLabels = connections.some((c) => c.label);
  const graph = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": dir,
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "46",
      "elk.layered.spacing.nodeNodeBetweenLayers": hasLabels ? "120" : "70",
      "elk.layered.spacing.edgeNodeBetweenLayers": "26",
      "elk.spacing.edgeEdge": "18",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      "elk.layered.cycleBreaking.strategy": "MODEL_ORDER",
      "elk.layered.crossingMinimization.forceNodeModelOrder": "false",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.separateConnectedComponents": "true",
      "elk.spacing.componentComponent": "50",
      // ELK reserves room for each label so they don't land on top of the boxes
      "elk.edgeLabels.placement": "CENTER",
      "elk.spacing.edgeLabel": "6",
    },
    children: elements.map((e) => ({ id: e.id, width: sizes[e.id].w, height: sizes[e.id].h })),
    edges: connections.map((c) => {
      if (!c.label) return { id: c.id, sources: [c.from], targets: [c.to] };
      const r = labelRect({ x: 0, y: 0, text: c.label });
      return { id: c.id, sources: [c.from], targets: [c.to], labels: [{ id: `${c.id}:l`, text: c.label, width: r.w, height: r.h }] };
    }),
  };
  const res: any = await elk.layout(graph as any);
  const out: ZoneLocal = { w: 0, h: 0, elements: {}, connections: {}, dir };
  for (const ch of res.children) out.elements[ch.id] = { x: ch.x, y: ch.y, w: ch.width, h: ch.height };
  for (const e of res.edges ?? []) {
    const s = e.sections?.[0];
    if (!s) continue;
    const pts: Pt[] = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p: Pt) => ({ x: p.x, y: p.y }));
    out.connections[e.id] = { kind: "poly", pts };
  }
  const elkLabel = new Map<string, Pt>();
  for (const e of res.edges ?? []) {
    const l = e.labels?.[0];
    if (l && l.x !== undefined) elkLabel.set(e.id, { x: l.x + l.width / 2, y: l.y + l.height / 2 });
  }
  const obs = [...Object.values(out.elements), ...extraObs.map((r) => ({ ...r }))];
  const taken: Rect[] = [];
  const free = (r: Rect) => !obs.some((o) => overlaps(r, o, 2)) && !taken.some((o) => overlaps(r, o, 4));
  for (const c of connections) {
    const g = out.connections[c.id];
    if (!g || !c.label) continue;
    const at = elkLabel.get(c.id);
    const m = at && free(labelRect({ ...at, text: c.label })) ? at : placeLabel(g, c.label, obs, taken);
    g.label = { x: m.x, y: m.y, text: c.label };
    taken.push(labelRect(g.label));
  }
  return out;
}

function layoutMindmap(elements: Element[]): ZoneLocal {
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

const TREE_COL_GAP = 76;
const TREE_ROW_GAP = 14;
const TREE_ROOT_GAP = 30;

/** Left-to-right tree: one column per depth (width = the widest label of the level),
 *  siblings stacked in arrival order, each parent centered on its children, with elbow connectors. */
function layoutTree(elements: Element[]): ZoneLocal {
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

/** Spreads boxes (ideal center c, width w) in a row without overlaps, with minimal total displacement. */
function spreadRow(items: { c: number; w: number }[], gap: number): number[] {
  interface Cl { idx: number[]; left: number }
  const widthOf = (idx: number[]) => idx.reduce((a, i) => a + items[i].w, 0) + gap * (idx.length - 1);
  const idealLeft = (cl: number[]) => {
    let off = 0, sum = 0;
    for (const i of cl) { sum += items[i].c - items[i].w / 2 - off; off += items[i].w + gap; }
    return sum / cl.length;
  };
  const cls: Cl[] = [];
  items.forEach((it, i) => {
    let cur: Cl = { idx: [i], left: it.c - it.w / 2 };
    for (;;) {
      const prev = cls[cls.length - 1];
      if (!prev || prev.left + widthOf(prev.idx) + gap <= cur.left + 1e-6) break;
      cls.pop();
      const idx = [...prev.idx, ...cur.idx];
      cur = { idx, left: idealLeft(idx) };
    }
    cls.push(cur);
  });
  const out: number[] = [];
  for (const cl of cls) {
    let x = cl.left;
    for (const i of cl.idx) { out[i] = x + items[i].w / 2; x += items[i].w + gap; }
  }
  return out;
}

/** Horizontal bar with marks: sorted by position, split above/below and spaced so they don't overlap. */
function layoutScale(zone: Zone, elements: Element[]): ZoneLocal {
  const minL = zone.minLabel ?? "0%", maxL = zone.maxLabel ?? "100%";
  const leftW = Math.max(46, [...minL].length * LABEL_CW + 18);
  const rightW = Math.max(54, [...maxL].length * LABEL_CW + 18);
  const out: ZoneLocal = { w: 0, h: 0, elements: {}, connections: {}, marks: {} };
  const marks = elements.filter((e) => e.type === "mark").sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  const info = marks.map((e) => ({ e, s: elementSize(e), cx: leftW + ((e.at ?? 0) / 100) * SCALE_W, side: "above" as "above" | "below" }));
  // side: above if it fits next to the previous one on that side; otherwise below; if neither, the less crowded
  const reach = { above: -Infinity, below: -Infinity };
  for (const m of info) {
    const left = m.cx - m.s.w / 2;
    const clash = (side: "above" | "below") => reach[side] + MARK_GAP - left;
    m.side = clash("above") <= 0 ? "above" : clash("below") <= 0 ? "below" : clash("below") < clash("above") ? "below" : "above";
    reach[m.side] = Math.max(reach[m.side], m.cx + m.s.w / 2);
  }
  for (const side of ["above", "below"] as const) {
    const row = info.filter((m) => m.side === side);
    const centers = spreadRow(row.map((m) => ({ c: m.cx, w: m.s.w })), MARK_GAP);
    row.forEach((m, k) => {
      const x = centers[k] - m.s.w / 2;
      const y = side === "above" ? -SCALE_STEM - m.s.h : SCALE_BAR_H + SCALE_STEM;
      out.elements[m.e.id] = { x, y, w: m.s.w, h: m.s.h };
      const attach = Math.min(Math.max(m.cx, x + 10), x + m.s.w - 10);
      // [far edge of the bar, near edge (notch), box point]
      out.marks![m.e.id] = {
        side,
        stem: [
          { x: m.cx, y: side === "above" ? SCALE_BAR_H : 0 },
          { x: m.cx, y: side === "above" ? 0 : SCALE_BAR_H },
          { x: attach, y: side === "above" ? -SCALE_STEM : SCALE_BAR_H + SCALE_STEM },
        ],
      };
    });
  }
  out.scale = { bar: { x: 0, y: 0, w: leftW + SCALE_W + rightW, h: SCALE_BAR_H }, x0: leftW, w: SCALE_W, h: SCALE_BAR_H };
  return out;
}

/** Stages on an elliptical ring (in insertion order or after `after`), with clockwise arrows, the last closing back to the first. */
function layoutCycle(zone: Zone, elements: Element[]): ZoneLocal {
  const out: ZoneLocal = { w: 0, h: 0, elements: {}, connections: {}, labels: {} };
  const stages: Element[] = [];
  for (const e of elements) {
    if (e.type !== "stage") continue;
    const k = e.after ? stages.findIndex((x) => x.id === e.after) : -1;
    if (k >= 0) stages.splice(k + 1, 0, e);
    else stages.push(e);
  }
  const n = stages.length;
  const sizes = stages.map(elementSize);
  let center: Rect | null = null;
  if (zone.centerLabel) {
    const lines = wrapText(zone.centerLabel, 14);
    center = { x: 0, y: 0, w: maxLen(lines) * 13 + 40, h: lines.length * 30 + 22 };
  }
  if (!n) {
    if (center) { out.labels![`center:${zone.id}`] = center; }
    return out;
  }
  if (n === 1) {
    out.elements[stages[0].id] = { x: 0, y: 0, w: sizes[0].w, h: sizes[0].h };
    if (center) out.labels![`center:${zone.id}`] = { ...center, x: sizes[0].w + 60, y: (sizes[0].h - center.h) / 2 };
    return out;
  }
  const ang = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const rectsAt = (rx: number, ry: number) =>
    stages.map((_, i) => ({ x: rx * Math.cos(ang(i)) - sizes[i].w / 2, y: ry * Math.sin(ang(i)) - sizes[i].h / 2, w: sizes[i].w, h: sizes[i].h }));
  const inside = (r: Rect, p: Pt, m: number) => p.x > r.x - m && p.x < rectRight(r) + m && p.y > r.y - m && p.y < rectBottom(r) + m;
  /** angles at which the ring leaves box i going forward / enters box i going backward */
  const arcSpan = (rx: number, ry: number, rects: Rect[], i: number) => {
    const j = (i + 1) % n;
    const at = (t: number): Pt => ({ x: rx * Math.cos(t), y: ry * Math.sin(t) });
    let t0 = ang(i), t1 = ang(i) + (2 * Math.PI) / n;
    while (t0 < t1 && inside(rects[i], at(t0), 7)) t0 += 0.01;
    while (t1 > t0 && inside(rects[j], at(t1), 9)) t1 -= 0.01;
    return { t0, t1 };
  };
  const cr = center ? { x: -center.w / 2, y: -center.h / 2, w: center.w, h: center.h } : null;
  let rx = 120, ry = 80, rects = rectsAt(rx, ry);
  for (let r = 80; r < 1600; r += 10) {
    ry = r; rx = r * 1.5; rects = rectsAt(rx, ry);
    let ok = true;
    for (let a = 0; a < n && ok; a++) {
      for (let b = a + 1; b < n && ok; b++) if (overlaps(rects[a], rects[b], CYCLE_MARGIN)) ok = false;
      if (ok && cr && overlaps(rects[a], cr, 22)) ok = false;
      if (ok) { const sp = arcSpan(rx, ry, rects, a); if (sp.t1 - sp.t0 < 0.3) ok = false; }
    }
    if (ok) break;
  }
  stages.forEach((e, i) => (out.elements[e.id] = rects[i]));
  if (center && cr) out.labels![`center:${zone.id}`] = cr;
  for (let i = 0; i < n; i++) {
    const { t0, t1 } = arcSpan(rx, ry, rects, i);
    const d = t1 - t0;
    const k = (4 / 3) * Math.tan(d / 4);
    const P = (t: number): Pt => ({ x: rx * Math.cos(t), y: ry * Math.sin(t) });
    const D = (t: number): Pt => ({ x: -rx * Math.sin(t), y: ry * Math.cos(t) });
    const p0 = P(t0), p3 = P(t1), d0 = D(t0), d3 = D(t1);
    out.connections[`ring:${stages[i].id}`] = {
      kind: "curve",
      pts: [p0, { x: p0.x + k * d0.x, y: p0.y + k * d0.y }, { x: p3.x - k * d3.x, y: p3.y - k * d3.y }, p3],
    };
  }
  return out;
}

/** Horizontal axis with an arrow: events (mark + date + box above/below, alternating) and spans (brackets under the axis). */
function layoutTimeline(zone: Zone, elements: Element[]): ZoneLocal {
  const out: ZoneLocal = { w: 0, h: 0, elements: {}, connections: {}, marks: {}, spans: {}, labels: {} };
  const events = elements.filter((e) => e.type === "event");
  const spans = elements.filter((e) => e.type === "span");
  if (!events.length && !spans.length) return out;
  const W = Math.max(TL_BASE_W, Math.ceil(events.length / 2) * 210);
  const LEFT = 40;
  const xOf = (at: number) => LEFT + (at / 100) * W;
  const n = events.length;
  const info = events
    .map((e, k) => ({ e, s: elementSize(e), at: e.at ?? (n === 1 ? 50 : 6 + (88 * k) / (n - 1)), k }))
    .sort((a, b) => a.at - b.at || a.k - b.k)
    .map((m) => ({ ...m, cx: xOf(m.at), side: "above" as "above" | "below" }));
  // sides: alternate; if the preferred one collides with the previous one on that side and the other doesn't, switch
  const reach = { above: -Infinity, below: -Infinity };
  info.forEach((m, idx) => {
    const left = m.cx - m.s.w / 2;
    const pref = idx % 2 === 0 ? "above" : "below", other = pref === "above" ? "below" : "above";
    const clash = (side: "above" | "below") => reach[side] + MARK_GAP - left;
    m.side = clash(pref) <= 0 || clash(other) > 0 ? pref : other;
    reach[m.side] = Math.max(reach[m.side], m.cx + m.s.w / 2);
  });
  // spans: lanes under the axis (below the dates)
  const lanes: number[] = [];
  const spanBoxes = spans.map((e) => {
    const s = elementSize(e);
    const x0 = xOf(e.at ?? 0), x1 = xOf(e.to ?? 100), mid = (x0 + x1) / 2;
    const left = Math.min(x0, mid - s.w / 2), right = Math.max(x1, mid + s.w / 2);
    return { e, x0, x1, left, right };
  }).sort((a, b) => a.left - b.left);
  const laneTop = TL_WHEN_H + 22;
  for (const sb of spanBoxes) {
    let lane = lanes.findIndex((r) => r + 10 <= sb.left);
    if (lane < 0) { lane = lanes.length; lanes.push(-Infinity); }
    lanes[lane] = sb.right;
    out.elements[sb.e.id] = { x: sb.left, y: laneTop + lane * (TL_LANE_H + TL_LANE_GAP), w: sb.right - sb.left, h: TL_LANE_H };
    out.spans![sb.e.id] = { x0: sb.x0, x1: sb.x1 };
  }
  const belowY = lanes.length ? laneTop + lanes.length * (TL_LANE_H + TL_LANE_GAP) + 22 : TL_STEM;
  for (const side of ["above", "below"] as const) {
    const row = info.filter((m) => m.side === side);
    const centers = spreadRow(row.map((m) => ({ c: m.cx, w: m.s.w })), MARK_GAP);
    row.forEach((m, k) => {
      const x = centers[k] - m.s.w / 2;
      const y = side === "above" ? -TL_STEM - m.s.h : belowY;
      out.elements[m.e.id] = { x, y, w: m.s.w, h: m.s.h };
      const attach = Math.min(Math.max(m.cx, x + 10), x + m.s.w - 10);
      const dot = { x: m.cx, y: 0 };
      out.marks![m.e.id] = { side, stem: [dot, dot, { x: attach, y: side === "above" ? -TL_STEM : belowY }] };
    });
    // dates: on the opposite side of the box, hugging the axis
    const dated = info.filter((m) => m.side !== side && m.e.when);
    const ws = dated.map((m) => ({ c: m.cx, w: [...m.e.when!].length * TL_WHEN_CW + 14 }));
    const cs = spreadRow(ws, 8);
    dated.forEach((m, k) => {
      out.labels![`when:${m.e.id}`] = { x: cs[k] - ws[k].w / 2, y: side === "above" ? -12 - TL_WHEN_H : 12, w: ws[k].w, h: TL_WHEN_H };
    });
  }
  const xs = [...Object.values(out.elements), ...Object.values(out.labels!)];
  const end = Math.max(LEFT + W, ...xs.map(rectRight)) + 30;
  out.connections[`axis:${zone.id}`] = { kind: "poly", pts: [{ x: 0, y: 0 }, { x: end, y: 0 }] };
  return out;
}

function layoutStack(zone: Zone, elements: Element[]): ZoneLocal {
  const out: ZoneLocal = { w: 0, h: 0, elements: {}, connections: {} };
  const GAPY = 10;
  if (zone.kind === "compare") {
    const cols = { left: 0, right: 0 } as Record<string, number>;
    const widths = { left: 170, right: 170 } as Record<string, number>;
    for (const e of elements) widths[e.column ?? "left"] = Math.max(widths[e.column ?? "left"], elementSize(e).w);
    const leftW = widths.left;
    for (const e of elements) {
      const c = e.column ?? "left";
      const s = elementSize(e);
      out.elements[e.id] = { x: c === "left" ? 0 : leftW + 60, y: cols[c], w: s.w, h: s.h };
      cols[c] += s.h + GAPY;
    }
    out.divider = leftW + 30;
    return out;
  }
  let y = 0;
  for (const e of elements) {
    const s = elementSize(e);
    out.elements[e.id] = { x: 0, y, w: s.w, h: s.h };
    y += s.h + GAPY;
  }
  return out;
}

/** The emphasis circle depends on the final position: computed with a first ELK pass. */
/** Width/height ratio we aim for: that of a landscape screen. */
const TARGET_ASPECT = 1.6;
/** Below this width, left→right is always fine (it reads better). */
const MAX_RIGHT_W = 1000;
function contentBox(z: ZoneLocal): Rect {
  return union([...Object.values(z.elements), ...Object.values(z.connections).flatMap((g) => (g.label ? [labelRect(g.label)] : []))]);
}
const aspectMiss = (r: Rect) => Math.abs(Math.log(r.w / Math.max(1, r.h) / TARGET_ASPECT));

/** Left→right unless it ends up too wide and top→bottom makes better use of the available height. */
async function layoutElkBest(zone: Zone, elements: Element[], connections: Connection[], extraObs: Rect[], dir?: "RIGHT" | "DOWN"): Promise<ZoneLocal> {
  if (dir) return layoutElk(zone, elements, connections, extraObs, dir);
  const right = await layoutElk(zone, elements, connections, extraObs, "RIGHT");
  const rb = contentBox(right);
  if (rb.w <= MAX_RIGHT_W) return right;
  const down = await layoutElk(zone, elements, connections, extraObs, "DOWN");
  return aspectMiss(contentBox(down)) < aspectMiss(rb) ? down : right;
}

async function layoutElkWithEmph(zone: Zone, elements: Element[], connections: Connection[], circled: string[]): Promise<ZoneLocal> {
  const first = await layoutElkBest(zone, elements, connections, []);
  if (!circled.length) return first;
  const extra = circled.flatMap((id) => (first.elements[id] ? [emphasisRect(first.elements[id])] : []));
  // same direction as the first pass, so the emphasis gap lands where it belongs
  const dir = first.dir;
  return layoutElkBest(zone, elements, connections, extra, dir);
}

const cache = new Map<string, ZoneLocal>();
export const clearLayoutCache = () => cache.clear();

async function layoutZone(board: Board, zone: Zone): Promise<ZoneLocal> {
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

function placeZones(zones: Zone[], sizes: Record<string, { w: number; h: number }>): Record<string, Rect> {
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

function connectionMid(out: BoardLayout, id: string): Rect | undefined {
  const e = out.connections[id];
  if (!e) return undefined;
  const m = e.kind === "curve" ? bezierAt(e.pts, 0.5) : longestSegmentMid(e.pts);
  return { x: m.x - 4, y: m.y - 4, w: 8, h: 8 };
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

export { findZone };
