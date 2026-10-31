// Pure camera: computes the target framing and smooths it.
import type { Rect } from "./layout";

export interface Cam { cx: number; cy: number; scale: number } // scale = screen px per world unit
export interface View { w: number; h: number }

export const MIN_READABLE = 0.85;
/** ms without drawing after which the whole board is shown */
export const IDLE_OVERVIEW_MS = 4000;
export const MAX_AUTO = 1;
const MARGIN = 70;

/**
 * Target framing. Following: the whole board if it fits at a readable scale; otherwise the minimum readable
 * scale centered on `focus`. `overview`: always the whole board (rest state).
 */
export function targetCam(focus: Rect | null, bounds: Rect, view: View, overview = false): Cam {
  const bc = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
  if (bounds.w <= 0 || bounds.h <= 0) return { cx: bc.x, cy: bc.y, scale: 1 };
  const fit = Math.min(view.w / (bounds.w + 2 * MARGIN), view.h / (bounds.h + 2 * MARGIN));
  if (overview || fit >= MIN_READABLE || !focus) return { cx: bc.x, cy: bc.y, scale: Math.min(MAX_AUTO, Math.max(fit, 0.05)) };
  const scale = MIN_READABLE;
  const vw = view.w / scale, vh = view.h / scale;
  const clampAxis = (c: number, lo: number, size: number, vsize: number) => {
    if (size + 2 * MARGIN <= vsize) return lo + size / 2;
    return Math.min(Math.max(c, lo - MARGIN + vsize / 2), lo + size + MARGIN - vsize / 2);
  };
  return {
    cx: clampAxis(focus.x + focus.w / 2, bounds.x, bounds.w, vw),
    cy: clampAxis(focus.y + focus.h / 2, bounds.y, bounds.h, vh),
    scale,
  };
}

/** Exponential smoothing (ease-out); scale is smoothed in log space so zoom feels uniform. */
export function stepCam(cur: Cam, target: Cam, dtMs: number, tauMs = 380): Cam {
  const k = 1 - Math.exp(-dtMs / tauMs);
  const ls = Math.log(cur.scale) + (Math.log(target.scale) - Math.log(cur.scale)) * k;
  return { cx: cur.cx + (target.cx - cur.cx) * k, cy: cur.cy + (target.cy - cur.cy) * k, scale: Math.exp(ls) };
}

export function viewBoxOf(cam: Cam, view: View): [number, number, number, number] {
  const w = view.w / cam.scale, h = view.h / cam.scale;
  return [cam.cx - w / 2, cam.cy - h / 2, w, h];
}

/** Wheel zoom around a screen point. */
export function zoomAt(cam: Cam, view: View, sx: number, sy: number, factor: number): Cam {
  const scale = Math.min(2.5, Math.max(0.12, cam.scale * factor));
  // the world point under the cursor stays fixed
  const wx = cam.cx + (sx - view.w / 2) / cam.scale, wy = cam.cy + (sy - view.h / 2) / cam.scale;
  return { scale, cx: wx - (sx - view.w / 2) / scale, cy: wy - (sy - view.h / 2) / scale };
}
