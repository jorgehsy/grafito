import type { Element, Zone } from "../model";
import { LABEL_CW, MARK_GAP, elementSize, spreadRow } from "./geometry";
import type { ZoneLocal } from "./types";

export const SCALE_W = 720;
export const SCALE_BAR_H = 34;
export const SCALE_STEM = 34;

/** Horizontal bar with marks: sorted by position, split above/below and spaced so they don't overlap. */
export function layoutScale(zone: Zone, elements: Element[]): ZoneLocal {
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
