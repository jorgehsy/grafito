// Construye el SVG "a mano" (rough.js) de cada ítem. Semilla fija derivada de la clave: nunca tiembla.
import rough from "roughjs";
import type { Options } from "roughjs/bin/core";
import type { Drawable } from "roughjs/bin/core";
import type { Geom, RItem } from "../tree";
import { LABEL_SIZE, labelRect } from "../layout";

const NS = "http://www.w3.org/2000/svg";
const gen = rough.generator();

export const FILLS = ["#ffd8a8", "#a5d8ff", "#b2f2bb", "#eebefa", "#ffec99", "#ffc9c9"];
/** Nombre en español de cada relleno de FILLS (mismo orden); lo usa el tablero serializado. */
export const FILL_NAMES = ["naranja", "azul", "verde", "morado", "amarillo", "rojo"];
export const EDGES = ["#e8590c", "#1971c2", "#2f9e44", "#9c36b5", "#f08c00", "#e03131"];
export const INK = "#2b2f36";
export const RED = "#e03131";
export const BLUE = "#1864ab";
export const PAPER = "#fffdf5";
export const TONES: Record<string, { ink: string; fill: string }> = {
  neutral: { ink: INK, fill: "#fff3bf" },
  warn: { ink: "#d9730d", fill: "#ffd43b" },
  danger: { ink: RED, fill: "#ffa8a8" },
  ok: { ink: "#2f9e44", fill: "#b2f2bb" },
};
export const FONT_FAMILY = "'Kalam', 'Caveat', cursive";

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 2147483646 + 1;
}

export interface Stroke { anim: SVGPathElement; show: SVGPathElement; len: number }
export interface TextRun { el: SVGTextElement; chars: SVGTSpanElement[]; offsets: number[] }
export interface Visual {
  g: SVGGElement;
  strokes: Stroke[];
  fills: SVGElement[];
  texts: TextRun[];
  /** true: las formas están en coordenadas locales y g lleva translate(geom.x, geom.y) */
  translates: boolean;
}

let maskId = 0;
const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

class Builder {
  v: Visual;
  defs?: SVGDefsElement;
  constructor(private key: string, translates: boolean) {
    this.v = { g: el("g"), strokes: [], fills: [], texts: [], translates };
  }
  seed(part: string) { return hash(this.key + ":" + part); }

  /** Añade un Drawable de rough: trazos del contorno (en tramos independientes) y relleno. */
  shape(d: Drawable, o: { stroke: string; width: number; dash?: boolean; fill?: string; fillOpacity?: number }) {
    for (const p of gen.toPaths(d)) {
      if (p.fill && p.fill !== "none") {
        const f = el("path", { d: p.d, fill: p.fill, stroke: "none", opacity: o.fillOpacity ?? 1 });
        this.v.g.appendChild(f); this.v.fills.push(f);
      } else if (o.fill && p.stroke === o.fill) {
        const f = el("path", { d: p.d, fill: "none", stroke: p.stroke, "stroke-width": p.strokeWidth, "stroke-linecap": "round", opacity: o.fillOpacity ?? 1 });
        this.v.g.appendChild(f); this.v.fills.push(f);
      } else {
        for (const sub of p.d.split(/(?=M)/)) if (sub.trim()) this.stroke(sub, o.stroke, o.width, !!o.dash);
      }
    }
  }
  stroke(d: string, color: string, width: number, dash: boolean) {
    const base = { d, fill: "none", stroke: color, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round" };
    if (!dash) {
      const p = el("path", base);
      this.v.g.appendChild(p);
      this.v.strokes.push({ anim: p, show: p, len: 0 });
      return;
    }
    // trazo discontinuo: se muestra con una máscara cuyo trazo continuo es el que se anima
    if (!this.defs) { this.defs = el("defs"); this.v.g.appendChild(this.defs); }
    const id = `m${++maskId}`;
    const mask = el("mask", { id, maskUnits: "userSpaceOnUse", x: -20000, y: -20000, width: 40000, height: 40000 });
    const mp = el("path", { d, fill: "none", stroke: "#fff", "stroke-width": width + 8, "stroke-linecap": "round" });
    mask.appendChild(mp);
    this.defs.appendChild(mask);
    const shown = el("path", { ...base, "stroke-dasharray": "9 7", mask: `url(#${id})` });
    this.v.g.appendChild(shown);
    this.v.strokes.push({ anim: mp, show: shown, len: 0 });
  }
  rough(kind: "rect" | "ellipse" | "poly" | "path" | "line" | "curve", part: string, args: any[], o: Options, style: { stroke: string; width: number; dash?: boolean; fill?: string; fillOpacity?: number }) {
    const opts: Options = { roughness: 1.3, bowing: 1.2, seed: this.seed(part), strokeWidth: style.width, stroke: style.stroke, ...o };
    if (style.fill) { opts.fill = style.fill; opts.fillStyle = (o.fillStyle ?? "hachure"); opts.hachureGap = o.hachureGap ?? 9; opts.fillWeight = o.fillWeight ?? 1.6; }
    let d: Drawable;
    switch (kind) {
      case "rect": d = gen.rectangle(args[0], args[1], args[2], args[3], opts); break;
      case "ellipse": d = gen.ellipse(args[0], args[1], args[2], args[3], opts); break;
      case "poly": d = gen.polygon(args[0], opts); break;
      case "path": d = gen.path(args[0], opts); break;
      case "line": d = gen.line(args[0], args[1], args[2], args[3], opts); break;
      case "curve": d = gen.curve(args[0], opts); break;
    }
    this.shape(d, style);
  }
  text(lines: string[], cx: number, cy: number, o: { size?: number; anchor?: "middle" | "start" | "end"; fill?: string; weight?: number; halo?: boolean; lineH?: number } = {}) {
    const size = o.size ?? 20, lh = o.lineH ?? size * 1.2;
    const y0 = cy - ((lines.length - 1) * lh) / 2;
    lines.forEach((line, i) => {
      const t = el("text", {
        x: cx, y: y0 + i * lh, "text-anchor": o.anchor ?? "middle", "dominant-baseline": "central",
        "font-family": FONT_FAMILY, "font-size": size, "font-weight": o.weight ?? 400, fill: o.fill ?? INK,
      });
      if (o.halo) { t.setAttribute("stroke", "#fffdf5"); t.setAttribute("stroke-width", "5"); t.setAttribute("paint-order", "stroke"); t.setAttribute("stroke-linejoin", "round"); }
      const chars: SVGTSpanElement[] = [], offsets: number[] = [];
      let off = 0;
      for (const ch of line) {
        const s = el("tspan");
        s.textContent = ch;
        t.appendChild(s); chars.push(s); offsets.push(off); off += ch.length;
      }
      this.v.g.appendChild(t);
      this.v.texts.push({ el: t, chars, offsets });
    });
  }
}

function roundedPoly(pts: { x: number; y: number }[], r = 12): string {
  if (pts.length < 3) return `M${pts[0].x} ${pts[0].y} L${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p1 = { x: b.x + ((a.x - b.x) / l1) * rr, y: b.y + ((a.y - b.y) / l1) * rr };
    const p2 = { x: b.x + ((c.x - b.x) / l2) * rr, y: b.y + ((c.y - b.y) / l2) * rr };
    d += ` L${p1.x} ${p1.y} Q${b.x} ${b.y} ${p2.x} ${p2.y}`;
  }
  const z = pts[pts.length - 1];
  return d + ` L${z.x} ${z.y}`;
}

function arrowHead(b: Builder, part: string, tip: { x: number; y: number }, from: { x: number; y: number }, color: string, width: number) {
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x), L = 17, spread = 0.5;
  const a = { x: tip.x - L * Math.cos(ang - spread), y: tip.y - L * Math.sin(ang - spread) };
  const c = { x: tip.x - L * Math.cos(ang + spread), y: tip.y - L * Math.sin(ang + spread) };
  b.rough("path", part, [`M${a.x} ${a.y} L${tip.x} ${tip.y} L${c.x} ${c.y}`], { roughness: 0.8 }, { stroke: color, width });
}

function star(w: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? w / 2 : w / 4.4, a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push([w / 2 + r * Math.cos(a), w / 2 + r * Math.sin(a)]);
  }
  return pts;
}

export function buildVisual(item: RItem, geom: Geom): Visual {
  const { w, h } = geom;
  const translates = item.kind === "zone" || item.kind === "element" || item.kind === "emphasis" || item.kind === "question";
  const b = new Builder(item.key, translates);
  const fill = item.hue >= 0 ? FILLS[item.hue] : "#fff3bf";
  const edge = item.hue >= 0 ? EDGES[item.hue] : INK;
  const st = { stroke: INK, width: 2.2 };

  if (item.kind === "zone") {
    b.rough("rect", "frame", [3, 3, w - 6, h - 6], { roughness: 1.6, fillStyle: "solid" }, { stroke: edge, width: 2.6, fill, fillOpacity: 0.28 });
    const title = item.data.title ?? "";
    b.text([title], 26, 28, { size: 26, anchor: "start", weight: 700, fill: INK });
    b.rough("line", "ul", [24, 46, 24 + Math.min(w - 50, title.length * 13.5), 47], { roughness: 1.4 }, { stroke: edge, width: 2.4 });
    if (item.data.divider !== undefined) {
      b.rough("line", "div", [item.data.divider, 62, item.data.divider, h - 20], { roughness: 1.4 }, { stroke: edge, width: 2 });
      b.text([item.data.leftTitle ?? ""], (26 + item.data.divider) / 2, 84, { size: 22, weight: 700, fill: edge });
      b.text([item.data.rightTitle ?? ""], (item.data.divider + w - 26) / 2, 84, { size: 22, weight: 700, fill: edge });
    }
  } else if (item.kind === "element") {
    const lines = item.data.lines ?? [];
    const v = item.data.variant!;
    const f = { ...st, fill };
    if (v === "scale") {
      const x0 = item.data.x0 ?? 0, bw = item.data.barW ?? w;
      b.rough("rect", "bar", [x0, 2, bw, h - 4], { roughness: 1.4, fillStyle: "solid" }, { stroke: INK, width: 2.6, fill: PAPER });
      b.text([item.data.minLabel ?? ""], x0 - 10, h / 2, { anchor: "end", size: 22, weight: 700 });
      b.text([item.data.maxLabel ?? ""], x0 + bw + 10, h / 2, { anchor: "start", size: 22, weight: 700 });
    } else if (v === "scale-level") {
      b.rough("rect", "lvl", [1, 4, Math.max(1, w - 2), h - 8], { roughness: 1.2, hachureGap: 8, hachureAngle: -40 }, { stroke: edge, width: 2.2, fill: edge, fillOpacity: 0.75 });
      if (item.data.label) {
        const need = item.data.label.length * 11 + 24;
        if (w >= need) b.text([item.data.label], w - 12, h / 2, { anchor: "end", size: 20, weight: 700, halo: true });
        else b.text([item.data.label], 10, h / 2, { anchor: "start", size: 20, weight: 700, halo: true });
      }
    } else if (v === "mark") {
      const tone = TONES[item.data.tone ?? "neutral"] ?? TONES.neutral;
      const lines = item.data.lines ?? [], notes = item.data.noteLines ?? [];
      b.text(lines, w / 2, 5 + (lines.length * 27) / 2, { size: 22, weight: 700, fill: tone.ink, lineH: 27, halo: true });
      if (notes.length) b.text(notes, w / 2, 5 + lines.length * 27 + (notes.length * 22) / 2, { size: 18, fill: "#495057", lineH: 22, halo: true });
    } else if (v === "stage") {
      const lines = item.data.lines ?? [], notes = item.data.noteLines ?? [];
      b.rough("rect", "stg", [2, 2, w - 4, h - 4], { roughness: 1.4 }, { ...f, width: 2.6 });
      const top = 13 + (lines.length * 27) / 2;
      b.text(lines, w / 2, top, { size: 22, weight: 700, lineH: 27 });
      if (notes.length) b.text(notes, w / 2, 13 + lines.length * 27 + (notes.length * 22) / 2, { size: 18, fill: "#495057", lineH: 22 });
    } else if (v === "branch") {
      const lines = item.data.lines ?? [], notes = item.data.noteLines ?? [];
      b.rough("rect", "brn", [2, 2, w - 4, h - 4], { roughness: 1.3 }, { ...f, width: 2.4 });
      b.text(lines, w / 2, 13 + (lines.length * 27) / 2, { size: 22, weight: 700, lineH: 27 });
      if (notes.length) b.text(notes, w / 2, 13 + lines.length * 27 + (notes.length * 22) / 2, { size: 18, fill: "#495057", lineH: 22 });
    } else if (v === "event") {
      const lines = item.data.lines ?? [], notes = item.data.noteLines ?? [];
      b.rough("rect", "evt", [2, 2, w - 4, h - 4], { roughness: 1.3, fillStyle: "solid" }, { stroke: edge, width: 2.4, fill: PAPER });
      b.text(lines, w / 2, 13 + (lines.length * 27) / 2, { size: 22, weight: 700, lineH: 27 });
      if (notes.length) b.text(notes, w / 2, 13 + lines.length * 27 + (notes.length * 22) / 2, { size: 18, fill: "#495057", lineH: 22 });
    } else if (v === "when") {
      b.text(item.data.lines ?? [], w / 2, h / 2, { size: 20, weight: 700, fill: edge, halo: true });
    } else if (v === "span") {
      // llave bajo el eje (extremos hacia arriba) y la etiqueta debajo
      const tone = TONES[item.data.tone ?? "neutral"] ?? TONES.neutral;
      const x0 = item.data.x0 ?? 0, x1 = x0 + (item.data.barW ?? w);
      b.rough("path", "brk", [`M${x0} 2 L${x0} 14 L${x1} 14 L${x1} 2`], { roughness: 1.1, bowing: 1 }, { stroke: tone.ink, width: 2.8 });
      b.text(item.data.lines ?? [], (x0 + x1) / 2, 14 + 15, { size: 21, weight: 700, fill: tone.ink, halo: true });
    } else if (v === "cycle-center") {
      b.rough("ellipse", "ctr", [w / 2, h / 2, w - 6, h - 6], { roughness: 1.5, fillStyle: "solid" }, { stroke: edge, width: 2.4, fill, fillOpacity: 0.35 });
      b.text(item.data.lines ?? [], w / 2, h / 2, { size: 24, weight: 700 });
    } else if (v === "step") {
      b.rough("rect", "s", [2, 2, w - 4, h - 4], {}, f);
      b.text(lines, w / 2, h / 2);
    } else if (v === "decision") {
      b.rough("poly", "d", [[[w / 2, 2], [w - 2, h / 2], [w / 2, h - 2], [2, h / 2]]], {}, f);
      b.text(lines, w / 2, h / 2);
    } else if (v === "node") {
      b.rough("ellipse", "n", [w / 2, h / 2, w - 4, h - 4], {}, f);
      b.text(lines, w / 2, h / 2);
    } else if (v === "item") {
      b.rough("ellipse", "dot", [10, h / 2, 12, 12], { fillStyle: "solid", roughness: 0.8 }, { stroke: edge, width: 2, fill: edge });
      b.text(lines, 26, h / 2, { anchor: "start" });
    } else if (v === "component:actor") {
      const cx = w / 2;
      b.rough("ellipse", "head", [cx, 17, 28, 28], {}, f);
      b.rough("line", "body", [cx, 31, cx, 58], {}, st);
      b.rough("line", "arms", [cx - 20, 41, cx + 20, 41], {}, st);
      b.rough("line", "l1", [cx, 58, cx - 15, 78], {}, st);
      b.rough("line", "l2", [cx, 58, cx + 15, 78], {}, st);
      b.text(lines, cx, 90 + ((lines.length - 1) * 24) / 2 + 8);
    } else if (v === "component:client") {
      b.rough("rect", "win", [2, 2, w - 4, h - 4], {}, f);
      b.rough("line", "bar", [2, 24, w - 2, 24], { roughness: 0.9 }, st);
      [14, 28, 42].forEach((x, i) => b.rough("ellipse", `dot${i}`, [x, 13, 7, 7], { fillStyle: "solid", roughness: 0.6 }, { stroke: INK, width: 1.4, fill: INK }));
      b.text(lines, w / 2, 24 + (h - 24) / 2);
    } else if (v === "component:service") {
      b.rough("rect", "svc", [2, 2, w - 4, h - 4], { fillStyle: "cross-hatch", hachureGap: 11 }, { ...f, width: 2.6 });
      b.text(lines, w / 2, h / 2, { weight: 700 });
    } else if (v === "component:database") {
      const ry = 15, rx = w / 2 - 3;
      b.rough("path", "cyl", [`M3 ${ry} A${rx} ${ry} 0 0 1 ${w - 3} ${ry} L${w - 3} ${h - ry} A${rx} ${ry} 0 0 1 3 ${h - ry} Z`], {}, f);
      b.rough("path", "rim", [`M3 ${ry} A${rx} ${ry} 0 0 0 ${w - 3} ${ry}`], { roughness: 1 }, st);
      b.text(lines, w / 2, ry * 2 + (h - ry * 3) / 2);
    } else if (v === "component:queue") {
      for (let i = 0; i < 3; i++) b.rough("rect", `q${i}`, [2 + i * 9, 2 + i * 9, w - 22, h - 22], {}, f);
      b.text(lines, 2 + 18 + (w - 22) / 2, 2 + 18 + (h - 22) / 2);
    } else if (v === "component:storage") {
      b.rough("poly", "bk", [[[5, 12], [w - 5, 12], [w - 20, h - 3], [20, h - 3]]], {}, f);
      b.rough("ellipse", "rim", [w / 2, 12, w - 10, 20], { roughness: 0.9 }, st);
      b.text(lines, w / 2, 14 + (h - 14) / 2);
    } else if (v === "component:external") {
      const c = (x: number, y: number) => `${x * w} ${y * h}`;
      const d = `M${c(0.2, 0.82)} C${c(-0.03, 0.82)} ${c(-0.03, 0.45)} ${c(0.2, 0.45)} C${c(0.18, 0.12)} ${c(0.52, 0.08)} ${c(0.56, 0.3)} C${c(0.7, 0.1)} ${c(1.0, 0.25)} ${c(0.9, 0.5)} C${c(1.06, 0.55)} ${c(1.02, 0.87)} ${c(0.82, 0.82)} Z`;
      b.rough("path", "cloud", [d], { roughness: 1.1 }, { ...f, dash: true });
      b.text(lines, w / 2, h * 0.56);
    }
  } else if (item.kind === "edge" && item.data.variant === "mark-stem") {
    // muesca que cruza la barra + tallo hasta la etiqueta + triángulo que apunta a la barra
    const [far, near, hook] = geom.pts!;
    const tone = TONES[item.data.tone ?? "neutral"] ?? TONES.neutral;
    const ts = { stroke: tone.ink, width: 2.6 };
    const len = Math.hypot(hook.x - near.x, hook.y - near.y) || 1;
    const u = { x: (hook.x - near.x) / len, y: (hook.y - near.y) / len };
    const base = { x: near.x + u.x * 14, y: near.y + u.y * 14 };
    b.rough("line", "tick", [far.x, far.y, near.x, near.y], { roughness: 0.8 }, { ...ts, width: 3.4 });
    b.rough("line", "stem", [base.x, base.y, hook.x, hook.y], { roughness: 0.9 }, ts);
    b.rough("poly", "tri", [[[base.x - u.y * 8, base.y + u.x * 8], [base.x + u.y * 8, base.y - u.x * 8], [near.x, near.y]]], { fillStyle: "solid", roughness: 0.7 }, { ...ts, width: 2, fill: tone.fill });
  } else if (item.kind === "edge" && item.data.variant === "bracket") {
    // codo sin punta: la jerarquía se lee de izquierda a derecha
    b.rough("path", "line", [roundedPoly(geom.pts!, 10)], { roughness: 0.9, bowing: 0.6 }, { stroke: edge, width: 2.4 });
  } else if (item.kind === "edge" && item.data.variant === "event-stem") {
    // punto en el eje + tallo hasta la caja
    const [, dot, hook] = geom.pts!;
    const len = Math.hypot(hook.x - dot.x, hook.y - dot.y) || 1;
    const u = { x: (hook.x - dot.x) / len, y: (hook.y - dot.y) / len };
    b.rough("ellipse", "dot", [dot.x, dot.y, 15, 15], { fillStyle: "solid", roughness: 0.8 }, { stroke: edge, width: 2.4, fill: edge });
    b.rough("line", "stem", [dot.x + u.x * 8, dot.y + u.y * 8, hook.x, hook.y], { roughness: 0.9 }, { stroke: edge, width: 2.4 });
  } else if (item.kind === "edge") {
    const pts = geom.pts!;
    const cross = !!item.data.cross;
    const color = cross ? "#7b8794" : INK, wd = cross ? 1.7 : 2.2, dash = !!item.data.dashed || cross;
    const d = geom.curve
      ? `M${pts[0].x} ${pts[0].y} C${pts[1].x} ${pts[1].y} ${pts[2].x} ${pts[2].y} ${pts[3].x} ${pts[3].y}`
      : roundedPoly(pts);
    b.rough("path", "line", [d], { roughness: cross ? 0.7 : 1.0, bowing: 0.8 }, { stroke: color, width: wd, dash });
    const n = pts.length;
    const tipFrom = geom.curve ? pts[2] : pts[n - 2];
    arrowHead(b, "head", pts[n - 1], tipFrom.x === pts[n - 1].x && tipFrom.y === pts[n - 1].y ? pts[0] : tipFrom, color, wd);
    if (item.data.both) arrowHead(b, "head0", pts[0], geom.curve ? pts[1] : pts[1], color, wd);
    if (item.data.label && geom.lab) {
      const lr = labelRect({ x: geom.lab.x, y: geom.lab.y, text: item.data.label });
      const patch = el("rect", { x: lr.x, y: lr.y, width: lr.w, height: lr.h, rx: 6, fill: PAPER, opacity: 0.96 });
      b.v.g.appendChild(patch); b.v.fills.push(patch);
      b.text([item.data.label], geom.lab.x, geom.lab.y + 1, { size: LABEL_SIZE, halo: true, fill: "#343a40" });
    }
  } else if (item.kind === "emphasis") {
    const s = item.data.variant;
    const r = { stroke: RED, width: 3 };
    if (s === "circle") b.rough("ellipse", "c", [w / 2, h / 2, w, h], { roughness: 2, bowing: 2.5 }, r);
    else if (s === "underline") b.rough("curve", "u", [[[0, 5], [w * 0.3, 8], [w * 0.62, 2], [w, 6]]], { roughness: 1.6 }, r);
    else b.rough("poly", "star", [star(w)], { roughness: 1.2, fillStyle: "solid" }, { stroke: RED, width: 2.4, fill: "#ffd43b" });
  } else if (item.kind === "question") {
    b.rough("ellipse", "q", [w / 2, h / 2, w, w], { fillStyle: "solid", roughness: 1.3 }, { stroke: RED, width: 2.6, fill: "#fff3bf" });
    b.text(["?"], w / 2, h / 2 + 1, { size: 26, weight: 700, fill: RED });
    if (item.data.lines?.length) b.text(item.data.lines, w + 6, h / 2, { size: 21, anchor: "start", fill: RED });
  } else if (item.kind === "callout") {
    const lines = item.data.lines ?? [];
    b.text(lines, geom.x + w / 2, geom.y + h / 2, { size: 24, fill: BLUE, lineH: 29 });
    const p = geom.pts!;
    b.rough("path", "arrow", [`M${p[0].x} ${p[0].y} C${p[1].x} ${p[1].y} ${p[2].x} ${p[2].y} ${p[3].x} ${p[3].y}`], { roughness: 1.1, bowing: 1.5 }, { stroke: BLUE, width: 2.2 });
    arrowHead(b, "head", p[3], p[2], BLUE, 2.2);
  }

  if (translates) b.v.g.setAttribute("transform", `translate(${geom.x} ${geom.y})`);
  return b.v;
}

/** Mide los trazos (el grupo ya debe estar en el DOM). */
export function measure(v: Visual) {
  for (const s of v.strokes) s.len = s.anim.getTotalLength();
}
export function hideForDraw(v: Visual) {
  for (const s of v.strokes) {
    s.anim.style.strokeDasharray = `${s.len + 1}`;
    s.anim.style.strokeDashoffset = `${s.len + 1}`;
    if (s.show !== s.anim) s.show.style.opacity = "1";
  }
  for (const f of v.fills) f.style.opacity = "0";
  for (const t of v.texts) for (const c of t.chars) c.setAttribute("fill-opacity", "0");
}
export function showAll(v: Visual) {
  for (const s of v.strokes) { s.anim.style.strokeDasharray = ""; s.anim.style.strokeDashoffset = ""; }
  for (const f of v.fills) f.style.opacity = "";
  for (const t of v.texts) for (const c of t.chars) c.removeAttribute("fill-opacity");
}
export function hideText(v: Visual) {
  for (const t of v.texts) for (const c of t.chars) c.setAttribute("fill-opacity", "0");
}
