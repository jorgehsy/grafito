// The drawing flow: which tool is in hand, which strokes still wait for Claude, and when they are handed in.
import { useCallback, useEffect, useRef, useState } from "react";
import { describeSketch, sketchBounds } from "@grafito/board";
import type { Board, BoardLayout, Rect, Stroke } from "@grafito/board";
import type { Engine, Tool } from "../render/engine";
import type { LiveSession } from "../live/session";
import type { SketchStore } from "./store";
import { readFlag, writeFlag } from "../storage";

/** The inks on offer; the first is the default. */
export const INKS = [
  { id: "graphite", color: "#2A2A2E" },
  { id: "blue", color: "#3E5E8C" },
  { id: "red", color: "#C03A3A" },
  { id: "green", color: "#3E8C4F" },
] as const;

/** With auto on, the sketch is handed in this long after the last stroke ends. */
export const AUTO_READ_MS = 2200;
/** How much of the board around the ink goes into the picture, so nearby elements are in it. */
const PICTURE_PAD = 260;
const PICTURE_MIN = 640;
const AUTO_KEY = "grafito.draw.auto";

/** The region of the board pictured for a sketch: the ink, padded, never smaller than a minimum. */
export function pictureRegion(ink: Rect): Rect {
  const w = Math.max(PICTURE_MIN, ink.w + 2 * PICTURE_PAD), h = Math.max(PICTURE_MIN * 0.7, ink.h + 2 * PICTURE_PAD);
  return { x: ink.x + ink.w / 2 - w / 2, y: ink.y + ink.h / 2 - h / 2, w, h };
}

/** The strokes of `author` that have not been handed to Claude yet (nor left as plain ink). */
export function pendingStrokes(strokes: readonly Stroke[], author: string, handled: ReadonlySet<string>): Stroke[] {
  return strokes.filter((s) => s.by === author && !handled.has(s.id));
}

export interface SketchDeps {
  /** Drawing is on (live mode, or a room). Off: the tool goes back to the hand. */
  enabled: boolean;
  getEngine(): Engine | null;
  store: SketchStore;
  session: Pick<LiveSession, "sendSketch">;
  /** The board and its layout now: what the sketch is described against. */
  getBoard(): { board: Board; layout: BoardLayout | undefined } | null;
  /** This person's participant id; their strokes are the ones this browser hands in. */
  author?: string;
  /** Ink colour to start with (a room gives each person theirs). */
  color?: string;
}

export interface SketchControl {
  tool: Tool;
  setTool(t: Tool): void;
  color: string;
  setColor(c: string): void;
  auto: boolean;
  setAuto(v: boolean): void;
  /** Strokes of mine waiting to be read. */
  pending: number;
  /** Strokes of mine on the board. */
  mine: number;
  /** Claude is reading the sketch. */
  reading: boolean;
  /** When the auto read fires (performance.now() time); null when none is scheduled. */
  dueAt: number | null;
  /** Claude read the last sketch and left it as plain ink; clears itself after a moment. */
  kept: boolean;
  /** Hands the pending strokes to Claude now. */
  read(): void;
  /** Removes my last stroke. */
  undo(): void;
  /** Removes all my ink. */
  clear(): void;
}

export function useSketch(d: SketchDeps): SketchControl {
  const author = d.author ?? "me";
  const [tool, setToolState] = useState<Tool>("pan");
  const [color, setColor] = useState<string>(d.color ?? INKS[0].color);
  const [auto, setAuto] = useState(() => readFlag(AUTO_KEY, true));
  const [drawing, setDrawing] = useState(false);
  const [reading, setReading] = useState(false);
  const [kept, setKept] = useState(false);
  const [dueAt, setDueAt] = useState<number | null>(null);
  const [, bump] = useState(0);
  // Strokes already handed in (Claude took them or left them as ink): never sent again.
  const handled = useRef(new Set<string>());
  const deps = useRef(d);
  deps.current = d;
  const busy = useRef(false);

  useEffect(() => d.store.subscribe(() => bump((n) => n + 1)), [d.store]);
  useEffect(() => { if (d.color) setColor(d.color); }, [d.color]);
  useEffect(() => writeFlag(AUTO_KEY, auto), [auto]);

  const strokes = d.store.strokes();
  const mine = strokes.filter((s) => s.by === author);
  const pending = pendingStrokes(strokes, author, handled.current);
  const pendingKey = pending.map((s) => s.id).join(",");

  const setTool = useCallback((t: Tool) => setToolState(t), []);
  const active: Tool = d.enabled ? tool : "pan";
  useEffect(() => {
    const e = d.getEngine();
    if (!e) return;
    e.setTool(active);
    e.penColor = color;
    e.author = author;
    e.onDrawing = setDrawing;
    return () => { e.onDrawing = undefined; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the engine is created once, before this hook's first effect
  }, [active, color, author]);
  // leaving drawing behind puts the hand back
  const enabled = d.enabled;
  useEffect(() => { if (!enabled) { setToolState("pan"); deps.current.getEngine()?.setReading([]); } }, [enabled]);

  const read = useCallback(async () => {
    const { store, session, getEngine, getBoard } = deps.current;
    const who = deps.current.author ?? "me";
    const batch = pendingStrokes(store.strokes(), who, handled.current);
    if (busy.current || !batch.length || !deps.current.enabled) return;
    busy.current = true;
    setReading(true);
    setKept(false);
    setDueAt(null);
    const ids = batch.map((s) => s.id);
    // handed in from now on: a stroke drawn meanwhile waits for the next round
    ids.forEach((id) => handled.current.add(id));
    let drew = false;
    try {
      const engine = getEngine();
      const b = getBoard();
      const hints = describeSketch(batch, b?.board ?? { zones: [], elements: [], groups: [], connections: [], emphasis: [], questions: [], callouts: [], proposals: [], summary: "", zoneCounter: 0 }, b?.layout);
      const ink = sketchBounds(batch);
      const image = ink && engine ? await engine.exportPng(pictureRegion(ink)) : null;
      engine?.setReading(ids);
      drew = await session.sendSketch({ strokeIds: ids, hints, ...(image ? { image } : {}) });
    } catch { /* the request reports its own error; the ink stays */ }
    deps.current.getEngine()?.setReading([]);
    busy.current = false;
    setReading(false);
    if (!drew) setKept(true);
  }, []);

  // Auto: a moment after the last stroke ends, with nobody mid-stroke and no read in flight.
  useEffect(() => {
    if (!d.enabled || !auto || drawing || reading || !pendingKey) { setDueAt(null); return; }
    setDueAt(performance.now() + AUTO_READ_MS);
    const timer = setTimeout(() => void read(), AUTO_READ_MS);
    return () => clearTimeout(timer);
  }, [d.enabled, auto, drawing, reading, pendingKey, read]);

  useEffect(() => {
    if (!kept) return;
    const timer = setTimeout(() => setKept(false), 3500);
    return () => clearTimeout(timer);
  }, [kept]);

  const undo = useCallback(() => {
    const { store } = deps.current;
    const who = deps.current.author ?? "me";
    const last = [...store.strokes()].reverse().find((s) => s.by === who);
    if (last) store.remove([last.id]);
  }, []);
  const clear = useCallback(() => {
    const { store } = deps.current;
    const who = deps.current.author ?? "me";
    const ids = store.strokes().filter((s) => s.by === who).map((s) => s.id);
    if (ids.length) store.remove(ids);
  }, []);

  // Shortcuts: V hand, P pen, E eraser, Enter reads (pen in hand), Escape back to the hand, Ctrl/Cmd+Z my last stroke.
  const keys = useRef({ tool: active, mine: mine.length, read, undo });
  keys.current = { tool: active, mine: mine.length, read, undo };
  useEffect(() => {
    if (!d.enabled) return;
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === "KeyZ") {
        if (!keys.current.mine) return;
        e.preventDefault();
        keys.current.undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.code === "KeyV" || e.code === "KeyH" || e.code === "Escape") setToolState("pan");
      else if (e.code === "KeyP" || e.code === "KeyD") setToolState("pen");
      else if (e.code === "KeyE") setToolState("eraser");
      else if (e.code === "Enter" && keys.current.tool === "pen" && el?.tagName !== "BUTTON") { e.preventDefault(); void keys.current.read(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [d.enabled]);

  return {
    tool: active, setTool, color, setColor, auto, setAuto,
    pending: pending.length, mine: mine.length, reading, dueAt, kept,
    read: () => void read(), undo, clear,
  };
}
