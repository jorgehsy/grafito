import type { Element, Zone } from "../model";
import { elementSize, maxLen, overlaps, rectBottom, rectRight, wrapText } from "./geometry";
import type { Pt, Rect, ZoneLocal } from "./types";

const CYCLE_MARGIN = 26;

/** Stages on an elliptical ring (in insertion order or after `after`), with clockwise arrows, the last closing back to the first. */
export function layoutCycle(zone: Zone, elements: Element[]): ZoneLocal {
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
