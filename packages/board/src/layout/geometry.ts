import type { Element, Group } from "../model";
import type { Pt, Rect } from "./types";

export const FONT = 20;
export const CHAR_W = 10.1;
export const LINE_H = 24;
export const HEADER = 50;
export const PAD = 26;
export const ZONE_GAP = 150;
export const LABEL_SIZE = 21;
export const LABEL_LH = 24;
/** Arrow labels longer than this are split into two lines. */
export const LABEL_MAX_1LINE = 22;
export const LABEL_CW = 10.3;
export const MARK_LABEL_CW = 11.0;
export const MARK_NOTE_CW = 9.1;
export const MARK_LABEL_LH = 27;
export const MARK_NOTE_LH = 22;
export const MARK_GAP = 14;
export const TL_LANE_H = 44;
/** AWS group box: corner icon square, header (icon + label) height, inner padding, label font. */
export const GROUP_ICON = 26;
export const GROUP_HEAD = 42;
export const GROUP_PAD = 20;
export const GROUP_LABEL_SIZE = 19;
const GROUP_LABEL_CW = 9.8;
const GROUP_MIN = { w: 220, h: 130 };

/** Entity box (data zone): header band with the name, one row per field, a column for the key mark. */
export const ENTITY_HEAD = 40;
export const ENTITY_ROW = 27;
export const ENTITY_PAD = 14;
export const ENTITY_KEY_W = 30;
export const ENTITY_NAME_SIZE = 22;
export const ENTITY_FIELD_SIZE = 19;
const ENTITY_NAME_CW = 11.6;
const ENTITY_FIELD_CW = 9.6;
const ENTITY_TYPE_GAP = 22;

/** Width of a group's header strip: icon, gap, label. */
export const groupHeaderW = (label: string) => 8 + GROUP_ICON + 10 + [...label].length * GROUP_LABEL_CW + 14;
/** Smallest box of a group: what an empty group gets, and the floor for one with content. */
export const groupMinSize = (g: Group) => ({ w: Math.max(GROUP_MIN.w, Math.ceil(groupHeaderW(g.label))), h: GROUP_MIN.h });
/** The header strip of a group laid out at `r` (kept clear of arrow labels). */
export const groupHeaderRect = (r: Rect, label: string): Rect => ({ x: r.x, y: r.y, w: Math.min(r.w, groupHeaderW(label)), h: GROUP_HEAD });

export function wrapText(text: string, max: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= max) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
export const maxLen = (lines: string[]) => Math.max(...lines.map((l) => [...l].length));
/** Arrow label: one line if short; otherwise two as even as possible (cut at the space closest to the middle). */
export function labelLines(text: string): string[] {
  const t = text.trim();
  if ([...t].length <= LABEL_MAX_1LINE) return [t];
  let cut = -1;
  for (let i = 0; i < t.length; i++) if (t[i] === " " && (cut < 0 || Math.abs(i - t.length / 2) < Math.abs(cut - t.length / 2))) cut = i;
  return cut < 0 ? [t] : [t.slice(0, cut), t.slice(cut + 1)];
}

/** Visible lines of an element (the icon goes before the first). */
export function elementLines(e: Element): string[] {
  // an entity's name is one line: the table is as wide as it needs
  if (e.type === "entity") return [e.label.trim()];
  const wrap = e.type === "mark" || e.type === "event" || e.type === "span" || e.type === "branch" ? 18 : e.type === "stage" ? 16 : e.type === "decision" ? 14 : e.type === "item" ? 28 : e.type === "node" ? 20 : e.comp === "actor" ? 14 : 18;
  const lines = wrapText(e.label, wrap);
  if (e.icon) lines[0] = `${e.icon} ${lines[0]}`;
  return lines;
}

/** Lines of the explanation of a mark, stage or event (below its label). */
export const markNoteLines = (e: Element): string[] => (e.note ? wrapText(e.note, 22) : []);

export function elementSize(e: Element): { w: number; h: number } {
  const lines = elementLines(e);
  const tw = maxLen(lines) * CHAR_W;
  const th = lines.length * LINE_H;
  switch (e.type) {
    case "step": return { w: Math.max(130, tw + 40), h: Math.max(56, th + 28) };
    case "decision": return { w: Math.max(180, tw * 1.9 + 20), h: Math.max(104, th * 2 + 24) };
    case "node": return { w: Math.max(110, tw + 40), h: th + 26 };
    case "item": return { w: tw + 36, h: th + 10 };
    case "mark": {
      const nl = markNoteLines(e);
      return {
        w: Math.max(maxLen(lines) * MARK_LABEL_CW, nl.length ? maxLen(nl) * MARK_NOTE_CW : 0) + 14,
        h: lines.length * MARK_LABEL_LH + nl.length * MARK_NOTE_LH + 10,
      };
    }
    case "stage":
    case "branch":
    case "event": {
      const nl = markNoteLines(e);
      return {
        w: Math.max(e.type === "stage" ? 130 : e.type === "branch" ? 90 : 100, maxLen(lines) * MARK_LABEL_CW, nl.length ? maxLen(nl) * MARK_NOTE_CW : 0) + 34,
        h: lines.length * MARK_LABEL_LH + nl.length * MARK_NOTE_LH + 26,
      };
    }
    case "span": {
      const w = [...e.label].length * LABEL_CW + 16;
      return { w, h: TL_LANE_H };
    }
    case "entity": {
      const fields = e.fields ?? [];
      const row = (f: { name: string; type?: string }) => ENTITY_KEY_W + ([...f.name].length + (f.type ? [...f.type].length : 0)) * ENTITY_FIELD_CW + (f.type ? ENTITY_TYPE_GAP : 0) + ENTITY_PAD;
      return {
        w: Math.ceil(Math.max(150, [...e.label].length * ENTITY_NAME_CW + 2 * ENTITY_PAD + 8, ...fields.map(row))),
        // an entity with no fields yet keeps one empty row, so it still reads as a table
        h: ENTITY_HEAD + Math.max(1, fields.length) * ENTITY_ROW + 8,
      };
    }
    case "component":
      switch (e.comp) {
        case "actor": return { w: Math.max(96, tw + 16), h: 86 + th };
        case "client": return { w: Math.max(160, tw + 40), h: Math.max(96, th + 70) };
        case "database": return { w: Math.max(130, tw + 40), h: Math.max(100, th + 66) };
        case "queue": return { w: Math.max(170, tw + 66), h: Math.max(78, th + 48) };
        case "storage": return { w: Math.max(140, tw + 50), h: Math.max(94, th + 54) };
        case "external": return { w: Math.max(180, tw + 70), h: Math.max(96, th + 58) };
        default: return { w: Math.max(140, tw + 40), h: Math.max(68, th + 30) };
      }
  }
}

export const rectRight = (r: Rect) => r.x + r.w;
export const rectBottom = (r: Rect) => r.y + r.h;
export const center = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
export function overlaps(a: Rect, b: Rect, m = 0): boolean {
  return a.x < rectRight(b) + m && b.x < rectRight(a) + m && a.y < rectBottom(b) + m && b.y < rectBottom(a) + m;
}
/** Box (with a background patch) of a connection label centered at (x, y). */
export function labelRect(l: { x: number; y: number; text: string }): Rect {
  const lines = labelLines(l.text);
  const w = maxLen(lines) * LABEL_CW + 14, h = lines.length * LABEL_LH + 8;
  return { x: l.x - w / 2, y: l.y - h / 2, w, h };
}
/** Emphasis ellipse around an element: roomy so it doesn't clip its corners. */
export function emphasisRect(r: Rect): Rect {
  const w = r.w * 1.25 + 16, h = r.h * 1.25 + 16;
  return { x: r.x + r.w / 2 - w / 2, y: r.y + r.h / 2 - h / 2, w, h };
}
export function union(rs: Rect[]): Rect {
  if (!rs.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map(rectRight)) - x, h: Math.max(...rs.map(rectBottom)) - y };
}

/** Spreads boxes (ideal center c, width w) in a row without overlaps, with minimal total displacement. */
export function spreadRow(items: { c: number; w: number }[], gap: number): number[] {
  interface Cl { idx: number[]; left: number }
  const widthOf = (idx: number[]) => idx.reduce((a, i) => a + items[i].w, 0) + gap * (idx.length - 1);
  const idealLeft = (cl: number[]) => {
    let off = 0, sum = 0;
    for (const i of cl) { sum += items[i].c - items[i].w / 2 - off; off += items[i].w + gap; }
    return sum / cl.length;
  };
  const cls: Cl[] = [];
  items.forEach((it, i) => {
    let cur: Cl = { idx: [i], left: it.c - it.w / 2 };
    for (;;) {
      const prev = cls[cls.length - 1];
      if (!prev || prev.left + widthOf(prev.idx) + gap <= cur.left + 1e-6) break;
      cls.pop();
      const idx = [...prev.idx, ...cur.idx];
      cur = { idx, left: idealLeft(idx) };
    }
    cls.push(cur);
  });
  const out: number[] = [];
  for (const cl of cls) {
    let x = cl.left;
    for (const i of cl.idx) { out[i] = x + items[i].w / 2; x += items[i].w + gap; }
  }
  return out;
}
