// The demo format and its timeline: when each chunk is spoken, when its ops land, its hand-drawn strokes,
// the chapters, and what a demo looks like at any moment. Everything here is a pure function of the demo and
// a time, which is what makes seeking deterministic. No DOM.
import type { Op } from "@grafito/contract";
import { INK } from "./palette";
import { strokeLength } from "./sketch";
import type { Stroke } from "./sketch";

/** A stroke drawn by hand in a demo. `pts` is flat (x0, y0, x1, y1…) in board coordinates, like `Stroke`. */
export interface DemoStroke { id?: string; color?: string; pts: number[] }

export interface DemoChunk {
  at_ms: number;
  text: string;
  ops: Op[];
  /** Starts a chapter with this title. In a demo with no titles at all, every chunk is a chapter. */
  title?: string;
  /**
   * A sketch: strokes that appear one after another while the text is spoken, stay while "Claude reads" them
   * (the simulated latency) and are taken off the board when this chunk's ops land.
   */
  strokes?: DemoStroke[];
}
export type Demo = DemoChunk[];

export const MS_PER_WORD = 440;
const wordsOf = (text: string) => text.trim().split(/\s+/);
export const speakMs = (text: string) => wordsOf(text).length * MS_PER_WORD;
/** deterministic 1.5–3 s latency depending on the chunk index */
export const latencyMs = (i: number) => 1500 + ((i * 7919) % 11) * 150;
/** What plays after the last ops land, before the demo ends. */
export const TAIL_MS = 1500;

/** Demo builder: computes at_ms by accumulating speaking time plus a short pause. */
export function timeline(chunks: Omit<DemoChunk, "at_ms">[], startMs = 600, pauseMs = 800): Demo {
  let t = startMs;
  return chunks.map((c) => {
    const out = { ...c, at_ms: t };
    t += speakMs(c.text) + pauseMs;
    return out;
  });
}

export interface Subtitle { spoken: string[]; current: string; interim?: boolean }

export interface StrokeTiming { stroke: Stroke; from: number; to: number }
export interface ChunkTiming {
  start: number;
  words: string[];
  speakEnd: number;
  /** When the ops land. Never earlier than the chunk before, so ops always land in chunk order. */
  opsAt: number;
  strokes: StrokeTiming[];
}
export interface Chapter {
  index: number;
  title: string;
  /** Where a jump to this chapter lands. The first chapter starts at 0. */
  start: number;
  /** The next chapter's start, or the demo's duration. */
  end: number;
  firstChunk: number;
  lastChunk: number;
}
export interface DemoTimeline {
  demo: Demo;
  duration: number;
  chunks: ChunkTiming[];
  chapters: Chapter[];
}

/** A chapter title made from spoken text: its first words, cut at a word. */
export function shortTitle(text: string, max = 44): string {
  const s = text.trim().replace(/\s+/g, " ");
  if (s.length <= max) return s.replace(/[.,;:]$/, "");
  const cut = s.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return (at > max / 2 ? cut.slice(0, at) : s.slice(0, max)).replace(/[.,;:]$/, "") + "…";
}

/** Strokes share the chunk's speaking time by length, with a short pen lift between them. */
function strokeTimings(c: DemoChunk, i: number, start: number, speakEnd: number): StrokeTiming[] {
  const list = c.strokes ?? [];
  if (!list.length) return [];
  const lens = list.map((s) => Math.max(1, strokeLength(s.pts)));
  const lift = (lens.reduce((a, b) => a + b, 0) / lens.length) * 0.25;
  const total = lens.reduce((a, b) => a + b, 0) + lift * (list.length - 1);
  const span = speakEnd - start;
  let at = 0;
  return list.map((s, k) => {
    const from = start + (span * at) / total;
    at += lens[k];
    const to = start + (span * at) / total;
    at += lift;
    return { stroke: { id: s.id ?? `demo${i}_${k}`, by: "demo", color: s.color ?? INK, pts: s.pts }, from, to };
  });
}

export function demoTimeline(demo: Demo): DemoTimeline {
  let lastOps = 0;
  const chunks = demo.map((c, i): ChunkTiming => {
    const words = wordsOf(c.text);
    const speakEnd = c.at_ms + words.length * MS_PER_WORD;
    const opsAt = Math.max(lastOps, speakEnd + latencyMs(i));
    lastOps = opsAt;
    return { start: c.at_ms, words, speakEnd, opsAt, strokes: strokeTimings(c, i, c.at_ms, speakEnd) };
  });
  const duration = lastOps + TAIL_MS;
  const titled = demo.some((c) => c.title);
  const chapters: Chapter[] = [];
  demo.forEach((c, i) => {
    if (i > 0 && titled && !c.title) { chapters[chapters.length - 1].lastChunk = i; return; }
    chapters.push({ index: chapters.length, title: c.title ?? shortTitle(c.text), start: i === 0 ? 0 : c.at_ms, end: duration, firstChunk: i, lastChunk: i });
  });
  chapters.forEach((ch, k) => { if (k + 1 < chapters.length) ch.end = chapters[k + 1].start; });
  return { demo, duration, chunks, chapters };
}

/** The sketch at one moment: finished strokes, the one being drawn, and the ones Claude is reading. */
export interface SketchFrame {
  strokes: Stroke[];
  draft: Stroke | null;
  reading: string[];
  /** Equal keys mean equal frames. */
  key: string;
}

export interface DemoState {
  t: number;
  /** Index of the chapter playing at `t`; -1 in a demo with no chunks. */
  chapter: number;
  /** How many chunks have their ops on the board: always the first `delivered` ones. */
  delivered: number;
  subtitle: Subtitle;
  /** Equal keys mean equal subtitles. */
  subtitleKey: string;
  sketch: SketchFrame;
}

export const clampTime = (tl: DemoTimeline, t: number) => Math.min(tl.duration, Math.max(0, Number.isFinite(t) ? t : 0));

export function chapterAt(tl: DemoTimeline, t: number): number {
  let at = tl.chapters.length ? 0 : -1;
  for (const ch of tl.chapters) if (ch.start <= t) at = ch.index;
  return at;
}

/** The ops of the first `delivered` chunks: what rebuilds the board of that moment from an empty one. */
export const opsUpTo = (tl: DemoTimeline, delivered: number): Op[] => tl.demo.slice(0, delivered).flatMap((c) => c.ops);

function sketchAt(tl: DemoTimeline, t: number, delivered: number): SketchFrame {
  const strokes: Stroke[] = [];
  const reading: string[] = [];
  let draft: Stroke | null = null;
  for (let i = delivered; i < tl.chunks.length; i++) {
    const c = tl.chunks[i];
    if (c.start > t) break;
    for (const s of c.strokes) {
      if (s.to <= t) {
        strokes.push(s.stroke);
        if (t >= c.speakEnd) reading.push(s.stroke.id);
      } else if (s.from <= t) {
        const n = s.stroke.pts.length / 2;
        const shown = Math.max(1, Math.ceil(n * ((t - s.from) / (s.to - s.from))));
        draft = { ...s.stroke, pts: s.stroke.pts.slice(0, shown * 2) };
      }
    }
  }
  const key = `${delivered}|${strokes.length}|${draft ? `${draft.id}:${draft.pts.length}` : ""}|${reading.length}`;
  return { strokes, draft, reading, key };
}

/** What the demo looks like at `t`: the same answer however `t` was reached. */
export function stateAt(tl: DemoTimeline, time: number): DemoState {
  const t = clampTime(tl, time);
  let delivered = 0, spokenCount = 0, speaking = -1;
  tl.chunks.forEach((c, i) => {
    if (c.opsAt <= t) delivered = i + 1;
    if (c.speakEnd <= t) spokenCount++;
    else if (c.start <= t) speaking = i;
  });
  const sp = speaking < 0 ? null : tl.chunks[speaking];
  const shown = sp ? Math.min(sp.words.length, Math.floor((t - sp.start) / MS_PER_WORD) + 1) : 0;
  const spoken = tl.chunks.filter((c) => c.speakEnd <= t).map((c) => c.words.join(" "));
  return {
    t,
    chapter: chapterAt(tl, t),
    delivered,
    subtitle: { spoken, current: sp ? sp.words.slice(0, shown).join(" ") : "" },
    subtitleKey: `${spokenCount}|${speaking}|${shown}`,
    sketch: sketchAt(tl, t, delivered),
  };
}

/** How far into a chapter "previous" still means "back to the start of this one". */
export const CHAPTER_REWIND_MS = 2000;

/** Where "previous chapter" lands: the start of this chapter, or of the one before when already near its start. */
export function prevChapterTime(tl: DemoTimeline, t: number): number {
  const i = chapterAt(tl, t);
  if (i < 0) return 0;
  const ch = tl.chapters[i];
  return t - ch.start > CHAPTER_REWIND_MS || i === 0 ? ch.start : tl.chapters[i - 1].start;
}

/** Where "next chapter" lands: the next chapter's start, or the end of the demo from the last one. */
export function nextChapterTime(tl: DemoTimeline, t: number): number {
  const i = chapterAt(tl, t);
  return i >= 0 && i + 1 < tl.chapters.length ? tl.chapters[i + 1].start : tl.duration;
}

/** 83000 -> "1:23". */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
