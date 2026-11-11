// Where the sketch lives in the browser. Alone, it is a local list; in a room, the room keeps it and every
// browser sees the same strokes. The engine draws whatever the store holds.
import type { Stroke } from "@grafito/board";

export interface SketchStore {
  /** Finished strokes, in the order they were drawn. */
  strokes(): readonly Stroke[];
  /** Strokes other people are drawing right now (rooms only). */
  drafts(): readonly Stroke[];
  add(stroke: Stroke): void;
  remove(ids: readonly string[]): void;
  /** The stroke this person is drawing right now, so a room can show it growing; null when it ends. */
  draft(stroke: Stroke | null): void;
  /** Calls `fn` on every change; returns the unsubscribe function. */
  subscribe(fn: () => void): () => void;
}

/** The sketch of someone working alone: kept in memory, gone with the page. */
export function createLocalSketchStore(): SketchStore {
  let list: Stroke[] = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((f) => f());
  return {
    strokes: () => list,
    drafts: () => [],
    add(stroke) { list = [...list, stroke]; emit(); },
    remove(ids) {
      const gone = new Set(ids);
      const next = list.filter((s) => !gone.has(s.id));
      if (next.length !== list.length) { list = next; emit(); }
    },
    draft() { /* nobody else to show it to */ },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}
