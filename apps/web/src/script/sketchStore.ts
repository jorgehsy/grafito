// The sketch a demo draws: a read-only store the player fills frame by frame. The engine renders it like any
// other sketch (finished strokes as ink, the one being drawn as a draft).
import type { SketchFrame, Stroke } from "@grafito/board";
import type { SketchStore } from "../sketch/store";

export interface ScriptSketch extends SketchStore {
  /** Shows this frame; an unchanged frame is ignored. */
  show(frame: SketchFrame | null): void;
}

export function createScriptSketch(): ScriptSketch {
  let done: readonly Stroke[] = [];
  let drafts: readonly Stroke[] = [];
  let key = "";
  const listeners = new Set<() => void>();
  return {
    strokes: () => done,
    drafts: () => drafts,
    // Nobody draws on a demo: the pen and the eraser leave it as it is.
    add() {},
    remove() {},
    draft() {},
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    show(frame) {
      const next = frame?.key ?? "";
      if (next === key) return;
      key = next;
      done = frame?.strokes ?? [];
      drafts = frame?.draft ? [frame.draft] : [];
      listeners.forEach((f) => f());
    },
  };
}
