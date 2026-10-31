import type { Element, Zone } from "../model";
import { elementSize } from "./geometry";
import type { ZoneLocal } from "./types";

export function layoutStack(zone: Zone, elements: Element[]): ZoneLocal {
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
