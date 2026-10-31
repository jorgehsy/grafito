import { center, labelRect, overlaps, rectBottom, rectRight } from "./geometry";
import type { BoardLayout, ConnectionGeom, Pt, Rect } from "./types";

const inflate = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
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

export function longestSegmentMid(pts: Pt[]): Pt {
  let best = 0, mid = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (l > best) { best = l; mid = { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 }; }
  }
  return mid;
}

export function connectionMid(out: BoardLayout, id: string): Rect | undefined {
  const e = out.connections[id];
  if (!e) return undefined;
  const m = e.kind === "curve" ? bezierAt(e.pts, 0.5) : longestSegmentMid(e.pts);
  return { x: m.x - 4, y: m.y - 4, w: 8, h: 8 };
}
