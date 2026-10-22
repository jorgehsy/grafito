// Árbol de render: tablero + layout -> lista plana de ítems dibujables con clave estable.
import type { Board } from "./model";
import { derivedConns, findEl } from "./model";
import type { BoardLayout, Pt, Rect } from "./layout";
import { bezierAt, elLines, emphRect, markNoteLines, wrapText } from "./layout";

export type ItemKind = "zone" | "element" | "edge" | "emphasis" | "question" | "callout";
export interface Geom { x: number; y: number; w: number; h: number; pts?: Pt[]; curve?: boolean; lab?: Pt }
export interface ItemData {
  variant?: string; // tipo de paso/componente, estilo de énfasis o de arista
  lines?: string[];
  title?: string;
  leftTitle?: string;
  rightTitle?: string;
  divider?: number; // x local de la divisoria (compare)
  dashed?: boolean;
  both?: boolean;
  label?: string;
  zoneKind?: string;
  cross?: boolean;
  /** scale / mark */
  noteLines?: string[];
  tone?: string;
  side?: "above" | "below";
  minLabel?: string;
  maxLabel?: string;
  /** scale: inicio y ancho de la barra dentro de su rect */
  x0?: number;
  barW?: number;
  /** span: inicio y final del corchete en coordenadas locales (x0 y barW de scale se reutilizan: x0 = inicio, barW = ancho) */
}
export interface RItem {
  key: string;
  kind: ItemKind;
  /** firma del contenido visual (sin posición ni color): si cambia -> "update". */
  sig: string;
  /** índice de color de zona; -1 = tinta neutra */
  hue: number;
  geom: Geom;
  data: ItemData;
  /** se dibuja bajo las aristas (p. ej. la barra de una escala, para que sus muescas queden encima) */
  under?: boolean;
}
export interface RenderTree { items: RItem[]; map: Map<string, RItem> }

export const HUES = 6;

function bbox(pts: Pt[]): Rect {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function buildTree(board: Board, lay: BoardLayout): RenderTree {
  const items: RItem[] = [];
  const zoneN = new Map(board.zones.map((z) => [z.id, z.n % HUES]));

  for (const z of board.zones) {
    const r = lay.zones[z.id];
    if (!r) continue;
    const divider = lay.dividers[z.id];
    const data: ItemData = {
      title: z.title, zoneKind: z.kind, leftTitle: z.leftTitle, rightTitle: z.rightTitle,
      divider: divider !== undefined ? divider - r.x : undefined,
    };
    const sc = lay.scales[z.id];
    if (sc) {
      items.push({
        key: `bar:${z.id}`, kind: "element", under: true, hue: z.n % HUES, sig: JSON.stringify(["scale", z.minLabel, z.maxLabel]),
        geom: { ...sc.bar }, data: { variant: "scale", minLabel: z.minLabel ?? "0%", maxLabel: z.maxLabel ?? "100%", x0: sc.x0, barW: sc.w },
      });
      if (z.level && z.level.at > 0) {
        items.push({
          key: `level:${z.id}`, kind: "element", under: true, hue: z.n % HUES, sig: JSON.stringify(["scale-level", z.level.label ?? ""]),
          geom: { x: sc.bar.x + sc.x0, y: sc.bar.y, w: Math.max(2, (z.level.at / 100) * sc.w), h: sc.h },
          data: { variant: "scale-level", label: z.level.label },
        });
      }
    }
    const cl = lay.labels[`center:${z.id}`];
    if (cl && z.centerLabel) {
      items.push({
        key: `center:${z.id}`, kind: "element", hue: z.n % HUES, sig: JSON.stringify(["cycle-center", z.centerLabel]),
        geom: { ...cl }, data: { variant: "cycle-center", lines: wrapText(z.centerLabel, 14) },
      });
    }
    items.push({ key: z.id, kind: "zone", sig: JSON.stringify([z.title, z.leftTitle, z.rightTitle, z.kind]), hue: z.n % HUES, geom: { ...r }, data });
  }
  for (const e of board.els) {
    const r = lay.els[e.id];
    if (!r) continue;
    const variant = e.type === "component" ? `component:${e.comp}` : e.type;
    const lines = elLines(e);
    if (e.type === "span") {
      const sp = lay.spans[e.id];
      const tone = e.tone ?? "neutral";
      const x0 = sp ? sp.x0 - r.x : 0, bw = sp ? sp.x1 - sp.x0 : r.w;
      items.push({
        key: e.id, kind: "element", sig: JSON.stringify(["span", lines, tone, Math.round(x0), Math.round(bw)]), hue: zoneN.get(e.zone) ?? 0,
        geom: { ...r }, data: { variant: "span", lines, tone, x0, barW: bw },
      });
      continue;
    }
    if (e.type === "stage" || e.type === "event") {
      const noteLines = markNoteLines(e);
      items.push({
        key: e.id, kind: "element", sig: JSON.stringify([variant, lines, noteLines]), hue: zoneN.get(e.zone) ?? 0,
        geom: { ...r }, data: { variant, lines, noteLines },
      });
      const w = lay.labels[`when:${e.id}`];
      if (e.type === "event" && e.when && w) {
        items.push({
          key: `when:${e.id}`, kind: "element", sig: JSON.stringify(["when", e.when]), hue: zoneN.get(e.zone) ?? 0,
          geom: { ...w }, data: { variant: "when", lines: [e.when] },
        });
      }
      const mg = lay.marks[e.id];
      if (e.type === "event" && mg) {
        items.push({
          key: `stem:${e.id}`, kind: "edge", hue: zoneN.get(e.zone) ?? 0, sig: JSON.stringify(["event-stem", mg.side]),
          geom: { ...bbox(mg.stem), pts: mg.stem }, data: { variant: "event-stem", side: mg.side },
        });
      }
      continue;
    }
    if (e.type === "mark") {
      const noteLines = markNoteLines(e);
      const tone = e.tone ?? "neutral";
      items.push({
        key: e.id, kind: "element", sig: JSON.stringify([variant, lines, noteLines, tone]), hue: zoneN.get(e.zone) ?? 0,
        geom: { ...r }, data: { variant, lines, noteLines, tone },
      });
      const mg = lay.marks[e.id];
      if (mg) {
        items.push({
          key: `stem:${e.id}`, kind: "edge", hue: -1, sig: JSON.stringify(["mark-stem", tone, mg.side]),
          geom: { ...bbox(mg.stem), pts: mg.stem }, data: { variant: "mark-stem", tone, side: mg.side },
        });
      }
      continue;
    }
    items.push({ key: e.id, kind: "element", sig: JSON.stringify([variant, lines]), hue: zoneN.get(e.zone) ?? 0, geom: { ...r }, data: { variant, lines } });
  }
  // anillo de un ciclo y eje de una línea de tiempo
  for (const [key, g] of Object.entries(lay.edges)) {
    const isRing = key.startsWith("ring:"), isAxis = key.startsWith("axis:");
    if (!isRing && !isAxis) continue;
    const zid = isAxis ? key.slice(5) : findEl(board, key.slice(5))?.zone;
    const hue = zoneN.get(zid ?? "") ?? 0;
    items.push({
      key, kind: "edge", hue, sig: JSON.stringify([isRing ? "ring" : "axis"]),
      geom: { ...bbox(g.pts), pts: g.pts, curve: g.kind === "curve" }, data: { variant: isRing ? "ring" : "axis" },
    });
  }
  for (const c of [...derivedConns(board), ...board.conns]) {
    const g = lay.edges[c.id];
    if (!g) continue;
    const b = bbox(g.pts);
    items.push({
      key: c.id, kind: "edge", hue: -1,
      sig: JSON.stringify([c.style, c.both, c.label ?? ""]),
      geom: { ...b, pts: g.pts, curve: g.kind === "curve", lab: g.label ? { x: g.label.x, y: g.label.y } : undefined },
      data: { dashed: c.style === "dashed", both: c.both, label: g.label?.text, cross: g.cross },
    });
  }

  // anotaciones
  const targetRect = (id: string, forMark: boolean): Rect | undefined => {
    const el = lay.els[id];
    if (el) return el;
    const z = lay.zones[id];
    if (z) return forMark ? { x: z.x + 8, y: z.y + 4, w: Math.min(z.w - 16, (board.zones.find((q) => q.id === id)!.title.length) * 13 + 30), h: 44 } : z;
    const e = lay.edges[id];
    if (e) {
      const m = e.kind === "curve" ? bezierAt(e.pts, 0.5) : e.pts[Math.floor(e.pts.length / 2)];
      return { x: m.x - 6, y: m.y - 6, w: 12, h: 12 };
    }
    return undefined;
  };
  for (const m of board.emph) {
    const t = targetRect(m.target, true);
    if (!t) continue;
    let geom: Geom;
    if (m.style === "circle") geom = lay.els[m.target] ? emphRect(t) : { x: t.x - 16, y: t.y - 14, w: t.w + 32, h: t.h + 28 };
    else if (m.style === "underline") geom = { x: t.x, y: t.y + t.h + 2, w: t.w, h: 10 };
    else geom = { x: t.x + t.w - 16, y: t.y - 26, w: 38, h: 38 };
    items.push({ key: `emph:${m.target}`, kind: "emphasis", hue: -1, sig: m.style, geom, data: { variant: m.style } });
  }
  for (const q of board.questions) {
    const t = targetRect(q.target, true);
    if (!t) continue;
    items.push({
      key: `q:${q.target}`, kind: "question", hue: -1, sig: q.text ?? "",
      geom: { x: t.x + t.w - 8, y: t.y - 34, w: 34, h: 34 },
      data: { lines: q.text ? wrapText(q.text, 24) : [] },
    });
  }
  for (const co of board.callouts) {
    const c = lay.callouts[co.id];
    if (!c) continue;
    items.push({
      key: co.id, kind: "callout", hue: -1, sig: JSON.stringify(c.lines),
      geom: { ...c.box, pts: c.arrow.pts, curve: true },
      data: { lines: c.lines },
    });
  }
  return { items, map: new Map(items.map((i) => [i.key, i])) };
}

export const emptyTree = (): RenderTree => ({ items: [], map: new Map() });

export function geomEqual(a: Geom, b: Geom, eps = 0.5): boolean {
  if (Math.abs(a.x - b.x) > eps || Math.abs(a.y - b.y) > eps || Math.abs(a.w - b.w) > eps || Math.abs(a.h - b.h) > eps) return false;
  if (!!a.pts !== !!b.pts) return false;
  if (a.pts && b.pts) {
    if (a.pts.length !== b.pts.length) return false;
    return a.pts.every((p, i) => Math.abs(p.x - b.pts![i].x) <= eps && Math.abs(p.y - b.pts![i].y) <= eps);
  }
  if (a.lab || b.lab) {
    if (!a.lab || !b.lab || Math.abs(a.lab.x - b.lab.x) > eps || Math.abs(a.lab.y - b.lab.y) > eps) return false;
  }
  return true;
}
