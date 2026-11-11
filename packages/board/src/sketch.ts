// The sketch: what people draw by hand on top of the board. Strokes live in board coordinates, beside the
// board (which holds none), until Claude turns them into board elements. Pure geometry, no DOM.
import type { Board } from "./model";
import type { BoardLayout, Rect } from "./layout";

/** One pen stroke. `pts` is flat: x0, y0, x1, y1… in board coordinates. */
export interface Stroke {
  id: string;
  /** Id of the participant who drew it. */
  by: string;
  color: string;
  pts: number[];
}

/** What a stroke looks like: a tap, a fairly straight line, a loop that closes on itself, or anything else. */
export type StrokeShape = "dot" | "line" | "closed" | "scribble";

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);

export function strokeBounds(pts: readonly number[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The box around every stroke; null when there are none. */
export function sketchBounds(strokes: readonly Pick<Stroke, "pts">[]): Rect | null {
  const boxes = strokes.filter((s) => s.pts.length >= 2).map((s) => strokeBounds(s.pts));
  if (!boxes.length) return null;
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

export function strokeLength(pts: readonly number[]): number {
  let len = 0;
  for (let i = 2; i + 1 < pts.length; i += 2) len += dist(pts[i - 2], pts[i - 1], pts[i], pts[i + 1]);
  return len;
}

export function classifyStroke(pts: readonly number[]): StrokeShape {
  const b = strokeBounds(pts);
  if (pts.length < 4 || Math.hypot(b.w, b.h) < 8) return "dot";
  const len = strokeLength(pts);
  const n = pts.length;
  const chord = dist(pts[0], pts[1], pts[n - 2], pts[n - 1]);
  if (len > 60 && chord < Math.max(18, len * 0.2)) return "closed";
  return chord / len > 0.88 ? "line" : "scribble";
}

/** Drops points that add nothing (Ramer-Douglas-Peucker), so a stroke stays small on the wire and in the file. */
export function simplifyStroke(pts: readonly number[], tolerance = 1.2): number[] {
  const n = pts.length / 2;
  if (n <= 2) return pts.map((v) => Math.round(v * 10) / 10);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
    const seg = dist(ax, ay, bx, by) || 1;
    let worst = -1, far = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((by - ay) * pts[i * 2] - (bx - ax) * pts[i * 2 + 1] + bx * ay - by * ax) / seg;
      if (d > far) { far = d; worst = i; }
    }
    if (worst > 0 && far > tolerance) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(Math.round(pts[i * 2] * 10) / 10, Math.round(pts[i * 2 + 1] * 10) / 10);
  return out;
}

/** True if (x, y) is within `r` of the stroke: what the eraser tests. */
export function hitStroke(pts: readonly number[], x: number, y: number, r: number): boolean {
  if (pts.length === 2) return dist(pts[0], pts[1], x, y) <= r;
  for (let i = 2; i + 1 < pts.length; i += 2) {
    const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1];
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const t = l2 ? Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2)) : 0;
    if (dist(ax + t * (bx - ax), ay + t * (by - ay), x, y) <= r) return true;
  }
  return false;
}

/** The stroke as an SVG path: quadratic curves through the midpoints, so the hand's corners come out round. */
export function strokePath(pts: readonly number[]): string {
  const n = pts.length / 2;
  if (n < 1) return "";
  if (n === 1) return `M${pts[0]} ${pts[1]} l0.01 0`;
  let d = `M${pts[0]} ${pts[1]}`;
  for (let i = 1; i < n - 1; i++) {
    const mx = (pts[i * 2] + pts[i * 2 + 2]) / 2, my = (pts[i * 2 + 1] + pts[i * 2 + 3]) / 2;
    d += ` Q${pts[i * 2]} ${pts[i * 2 + 1]} ${Math.round(mx * 10) / 10} ${Math.round(my * 10) / 10}`;
  }
  return d + ` L${pts[n * 2 - 2]} ${pts[n * 2 - 1]}`;
}

const inside = (r: Rect, x: number, y: number, pad = 0) => x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;
const contains = (outer: Rect, inner: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const gap = (r: Rect, x: number, y: number) => Math.hypot(Math.max(r.x - x, 0, x - (r.x + r.w)), Math.max(r.y - y, 0, y - (r.y + r.h)));
const round = (v: number) => Math.round(v);
const at = (x: number, y: number) => `(${round(x)},${round(y)})`;
const box = (r: Rect) => `x:${round(r.x)} y:${round(r.y)} w:${round(r.w)} h:${round(r.h)}`;

/** How close a stroke's end must be to an element to count as touching it. */
const NEAR = 70;

/**
 * The sketch as text for the prompt: per stroke its shape, size and what it touches on the board, then the
 * boxes of the zones and elements around it. The picture of the sketch goes with it when the model can see one;
 * this text is what ties the ink to board ids.
 */
export function describeSketch(strokes: readonly Stroke[], board: Board, layout: BoardLayout | undefined): string {
  const elements = board.elements.flatMap((e) => (layout?.elements[e.id] ? [{ id: e.id, label: e.label, zone: e.zone, r: layout.elements[e.id] }] : []));
  const zones = board.zones.flatMap((z) => (layout?.zones[z.id] ? [{ id: z.id, title: z.title, r: layout.zones[z.id] }] : []));
  const name = (e: { id: string; label: string }) => `${e.id} ${JSON.stringify(e.label)}`;
  const zoneAt = (x: number, y: number) => zones.find((z) => inside(z.r, x, y));
  const used = new Set<string>();

  const where = (x: number, y: number): string => {
    const on = elements.find((e) => inside(e.r, x, y, 12));
    if (on) { used.add(on.id); return `on ${name(on)}`; }
    const near = elements.map((e) => ({ e, d: gap(e.r, x, y) })).filter((c) => c.d <= NEAR).sort((a, b) => a.d - b.d)[0];
    if (near) { used.add(near.e.id); return `near ${name(near.e)}`; }
    const z = zoneAt(x, y);
    if (z) { used.add(z.id); return `in zone ${z.id}, on free space`; }
    const closest = zones.map((q) => ({ q, d: gap(q.r, x, y) })).sort((a, b) => a.d - b.d)[0];
    if (!closest) return "on the empty board";
    used.add(closest.q.id);
    const r = closest.q.r;
    const side = x > r.x + r.w ? "right of" : x < r.x ? "left of" : y < r.y ? "above" : "below";
    return `outside every zone, ${side} zone ${closest.q.id}`;
  };

  const lines: string[] = [];
  strokes.forEach((s, i) => {
    const pts = s.pts, n = pts.length;
    if (n < 2) return;
    const b = strokeBounds(pts);
    const shape = classifyStroke(pts);
    const id = `s${i + 1}`;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    if (shape === "dot") lines.push(`- ${id}: dot at ${at(cx, cy)}, ${where(cx, cy)}`);
    else if (shape === "line") {
      const horizontal = b.w >= b.h * 3 ? " (horizontal)" : b.h >= b.w * 3 ? " (vertical)" : "";
      lines.push(`- ${id}: line${horizontal}, ${round(strokeLength(pts))} long, from ${at(pts[0], pts[1])} ${where(pts[0], pts[1])} to ${at(pts[n - 2], pts[n - 1])} ${where(pts[n - 2], pts[n - 1])}`);
    } else {
      const within = elements.filter((e) => contains(b, e.r));
      within.forEach((e) => used.add(e.id));
      const over = within.length ? [] : elements.filter((e) => inside(e.r, cx, cy));
      over.forEach((e) => used.add(e.id));
      const about = within.length ? `goes around ${within.map(name).join(", ")}` : over.length ? `drawn over ${over.map(name).join(", ")}` : where(cx, cy);
      lines.push(`- ${id}: ${shape === "closed" ? "closed shape" : "scribble"} ${round(b.w)}x${round(b.h)} at ${at(cx, cy)}, ${about}`);
    }
  });
  if (!lines.length) return "(empty sketch)";

  const out = [`STROKES (${lines.length}, in the order drawn; board coordinates, y grows downward)`, ...lines];
  const around = [
    ...zones.filter((z) => used.has(z.id) || elements.some((e) => used.has(e.id) && e.zone === z.id)).map((z) => `- zone ${z.id} ${JSON.stringify(z.title)} ${box(z.r)}`),
    ...elements.filter((e) => used.has(e.id)).map((e) => `- ${name(e)} ${box(e.r)}`),
  ];
  if (around.length) out.push("WHERE THINGS ARE", ...around);
  return out.join("\n");
}
