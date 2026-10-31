import type { Element, Zone } from "../model";
import { MARK_GAP, TL_LANE_H, elementSize, rectRight, spreadRow } from "./geometry";
import type { ZoneLocal } from "./types";

const TL_BASE_W = 760;
const TL_STEM = 46;
const TL_WHEN_H = 24;
const TL_WHEN_CW = 9.8;
const TL_LANE_GAP = 4;

/** Horizontal axis with an arrow: events (mark + date + box above/below, alternating) and spans (brackets under the axis). */
export function layoutTimeline(zone: Zone, elements: Element[]): ZoneLocal {
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
