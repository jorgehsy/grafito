// Hand-drawn shapes for demos: strokes that look drawn with a pen, not ruled. Deterministic (a seed, no
// Math.random), so a demo plays the same every time. Coordinates are board coordinates.
import type { DemoStroke } from "@grafito/board";

type Pt = [number, number];

/** A small repeatable noise source in [-0.5, 0.5). */
function noise(seed: number) {
  let s = (seed * 2654435761) % 2147483647 || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const flat = (pts: Pt[]): number[] => pts.flatMap(([x, y]) => [r1(x), r1(y)]);

/** Points along a→b every `step` px, shaken sideways by up to `amp` px; the ends are shaken less. */
function shaky(a: Pt, b: Pt, rnd: () => number, amp = 2.4, step = 16): Pt[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(2, Math.round(len / step));
  const nx = -(b[1] - a[1]) / (len || 1), ny = (b[0] - a[0]) / (len || 1);
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const k = i / n, j = rnd() * amp * 2 * (i === 0 || i === n ? 0.4 : 1);
    out.push([a[0] + (b[0] - a[0]) * k + nx * j, a[1] + (b[1] - a[1]) * k + ny * j]);
  }
  return out;
}

export function roughLine(x0: number, y0: number, x1: number, y1: number, seed = 1): DemoStroke {
  return { pts: flat(shaky([x0, y0], [x1, y1], noise(seed))) };
}

/** A box in one stroke: around the four corners, ending a little past where it started. */
export function roughRect(x: number, y: number, w: number, h: number, seed = 1): DemoStroke {
  const rnd = noise(seed);
  const c = (px: number, py: number): Pt => [px + rnd() * 6, py + rnd() * 6];
  const corners = [c(x, y), c(x + w, y), c(x + w, y + h), c(x, y + h)];
  const pts: Pt[] = [];
  corners.forEach((p, i) => pts.push(...shaky(p, corners[(i + 1) % 4], rnd).slice(i ? 1 : 0)));
  pts.push([corners[0][0] + 14, corners[0][1] + rnd() * 3]);
  return { pts: flat(pts) };
}

/** An arrow as two strokes: the shaft, then the head. */
export function roughArrow(x0: number, y0: number, x1: number, y1: number, seed = 1): DemoStroke[] {
  const rnd = noise(seed + 7);
  const a = Math.atan2(y1 - y0, x1 - x0), size = 16;
  const wing = (da: number): Pt => [x1 - Math.cos(a + da) * size + rnd() * 3, y1 - Math.sin(a + da) * size + rnd() * 3];
  return [roughLine(x0, y0, x1, y1, seed), { pts: flat([wing(0.5), [x1, y1], wing(-0.5)]) }];
}

/** An oval in one stroke, from `from`° over `sweep`° (more than 360 overlaps the start, like a real loop). */
export function roughOval(cx: number, cy: number, rx: number, ry: number, seed = 1, from = -100, sweep = 385): DemoStroke {
  const rnd = noise(seed);
  const pts: Pt[] = [];
  for (let d = 0; d <= sweep; d += 15) {
    const a = ((from + d) * Math.PI) / 180, grow = 1 + (d / sweep) * 0.04;
    pts.push([cx + Math.cos(a) * rx * grow + rnd() * 3, cy + Math.sin(a) * ry * grow + rnd() * 3]);
  }
  return { pts: flat(pts) };
}

/** A database the way people draw it: the lid, then the sides and the round bottom in one go. */
export function roughCylinder(x: number, y: number, w: number, h: number, seed = 1): DemoStroke[] {
  const rnd = noise(seed + 3);
  const ry = Math.min(16, h / 5), cx = x + w / 2;
  const body: Pt[] = [...shaky([x, y + ry], [x, y + h - ry], rnd, 1.6)];
  for (let d = 180; d >= 0; d -= 20) {
    const a = (d * Math.PI) / 180;
    body.push([cx + Math.cos(a) * (w / 2) + rnd() * 2, y + h - ry + Math.sin(a) * ry + rnd() * 2]);
  }
  body.push(...shaky([x + w, y + h - ry], [x + w, y + ry], rnd, 1.6).slice(1));
  return [roughOval(cx, y + ry, w / 2, ry, seed, -170, 380), { pts: flat(body) }];
}

/** A line of pretend handwriting: a wave of uneven humps. */
export function roughWords(x: number, y: number, w: number, seed = 1): DemoStroke {
  const rnd = noise(seed + 11);
  const pts: Pt[] = [];
  for (let px = 0, i = 0; px <= w; px += 7, i++) pts.push([x + px + rnd() * 2, y + (i % 2 ? -5 : 4) + rnd() * 5]);
  return { pts: flat(pts) };
}
