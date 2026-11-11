// Hi-fi export: the render tree drawn as a clean, presentation-grade SVG. Pure (no DOM): string in, string out.
// Positions come from the same layout the board used, so the result matches what was on screen; only the look
// changes: straight lines, crisp boxes, a system sans, a title block. No rough.js, no handwriting font.
import type { Field, Geom, Pt, Rect, RenderItem, RenderTree } from "@grafito/board";
import { ENTITY_HEAD, ENTITY_KEY_W, ENTITY_PAD, ENTITY_ROW, GROUP_ICON, labelLines, labelRect } from "@grafito/board";
import type { GroupKind } from "@grafito/contract";
import { DARK, LIGHT } from "./theme";
import type { HifiTheme } from "./theme";
import { MONO, SANS, esc, fitSize, textWidth, wrapToWidth } from "./text";

export interface HifiLabels {
  /** legend: an open proposal */
  proposed: string;
  /** legend: relation ends */
  one: string;
  many: string;
  /** legend: key marks */
  pk: string;
  fk: string;
  madeWith: string;
}
export const DEFAULT_LABELS: HifiLabels = {
  proposed: "Proposed, not yet accepted", one: "one", many: "many", pk: "primary key", fk: "foreign key", madeWith: "Made with grafito",
};

export interface HifiOptions {
  /** Title block. Without a title the block shows only the date and the mark. */
  title?: string;
  subtitle?: string;
  /** Already formatted for the reader. */
  date?: string;
  theme?: "light" | "dark";
  /**
   * Open proposals (architect mode's pencil items). `dashed` (default): drawn grey and dashed, with a legend entry,
   * so the document says what is still undecided. `exclude`: left out.
   */
  proposals?: "dashed" | "exclude";
  /** Service (`aws:lambda`) -> the icon's SVG text, or null. Without it no icons are drawn. */
  icon?: (service: string) => string | null;
  labels?: Partial<HifiLabels>;
}
export interface HifiResult { svg: string; width: number; height: number }

const PAD = 48;
const MIN_W = 640;
const LABEL = 14.5;
const NOTE = 12.5;

/** Coordinates with at most two decimals; anything that is not a number becomes 0, never `NaN` in the file. */
const n = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "0");

interface Ctx { t: HifiTheme; icon: (service: string) => string | null; uid: number; /** a zone title already shown as the page title: not drawn twice */ pageTitle?: string }

interface TextOpts { size?: number; weight?: number; fill?: string; anchor?: "start" | "middle" | "end"; lh?: number; mono?: boolean; italic?: boolean; spacing?: number }
/** Lines centred vertically on `cy`. The baseline is computed (no `dominant-baseline`), so every viewer agrees. */
function text(lines: string[], x: number, cy: number, o: TextOpts = {}): string {
  const size = o.size ?? LABEL, lh = o.lh ?? size * 1.28;
  const y0 = cy - ((lines.length - 1) * lh) / 2 + size * 0.35;
  return lines
    .map((l, i) =>
      l === "" ? "" :
      `<text x="${n(x)}" y="${n(y0 + i * lh)}" font-size="${n(size)}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? "#000"}"` +
      (o.anchor && o.anchor !== "start" ? ` text-anchor="${o.anchor}"` : "") +
      (o.mono ? ` font-family="${MONO}"` : "") + (o.italic ? ` font-style="italic"` : "") + (o.spacing ? ` letter-spacing="${o.spacing}"` : "") +
      `>${esc(l)}</text>`)
    .join("");
}

interface BoxOpts { fill: string; stroke?: string; sw?: number; r?: number; dash?: string; opacity?: number }
function box(x: number, y: number, w: number, h: number, o: BoxOpts): string {
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(Math.max(0, w))}" height="${n(Math.max(0, h))}"` +
    (o.r ? ` rx="${n(o.r)}"` : "") + ` fill="${o.fill}"` + (o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : "") +
    (o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 1.25}"` : "") + (o.dash ? ` stroke-dasharray="${o.dash}"` : "") + "/>";
}
function path(d: string, stroke: string, sw = 1.5, o: { dash?: string; fill?: string; cap?: string } = {}): string {
  return `<path d="${d}" fill="${o.fill ?? "none"}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="${o.cap ?? "round"}"` +
    (o.dash ? ` stroke-dasharray="${o.dash}"` : "") + "/>";
}
const at = (g: Geom, inner: string) => `<g transform="translate(${n(g.x)} ${n(g.y)})">${inner}</g>`;

// ---- lines ----

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const same = (a: Pt, b: Pt) => dist(a, b) < 0.01;

/** Polyline with its corners rounded. */
function roundedPoly(pts: Pt[], r = 8): string {
  if (pts.length < 2) return "";
  let d = `M${n(pts[0].x)} ${n(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = dist(a, b), l2 = dist(b, c);
    if (l1 < 0.01 || l2 < 0.01) continue;
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p1 = { x: b.x + ((a.x - b.x) / l1) * rr, y: b.y + ((a.y - b.y) / l1) * rr };
    const p2 = { x: b.x + ((c.x - b.x) / l2) * rr, y: b.y + ((c.y - b.y) / l2) * rr };
    d += ` L${n(p1.x)} ${n(p1.y)} Q${n(b.x)} ${n(b.y)} ${n(p2.x)} ${n(p2.y)}`;
  }
  const z = pts[pts.length - 1];
  return d + ` L${n(z.x)} ${n(z.y)}`;
}
/** The same polyline with `d` cut off its end (so the line stops inside the arrowhead, not at its tip). */
function trimPoly(pts: Pt[], atStart: number, atEnd: number): Pt[] {
  const out = pts.map((p) => ({ ...p }));
  const cut = (i: number, j: number, d: number) => {
    const l = dist(out[i], out[j]);
    if (d <= 0 || l <= d + 1) return;
    out[i] = { x: out[i].x + ((out[j].x - out[i].x) / l) * d, y: out[i].y + ((out[j].y - out[i].y) / l) * d };
  };
  if (out.length >= 2) { cut(out.length - 1, out.length - 2, atEnd); cut(0, 1, atStart); }
  return out;
}
const lerp = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
/** The part of a cubic bezier between parameters t0 and t1. */
function subBezier(p: Pt[], t0: number, t1: number): Pt[] {
  const split = (q: Pt[], k: number): [Pt[], Pt[]] => {
    const a = lerp(q[0], q[1], k), b = lerp(q[1], q[2], k), c = lerp(q[2], q[3], k);
    const d = lerp(a, b, k), e = lerp(b, c, k), f = lerp(d, e, k);
    return [[q[0], a, d, f], [f, e, c, q[3]]];
  };
  const head = split(p, t1)[0];
  return t0 > 0 ? split(head, t0 / t1)[1] : head;
}
function bezierD(p: Pt[]): string {
  return `M${n(p[0].x)} ${n(p[0].y)} C${n(p[1].x)} ${n(p[1].y)} ${n(p[2].x)} ${n(p[2].y)} ${n(p[3].x)} ${n(p[3].y)}`;
}
const bezierLen = (p: Pt[]) => (dist(p[0], p[1]) + dist(p[1], p[2]) + dist(p[2], p[3]) + dist(p[0], p[3])) / 2;

const HEAD = 9;
/** Filled triangle with its tip at `tip`, for a line arriving from `from`. */
function arrowHead(tip: Pt, from: Pt, color: string, len = HEAD, half = 3.6): string {
  const l = dist(from, tip) || 1;
  const u = { x: (tip.x - from.x) / l, y: (tip.y - from.y) / l };
  const b = { x: tip.x - u.x * len, y: tip.y - u.y * len };
  return `<path d="M${n(tip.x)} ${n(tip.y)} L${n(b.x - u.y * half)} ${n(b.y + u.x * half)} L${n(b.x + u.y * half)} ${n(b.y - u.x * half)} Z" fill="${color}"/>`;
}
/** One end of a relation in crow's-foot notation: "one" is a bar across the line, "many" three toes onto the entity. */
function crowFoot(tip: Pt, from: Pt, many: boolean, color: string, sw: number): string {
  const l = dist(from, tip) || 1;
  const u = { x: (tip.x - from.x) / l, y: (tip.y - from.y) / l };
  const back = (d: number, side: number): Pt => ({ x: tip.x - u.x * d - u.y * side, y: tip.y - u.y * d + u.x * side });
  if (many) {
    const heel = back(13, 0), a = back(0, 7), c = back(0, -7);
    return path(`M${n(a.x)} ${n(a.y)} L${n(heel.x)} ${n(heel.y)} L${n(c.x)} ${n(c.y)}`, color, sw);
  }
  const a = back(9, 6.5), c = back(9, -6.5);
  return path(`M${n(a.x)} ${n(a.y)} L${n(c.x)} ${n(c.y)}`, color, sw);
}

// ---- icons ----

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** The icon's SVG body with every inner id (and its references) prefixed, so two copies never share an id. */
function iconBody(svg: string, prefix: string): string {
  let body = svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<title>[\s\S]*?<\/title>/g, "").replace(/<\?xml[\s\S]*?\?>/g, "");
  for (const id of new Set([...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))) {
    const e = reEsc(id);
    body = body
      .replace(new RegExp(`(\\sid=")${e}"`, "g"), `$1${prefix}${id}"`)
      .replace(new RegExp(`url\\((['"]?)#${e}\\1\\)`, "g"), `url($1#${prefix}${id}$1)`)
      .replace(new RegExp(`((?:xlink:)?href=")#${e}"`, "g"), `$1#${prefix}${id}"`);
  }
  return body.replace(/>\s+</g, "><").trim();
}
/** The service icon inlined at (x, y), `size` px square, in its own colours. Empty if the service has no icon. */
function icon(c: Ctx, service: string | undefined, x: number, y: number, size: number, pencil: boolean): string {
  const raw = service ? c.icon(service) : null;
  if (!raw) return "";
  const vb = /viewBox="([^"]+)"/.exec(raw)?.[1].trim().split(/[\s,]+/).map(Number);
  const [vx, vy, vw, vh] = vb && vb.length === 4 && vb.every(Number.isFinite) ? vb : [0, 0, 80, 80];
  const k = size / Math.max(vw, vh, 1);
  return `<g data-icon="${esc(service!)}" transform="translate(${n(x)} ${n(y)}) scale(${Math.round(k * 10000) / 10000}) translate(${n(-vx)} ${n(-vy)})"${pencil ? ` opacity="0.45"` : ""}>` +
    iconBody(raw, `hf${++c.uid}-`) + "</g>";
}

// ---- items ----

function zone(c: Ctx, it: RenderItem): string {
  const { t } = c, { w, h } = it.geom, d = it.data;
  let s = box(0.5, 0.5, w - 1, h - 1, { fill: t.zoneFill, stroke: t.zoneBorder, sw: 1, r: 12 });
  const title = d.title ?? "";
  if (title && title.trim().toLowerCase() !== c.pageTitle) {
    s += box(20, 19, 3, 18, { fill: t.accent, r: 1.5 });
    s += text([title], 32, 28, { size: fitSize([title], w - 56, 16, 600, 11), weight: 600, fill: t.ink });
  }
  if (d.divider !== undefined) {
    s += path(`M${n(d.divider)} 62 L${n(d.divider)} ${n(h - 20)}`, t.zoneBorder, 1.25);
    const col = (label: string | undefined, x0: number, x1: number) => {
      const up = (label ?? "").toUpperCase();
      return up ? text([up], (x0 + x1) / 2, 78, { size: fitSize([up], x1 - x0 - 16, 11.5, 600, 8), weight: 600, fill: t.muted, anchor: "middle", spacing: 0.6 }) : "";
    };
    s += col(d.leftTitle, 26, d.divider) + col(d.rightTitle, d.divider, w - 26);
  }
  return at(it.geom, s);
}

/** The corner icon of an AWS group: a square in the kind's colour with a small white glyph. */
function groupGlyph(kind: GroupKind, color: string, on: string): string {
  const s = GROUP_ICON, p = (x: number, y: number) => `${n(x * s)} ${n(y * s)}`;
  const w = 1.4;
  const cloud = `M${p(0.26, 0.7)} C${p(0.1, 0.7)} ${p(0.1, 0.47)} ${p(0.28, 0.47)} C${p(0.3, 0.27)} ${p(0.56, 0.25)} ${p(0.61, 0.41)} C${p(0.75, 0.32)} ${p(0.9, 0.43)} ${p(0.84, 0.56)} C${p(0.93, 0.62)} ${p(0.89, 0.71)} ${p(0.78, 0.7)} Z`;
  const lock = (open: boolean, cx: number, cy: number, k: number) =>
    box((cx - 0.19 * k) * s, cy * s, 0.38 * k * s, 0.29 * k * s, { fill: on, r: 1 }) +
    path(`M${p(cx - 0.11 * k, cy)} L${p(cx - 0.11 * k, cy - 0.12 * k)} Q${p(cx - 0.11 * k, cy - 0.26 * k)} ${p(cx, cy - 0.26 * k)} Q${p(cx + 0.11 * k, cy - 0.26 * k)} ${p(cx + 0.11 * k, cy - 0.12 * k)}` + (open ? "" : ` L${p(cx + 0.11 * k, cy)}`), on, w);
  let g = box(0, 0, s, s, { fill: color });
  if (kind === "aws_cloud") g += path(cloud, on, w);
  else if (kind === "region") g += path(`M${p(0.32, 0.2)} L${p(0.32, 0.82)}`, on, w) + path(`M${p(0.32, 0.23)} L${p(0.76, 0.34)} L${p(0.32, 0.5)} Z`, on, w, { fill: on });
  else if (kind === "vpc") g += path(cloud, on, w) + lock(false, 0.5, 0.56, 0.62);
  else if (kind === "availability_zone") g += text(["AZ"], s / 2, s / 2, { size: 11, weight: 700, fill: on, anchor: "middle" });
  else if (kind === "public_subnet" || kind === "private_subnet") g += lock(kind === "public_subnet", 0.5, 0.5, 1);
  else g += box(0.28 * s, 0.28 * s, 0.44 * s, 0.44 * s, { fill: "none", stroke: on, sw: w, r: 1.5 });
  return g;
}
function group(c: Ctx, it: RenderItem): string {
  const { t } = c, { w, h } = it.geom;
  const kind = (it.data.variant ?? "generic") as GroupKind;
  const pencil = !!it.data.pencil;
  const color = pencil ? t.pencil : t.groups[kind] ?? t.groups.generic;
  const dash = pencil ? "5 4" : kind === "region" ? "2 3" : kind === "availability_zone" || kind === "generic" ? "6 4" : undefined;
  const title = it.data.title ?? "";
  return at(it.geom,
    box(0.5, 0.5, w - 1, h - 1, { fill: color, opacity: 0.035, stroke: color, sw: 1.25, dash }) +
    groupGlyph(kind in t.groups ? kind : "generic", color, t.bg) +
    text([title], GROUP_ICON + 10, GROUP_ICON / 2, { size: fitSize([title], w - GROUP_ICON - 20, 13, 600, 9), weight: 600, fill: pencil ? t.muted : t.ink }));
}

/** A patch in the zone's colour behind loose text, so a line passing under it does not strike it through. */
function patch(c: Ctx, lines: string[], cx: number, cy: number, size: number, weight: number, lh = size * 1.28): string {
  const w = Math.max(0, ...lines.map((l) => textWidth(l, size, weight))) + 10, h = lines.length * lh + 4;
  return box(cx - w / 2, cy - h / 2, w, h, { fill: c.t.zoneFill, r: 3, opacity: 0.92 });
}

/** Label lines with an optional note block under them, centred as one block on (cx, cy). */
function labelBlock(c: Ctx, lines: string[], notes: string[], cx: number, cy: number, maxW: number, o: { fill: string; noteFill?: string; size?: number; weight?: number }): string {
  const size = fitSize(lines, maxW, o.size ?? LABEL, o.weight ?? 600), lh = size * 1.28;
  if (!notes.length) return text(lines, cx, cy, { size, weight: o.weight ?? 600, fill: o.fill, anchor: "middle" });
  const ns = fitSize(notes, maxW, NOTE, 400), nlh = ns * 1.32, gap = 4;
  const total = lines.length * lh + gap + notes.length * nlh;
  const top = cy - total / 2;
  return text(lines, cx, top + (lines.length * lh) / 2, { size, weight: o.weight ?? 600, fill: o.fill, anchor: "middle" }) +
    text(notes, cx, top + lines.length * lh + gap + (notes.length * nlh) / 2, { size: ns, fill: o.noteFill ?? c.t.ink2, anchor: "middle", lh: nlh });
}

/** A box whose shape is the service's own icon: icon and name side by side, or stacked when the box is tall. */
function serviceCard(c: Ctx, it: RenderItem, ic: (x: number, y: number, s: number) => string): string {
  const { t } = c, { w, h } = it.geom, lines = it.data.lines ?? [], pencil = !!it.data.pencil;
  const frame = box(0.5, 0.5, w - 1, h - 1, { fill: pencil ? t.bg : t.nodeFill, stroke: pencil ? t.pencil : t.border, r: 8, dash: pencil ? "5 4" : undefined });
  const fill = pencil ? t.muted : t.ink;
  if (h >= 90) {
    const S = 40, size = fitSize(lines, w - 16, LABEL, 600), th = lines.length * size * 1.28;
    const top = (h - (S + 8 + th)) / 2;
    return frame + ic((w - S) / 2, top, S) + text(lines, w / 2, top + S + 8 + th / 2, { size, weight: 600, fill, anchor: "middle" });
  }
  const S = Math.max(20, Math.min(36, h - 20)), x0 = 12 + S + 10;
  const size = fitSize(lines, w - x0 - 10, LABEL, 600);
  return frame + ic(12, (h - S) / 2, S) + text(lines, x0, h / 2, { size, weight: 600, fill });
}

function entity(c: Ctx, it: RenderItem): string {
  const { t } = c, { w, h } = it.geom, fields: Field[] = it.data.fields ?? [], name = (it.data.lines ?? [""])[0];
  const r = 6;
  let s = box(0.5, 0.5, w - 1, h - 1, { fill: t.nodeFill, r });
  // header band: rounded on top only
  s += `<path d="M0.5 ${ENTITY_HEAD} L0.5 ${r + 0.5} Q0.5 0.5 ${r + 0.5} 0.5 L${n(w - r - 0.5)} 0.5 Q${n(w - 0.5)} 0.5 ${n(w - 0.5)} ${r + 0.5} L${n(w - 0.5)} ${ENTITY_HEAD} Z" fill="${t.band}"/>`;
  s += path(`M0.5 ${ENTITY_HEAD} L${n(w - 0.5)} ${ENTITY_HEAD}`, t.border, 1, { cap: "butt" });
  s += text([name], ENTITY_PAD, ENTITY_HEAD / 2, { size: fitSize([name], w - 2 * ENTITY_PAD, 14, 600), weight: 600, fill: t.ink });
  fields.forEach((f, i) => {
    const top = ENTITY_HEAD + 4 + i * ENTITY_ROW, y = top + ENTITY_ROW / 2;
    if (i > 0) s += path(`M${ENTITY_PAD - 4} ${n(top)} L${n(w - ENTITY_PAD + 4)} ${n(top)}`, t.hair, 1, { cap: "butt" });
    if (f.key) s += text([f.key.toUpperCase()], ENTITY_PAD - 3, y, { size: 9, weight: 700, fill: f.key === "pk" ? t.accent : t.muted, spacing: 0.3 });
    const typeW = f.type ? textWidth(f.type, 11.5, 400, true) + 12 : 0;
    const nameW = w - ENTITY_KEY_W - ENTITY_PAD - typeW;
    s += text([f.name], ENTITY_KEY_W, y, { size: fitSize([f.name], nameW, 13, f.key === "pk" ? 600 : 400), weight: f.key === "pk" ? 600 : 400, fill: t.ink });
    if (f.type) s += text([f.type], w - ENTITY_PAD, y, { size: 11.5, fill: t.muted, anchor: "end", mono: true });
  });
  s += box(0.5, 0.5, w - 1, h - 1, { fill: "none", stroke: t.border, r });
  return s;
}

function element(c: Ctx, it: RenderItem): string {
  const { t } = c, { w, h } = it.geom, d = it.data;
  const v = d.variant ?? "", lines = d.lines ?? [], notes = d.noteLines ?? [];
  const pencil = !!d.pencil;
  const stroke = pencil ? t.pencil : t.border, fill = pencil ? t.bg : t.nodeFill, ink = pencil ? t.muted : t.ink;
  const dash = pencil ? "5 4" : undefined;
  const tone = t.tones[d.tone ?? "neutral"] ?? t.tones.neutral;
  const ic = (x: number, y: number, s: number) => icon(c, d.service, x, y, s, pencil);
  const hasIcon = !!d.service && !!c.icon(d.service);
  /** small icon on the top-left corner, for shapes that keep their own outline */
  const badge = () => (hasIcon ? box(-9, -9, 28, 28, { fill: t.bg, r: 5 }) + ic(-7, -7, 24) : "");
  const center = (maxW: number, weight = 500) => text(lines, w / 2, h / 2, { size: fitSize(lines, maxW, LABEL, weight), weight, fill: ink, anchor: "middle" });
  let s: string;

  if (v === "scale") {
    const x0 = d.x0 ?? 0, bw = d.barW ?? w;
    s = box(x0, 3, bw, h - 6, { fill: t.band, stroke: t.border, sw: 1, r: 4 }) +
      text([d.minLabel ?? ""], x0 - 10, h / 2, { size: fitSize([d.minLabel ?? ""], x0 - 12, 12.5, 600, 8), weight: 600, fill: t.ink2, anchor: "end" }) +
      text([d.maxLabel ?? ""], x0 + bw + 10, h / 2, { size: fitSize([d.maxLabel ?? ""], w - x0 - bw - 12, 12.5, 600, 8), weight: 600, fill: t.ink2 });
  } else if (v === "scale-level") {
    s = box(0, 3, w, h - 6, { fill: t.accent, r: 4 });
    if (d.label) {
      const need = textWidth(d.label, 12, 600) + 18;
      s += w >= need
        ? text([d.label], w - 9, h / 2, { size: 12, weight: 600, fill: t.onAccent, anchor: "end" })
        : text([d.label], w + 8, h / 2, { size: 12, weight: 600, fill: t.ink });
    }
  } else if (v === "mark") {
    s = labelBlock(c, lines, notes, w / 2, h / 2, w - 4, { fill: tone.ink, size: 13.5 });
  } else if (v === "stage" || v === "branch" || v === "event") {
    s = box(0.5, 0.5, w - 1, h - 1, { fill, stroke, r: 8, dash }) + labelBlock(c, lines, notes, w / 2, h / 2, w - 20, { fill: ink }) + badge();
  } else if (v === "when") {
    const size = fitSize(lines, w + 8, 12, 600, 9);
    s = patch(c, lines, w / 2, h / 2, size, 600) + text(lines, w / 2, h / 2, { size, weight: 600, fill: t.accent, anchor: "middle" });
  } else if (v === "span") {
    const x0 = d.x0 ?? 0, x1 = x0 + (d.barW ?? w);
    s = path(`M${n(x0)} 3 L${n(x0)} 12 L${n(x1)} 12 L${n(x1)} 3`, tone.ink, 1.5) +
      patch(c, lines, (x0 + x1) / 2, 28, fitSize(lines, w, 12.5, 600), 600) +
      text(lines, (x0 + x1) / 2, 28, { size: fitSize(lines, w, 12.5, 600), weight: 600, fill: tone.ink, anchor: "middle" });
  } else if (v === "cycle-center") {
    s = `<ellipse cx="${n(w / 2)}" cy="${n(h / 2)}" rx="${n(w / 2 - 2)}" ry="${n(h / 2 - 2)}" fill="${t.accentSoft}" stroke="${t.accent}" stroke-width="1.25"/>` +
      text(lines, w / 2, h / 2, { size: fitSize(lines, w * 0.72, 15, 600), weight: 600, fill: t.ink, anchor: "middle" });
  } else if (v === "entity") {
    s = entity(c, it) + badge();
  } else if (v === "item") {
    s = `<circle cx="10" cy="${n(h / 2)}" r="3" fill="${t.accent}"/>` + text(lines, 24, h / 2, { size: fitSize(lines, w - 26, LABEL, 400), fill: ink });
  } else if (v === "decision") {
    s = `<path d="M${n(w / 2)} 1 L${n(w - 1)} ${n(h / 2)} L${n(w / 2)} ${n(h - 1)} L1 ${n(h / 2)} Z" fill="${fill}" stroke="${stroke}" stroke-width="1.25" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/>` +
      center(w * 0.58) + (hasIcon ? ic(w / 2 - 44, h / 4 - 14, 22) : "");
  } else if (v === "node") {
    s = box(0.5, 0.5, w - 1, h - 1, { fill, stroke, r: h / 2, dash }) + center(w - 28) + badge();
  } else if (hasIcon && (v === "step" || v.startsWith("component:"))) {
    s = serviceCard(c, it, ic);
  } else if (v === "component:actor") {
    const cx = w / 2, sw = 1.5;
    s = `<circle cx="${n(cx)}" cy="20" r="11" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ""}/>` +
      path(`M${n(cx - 22)} 68 C${n(cx - 22)} 38 ${n(cx + 22)} 38 ${n(cx + 22)} 68 Z`, stroke, sw, { fill, dash }) +
      text(lines, cx, 78 + (h - 78) / 2, { size: fitSize(lines, w + 8, LABEL, 500), weight: 500, fill: ink, anchor: "middle" });
  } else if (v === "component:client") {
    s = box(0.5, 0.5, w - 1, h - 1, { fill, stroke, r: 8, dash }) +
      `<path d="M0.5 24 L0.5 8.5 Q0.5 0.5 8.5 0.5 L${n(w - 8.5)} 0.5 Q${n(w - 0.5)} 0.5 ${n(w - 0.5)} 8.5 L${n(w - 0.5)} 24 Z" fill="${pencil ? "none" : t.band}" stroke="${stroke}" stroke-width="1.25"${dash ? ` stroke-dasharray="${dash}"` : ""}/>` +
      [13, 24, 35].map((x) => `<circle cx="${x}" cy="12.5" r="2.6" fill="${stroke}"/>`).join("") +
      text(lines, w / 2, 24 + (h - 24) / 2, { size: fitSize(lines, w - 20, LABEL, 500), weight: 500, fill: ink, anchor: "middle" });
  } else if (v === "component:database") {
    const ry = 9, rx = w / 2 - 1;
    s = path(`M1 ${ry + 1} A${n(rx)} ${ry} 0 0 1 ${n(w - 1)} ${ry + 1} L${n(w - 1)} ${n(h - ry - 1)} A${n(rx)} ${ry} 0 0 1 1 ${n(h - ry - 1)} Z`, stroke, 1.25, { fill, dash }) +
      path(`M1 ${ry + 1} A${n(rx)} ${ry} 0 0 0 ${n(w - 1)} ${ry + 1}`, stroke, 1.25, { dash }) +
      text(lines, w / 2, ry * 2 + (h - ry * 3) / 2 + 1, { size: fitSize(lines, w - 20, LABEL, 500), weight: 500, fill: ink, anchor: "middle" });
  } else if (v === "component:queue") {
    const slots = [0, 1, 2].map((i) => box(w - 14 - i * 9 - 5, 12, 5, h - 24, { fill: stroke, opacity: 0.55, r: 2 })).join("");
    s = box(0.5, 0.5, w - 1, h - 1, { fill, stroke, r: 8, dash }) + slots +
      text(lines, (w - 40) / 2 + 4, h / 2, { size: fitSize(lines, w - 60, LABEL, 500), weight: 500, fill: ink, anchor: "middle" });
  } else if (v === "component:storage") {
    const rx = w / 2 - 3, ry = 7, top = ry + 2;
    s = path(`M3 ${top} L${n(15)} ${n(h - 8)} Q16 ${n(h - 1)} 24 ${n(h - 1)} L${n(w - 24)} ${n(h - 1)} Q${n(w - 16)} ${n(h - 1)} ${n(w - 15)} ${n(h - 8)} L${n(w - 3)} ${top} Z`, stroke, 1.25, { fill, dash }) +
      `<ellipse cx="${n(w / 2)}" cy="${top}" rx="${n(rx)}" ry="${ry}" fill="${pencil ? t.bg : t.band}" stroke="${stroke}" stroke-width="1.25"${dash ? ` stroke-dasharray="${dash}"` : ""}/>` +
      text(lines, w / 2, 2 * top + (h - 2 * top) / 2 - 2, { size: fitSize(lines, w - 44, LABEL, 500), weight: 500, fill: ink, anchor: "middle" });
  } else if (v === "component:external") {
    s = box(0.5, 0.5, w - 1, h - 1, { fill: pencil ? t.bg : t.zoneFill, stroke, r: 8, dash: pencil ? "5 4" : "6 4" }) +
      text(lines, w / 2, h / 2, { size: fitSize(lines, w - 20, LABEL, 500), weight: 500, fill: pencil ? t.muted : t.ink2, anchor: "middle" });
  } else if (v === "component:service") {
    s = box(0.5, 0.5, w - 1, h - 1, { fill: pencil ? t.bg : t.accentSoft, stroke: pencil ? t.pencil : t.accent, r: 8, dash }) + center(w - 20, 600);
  } else {
    // step, and any element kind added after this file was written: a plain box with its lines
    s = box(0.5, 0.5, w - 1, h - 1, { fill, stroke, r: 8, dash }) + (notes.length ? labelBlock(c, lines, notes, w / 2, h / 2, w - 20, { fill: ink, weight: 500 }) : center(w - 20)) + badge();
  }
  return at(it.geom, s);
}

/** A connection's line and ends (its label is drawn later, over the boxes). */
function connection(c: Ctx, it: RenderItem): string {
  const { t } = c, d = it.data, pts = it.geom.pts ?? [];
  if (pts.length < 2 || pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return "";
  const tone = t.tones[d.tone ?? "neutral"] ?? t.tones.neutral;
  const v = d.variant;
  if (v === "mark-stem" && pts.length >= 3) {
    const [far, near, hook] = pts;
    const col = (d.tone ?? "neutral") === "neutral" ? t.line : tone.ink;
    const l = dist(near, hook) || 1, u = { x: (hook.x - near.x) / l, y: (hook.y - near.y) / l };
    const base = { x: near.x + u.x * 7, y: near.y + u.y * 7 };
    return path(`M${n(far.x)} ${n(far.y)} L${n(near.x)} ${n(near.y)}`, col, 2, { cap: "butt" }) +
      path(`M${n(base.x)} ${n(base.y)} L${n(hook.x)} ${n(hook.y)}`, col, 1.25) + arrowHead(near, hook, col, 7, 4);
  }
  if (v === "event-stem" && pts.length >= 3) {
    const [, dot, hook] = pts;
    return path(`M${n(dot.x)} ${n(dot.y)} L${n(hook.x)} ${n(hook.y)}`, t.border, 1.25) +
      `<circle cx="${n(dot.x)}" cy="${n(dot.y)}" r="5" fill="${t.accent}" stroke="${t.bg}" stroke-width="2"/>`;
  }
  if (v === "bracket") return path(roundedPoly(pts, 8), t.border, 1.25);

  const curve = !!it.geom.curve && pts.length === 4;
  const pencil = !!d.pencil, cross = !!d.cross;
  const plain = v === "ring" || v === "axis";
  const color = pencil ? t.pencil : cross ? t.muted : t.line;
  const sw = cross ? 1.25 : 1.5;
  const dash = pencil ? "5 4" : d.dashed ? "6 4" : cross ? "3 4" : undefined;
  const last = pts.length - 1;
  const endFrom = curve ? (same(pts[2], pts[3]) ? pts[0] : pts[2]) : same(pts[last - 1], pts[last]) ? pts[0] : pts[last - 1];
  const startFrom = same(pts[1], pts[0]) ? pts[last] : pts[1];
  const feet = !plain && !!d.cardinality;
  const headEnd = !feet, headStart = !feet && !plain && !!d.both;
  const tEnd = headEnd ? HEAD - 2 : 0, tStart = headStart ? HEAD - 2 : 0;
  let line: string;
  if (curve) {
    const len = bezierLen(pts) || 1;
    const sub = len > (tEnd + tStart) * 2 ? subBezier(pts, tStart / len, 1 - tEnd / len) : pts;
    line = path(bezierD(sub), color, sw, { dash, cap: "butt" });
  } else line = path(roundedPoly(trimPoly(pts, tStart, tEnd), 8), color, sw, { dash, cap: "butt" });
  let ends = "";
  if (feet) {
    const [source, target] = d.cardinality!.split("_to_");
    ends = crowFoot(pts[0], startFrom, source === "many", color, sw) + crowFoot(pts[last], endFrom, target === "many", color, sw);
  } else {
    ends = arrowHead(pts[last], endFrom, color);
    if (headStart) ends += arrowHead(pts[0], startFrom, color);
  }
  return line + ends;
}
function connectionLabel(c: Ctx, it: RenderItem): string {
  const { t } = c, d = it.data, lab = it.geom.lab;
  if (!d.label || !lab || it.data.variant) return "";
  const lines = labelLines(d.label), size = 12, lh = 15;
  const w = Math.max(...lines.map((l) => textWidth(l, size, 500))) + 12, h = lines.length * lh + 6;
  return box(lab.x - w / 2, lab.y - h / 2, w, h, { fill: t.bg, r: 4, opacity: 0.94 }) +
    text(lines, lab.x, lab.y, { size, lh, weight: 500, fill: d.pencil ? t.muted : t.ink2, anchor: "middle" });
}

function star(cx: number, cy: number, r: number): string {
  let d = "";
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r : r / 2.3, a = -Math.PI / 2 + (i * Math.PI) / 5;
    d += `${i ? "L" : "M"}${n(cx + rr * Math.cos(a))} ${n(cy + rr * Math.sin(a))} `;
  }
  return d + "Z";
}
function annotation(c: Ctx, it: RenderItem): string {
  const { t } = c, g = it.geom, d = it.data;
  if (it.kind === "emphasis") {
    if (d.variant === "circle") {
      // the sketch circles its target with an ellipse; here a ring hugs it (the ellipse box is 1.25x the target + 16)
      const w = Math.max(24, (g.w - 16) / 1.25 + 14), h = Math.max(20, (g.h - 16) / 1.25 + 14);
      const x = g.x + g.w / 2 - w / 2, y = g.y + g.h / 2 - h / 2;
      return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="13" fill="none" stroke="${t.accent}" stroke-width="6" stroke-opacity="0.14"/>` +
        box(x, y, w, h, { fill: "none", stroke: t.accent, sw: 2, r: 13 });
    }
    if (d.variant === "underline") return path(`M${n(g.x)} ${n(g.y + 4)} L${n(g.x + g.w)} ${n(g.y + 4)}`, t.accent, 2.5);
    return `<path d="${star(g.x + g.w / 2, g.y + g.h / 2, 11)}" fill="${t.accent}" stroke="${t.bg}" stroke-width="1.5" stroke-linejoin="round"/>`;
  }
  if (it.kind === "question") {
    const warn = t.tones.warn, cx = g.x + g.w / 2, cy = g.y + g.h / 2, lines = d.lines ?? [];
    return `<circle cx="${n(cx)}" cy="${n(cy)}" r="11" fill="${warn.fill}" stroke="${warn.ink}" stroke-width="1.25"/>` +
      text(["?"], cx, cy, { size: 13.5, weight: 700, fill: warn.ink, anchor: "middle" }) +
      (lines.length
        ? box(cx + 13, cy - (lines.length * 15.5) / 2 - 2, Math.max(...lines.map((l) => textWidth(l, 12.5))) + 8, lines.length * 15.5 + 4, { fill: t.zoneFill, r: 3, opacity: 0.92 }) +
          text(lines, cx + 17, cy, { size: 12.5, fill: warn.ink, italic: true, lh: 15.5 })
        : "");
  }
  if (it.kind === "callout") {
    const lines = d.lines ?? [], p = g.pts ?? [];
    let s = "";
    if (p.length === 4 && p.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) {
      const len = bezierLen(p) || 1;
      s += path(bezierD(len > 20 ? subBezier(p, 0, 1 - 5 / len) : p), t.accent, 1.1, { cap: "butt" }) + arrowHead(p[3], same(p[2], p[3]) ? p[0] : p[2], t.accent, 7, 3);
    }
    const size = fitSize(lines, g.w - 6, 13, 500);
    const tw = Math.max(0, ...lines.map((l) => textWidth(l, size, 500))) + 14, th = lines.length * 17 + 8;
    return s + box(g.x + g.w / 2 - tw / 2, g.y + g.h / 2 - th / 2, tw, th, { fill: t.bg, opacity: 0.94, r: 4 }) +
      text(lines, g.x + g.w / 2, g.y + g.h / 2, { size, weight: 500, fill: t.accent, anchor: "middle", lh: 17, italic: true });
  }
  return "";
}

/** Anything this file does not know (a render item kind added later): its lines in a plain box, or nothing. */
function unknown(c: Ctx, it: RenderItem): string {
  const { w, h } = it.geom, lines = it.data.lines ?? (it.data.title ? [it.data.title] : []);
  if (!(w > 0) || !(h > 0) || !lines.length) return "";
  return at(it.geom, box(0.5, 0.5, w - 1, h - 1, { fill: c.t.nodeFill, stroke: c.t.border, r: 8 }) +
    text(lines, w / 2, h / 2, { size: fitSize(lines, w - 16, LABEL, 500), weight: 500, fill: c.t.ink, anchor: "middle" }));
}

// ---- page ----

function bounds(items: RenderItem[]): Rect {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number, w = 0, h = 0, m = 2) => {
    if (![x, y, w, h].every(Number.isFinite)) return;
    x0 = Math.min(x0, x - m); y0 = Math.min(y0, y - m); x1 = Math.max(x1, x + w + m); y1 = Math.max(y1, y + h + m);
  };
  for (const it of items) {
    const g = it.geom;
    add(g.x, g.y, g.w, g.h, it.kind === "element" ? 10 : 2);
    for (const p of g.pts ?? []) add(p.x, p.y, 0, 0, 8);
    if (g.lab && it.data.label) { const r = labelRect({ x: g.lab.x, y: g.lab.y, text: it.data.label }); add(r.x, r.y, r.w, r.h); }
    if (it.kind === "question") add(g.x + g.w, g.y, 8 + Math.max(0, ...(it.data.lines ?? []).map((l) => textWidth(l, 12.5))), g.h);
    if (it.data.variant === "scale-level" && it.data.label) add(g.x, g.y, g.w + 16 + textWidth(it.data.label, 12, 600), g.h);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}

interface LegendEntry { w: number; draw(x: number, cy: number): string }
function legend(c: Ctx, items: RenderItem[], L: HifiLabels): LegendEntry[] {
  const { t } = c, out: LegendEntry[] = [];
  const cap = (s: string, x: number, cy: number) => text([s], x, cy, { size: 11, fill: t.muted });
  const capW = (s: string) => textWidth(s, 11);
  if (items.some((i) => i.data.pencil)) {
    out.push({ w: 30 + capW(L.proposed), draw: (x, cy) => box(x, cy - 6, 22, 12, { fill: "none", stroke: t.pencil, r: 3, dash: "4 3" }) + cap(L.proposed, x + 30, cy) });
  }
  const keys = new Set(items.flatMap((i) => (i.data.fields ?? []).map((f) => f.key)).filter(Boolean));
  for (const k of ["pk", "fk"] as const) {
    if (!keys.has(k)) continue;
    out.push({ w: 20 + capW(L[k]), draw: (x, cy) => text([k.toUpperCase()], x, cy, { size: 9, weight: 700, fill: k === "pk" ? t.accent : t.muted, spacing: 0.3 }) + cap(L[k], x + 20, cy) });
  }
  if (items.some((i) => i.data.cardinality)) {
    for (const many of [false, true]) {
      const label = many ? L.many : L.one;
      out.push({
        w: 34 + capW(label),
        draw: (x, cy) => path(`M${n(x)} ${n(cy)} L${n(x + 26)} ${n(cy)}`, t.line, 1.5, { cap: "butt" }) + crowFoot({ x: x + 26, y: cy }, { x, y: cy }, many, t.line, 1.5) + cap(label, x + 34, cy),
      });
    }
  }
  return out;
}

/**
 * Title and subtitle for the title block, from the board's summary and zone titles. A summary that opens with a
 * short name and a colon ("Order app: web, API and a queue") gives both; one zone gives its title; several zones
 * with a short summary make it the title; otherwise there is no title and the summary is the lead line.
 */
export function titleFrom(summary: string, zoneTitles: string[]): { title?: string; subtitle?: string } {
  const s = summary.trim();
  const colon = s.indexOf(":");
  const name = colon > 2 ? s.slice(0, colon).trim() : "";
  if (name && name.length <= 48 && !/[;,.]/.test(name) && colon < s.length - 1) return { title: name, subtitle: capitalize(s.slice(colon + 1).trim()) };
  const zones = zoneTitles.map((z) => z.trim()).filter(Boolean);
  if (zones.length === 1) return { title: zones[0], subtitle: s || undefined };
  if (s && s.length <= 70) return { title: s.replace(/\.$/, "") };
  return s ? { subtitle: s } : {};
}
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The render tree as a standalone hi-fi SVG, with its size in px (for a PNG made from it). */
export function renderHifi(tree: RenderTree, opts: HifiOptions = {}): HifiResult {
  const t = opts.theme === "dark" ? DARK : LIGHT;
  const L = { ...DEFAULT_LABELS, ...opts.labels };
  const items = opts.proposals === "exclude" ? tree.items.filter((i) => !i.data.pencil) : tree.items;
  const oneZone = items.filter((i) => i.kind === "zone").length === 1;
  const c: Ctx = { t, icon: opts.icon ?? (() => null), uid: 0, pageTitle: oneZone ? opts.title?.trim().toLowerCase() : undefined };

  const layer = { zone: "", group: "", under: "", line: "", element: "", label: "", ann: "" };
  for (const it of items) {
    if (it.kind === "zone") layer.zone += zone(c, it);
    else if (it.kind === "group") layer.group += group(c, it);
    else if (it.kind === "connection") { layer.line += connection(c, it); layer.label += connectionLabel(c, it); }
    else if (it.kind === "element") { if (it.under) layer.under += element(c, it); else layer.element += element(c, it); }
    else if (it.kind === "emphasis" || it.kind === "question" || it.kind === "callout") layer.ann += annotation(c, it);
    else layer.element += unknown(c, it);
  }

  const b = bounds(items);
  const width = Math.ceil(Math.max(MIN_W, b.w + 2 * PAD));
  const inner = width - 2 * PAD;

  // title block
  let head = "", y = PAD;
  if (opts.title || opts.subtitle) {
    if (opts.title) {
      head += text([opts.title], PAD, y + 12, { size: fitSize([opts.title], inner, 24, 600, 15), weight: 600, fill: t.ink, spacing: -0.2 });
      y += 34;
    }
    if (opts.subtitle) {
      // alone, the summary is the lead line: a little larger and darker
      const size = opts.title ? 13.5 : 15, lh = size * 1.42;
      const sub = wrapToWidth(opts.subtitle, Math.min(inner, 900), size, 400, 2);
      head += text(sub, PAD, y + ((sub.length - 1) * lh) / 2 + 8, { size, fill: opts.title ? t.ink2 : t.ink, lh });
      y += sub.length * lh + 6;
    }
    y += 10;
    head += path(`M${PAD} ${n(y)} L${n(width - PAD)} ${n(y)}`, t.hair, 1, { cap: "butt" });
    y += 28;
  }
  const top = y;

  // footer: legend (only if it says something), rule, date and mark
  y = top + b.h + 28;
  let foot = "";
  const entries = legend(c, items, L);
  if (entries.length) {
    let x = PAD;
    for (const e of entries) {
      if (x > PAD && x + e.w > width - PAD) { x = PAD; y += 22; }
      foot += e.draw(x, y + 8);
      x += e.w + 26;
    }
    y += 28;
  }
  foot += path(`M${PAD} ${n(y)} L${n(width - PAD)} ${n(y)}`, t.hair, 1, { cap: "butt" });
  y += 20;
  if (opts.date) foot += text([opts.date], PAD, y, { size: 11, fill: t.muted });
  foot += box(width - PAD - 8, y - 4, 8, 8, { fill: t.ink, r: 2 }) + text([L.madeWith], width - PAD - 15, y, { size: 11, fill: t.muted, anchor: "end" });
  const height = Math.ceil(y + 14 + PAD * 0.5);

  const dx = PAD + (inner - b.w) / 2 - b.x, dy = top - b.y;
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${SANS}">` +
    (opts.title ? `<title>${esc(opts.title)}</title>` : "") +
    `<rect width="${width}" height="${height}" fill="${t.bg}"/>` +
    head +
    `<g transform="translate(${n(dx)} ${n(dy)})">` +
    `<g data-layer="zones">${layer.zone}</g><g data-layer="groups">${layer.group}</g><g data-layer="under">${layer.under}</g>` +
    `<g data-layer="connections">${layer.line}</g><g data-layer="elements">${layer.element}</g>` +
    `<g data-layer="labels">${layer.label}</g><g data-layer="annotations">${layer.ann}</g>` +
    `</g>` + foot + `</svg>\n`;
  return { svg, width, height };
}
