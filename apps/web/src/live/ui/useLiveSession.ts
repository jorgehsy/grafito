import { useEffect, useMemo, useRef, useState } from "react";
import { createLiveSession } from "../session";
import type { LiveSession, LiveSessionDeps, LiveSessionState, Settings } from "../session";
import { browserStore } from "../../storage";
import type { SketchStore } from "../../sketch/store";

/** Makes the session the panel talks to: live mode's own, or one that speaks to a room. */
export type SessionFactory = (deps: LiveSessionDeps) => LiveSession;

/**
 * One session for as long as `create` stays the same; deps are read through a ref, so they may change every
 * render. A new `create` (say, joining a room) stops the old session and starts a new one.
 */
export function useLiveSession(
  board: LiveSessionDeps["board"],
  settings: Settings,
  apply: LiveSessionDeps["settings"]["apply"],
  sketch?: SketchStore,
  create: SessionFactory = createLiveSession,
): [LiveSession, LiveSessionState] {
  const deps = useRef({ board, settings, apply, sketch });
  deps.current = { board, settings, apply, sketch };
  const session = useMemo(
    () =>
      create({
        board: { get: () => deps.current.board.get(), submit: (ops) => deps.current.board.submit(ops), clear: () => deps.current.board.clear() },
        settings: { get: () => deps.current.settings, apply: (s) => deps.current.apply(s) },
        storage: browserStore,
        // read through the ref on every call: the store may change (a room brings its own)
        sketch: {
          strokes: () => deps.current.sketch?.strokes() ?? [],
          drafts: () => deps.current.sketch?.drafts() ?? [],
          add: (s) => deps.current.sketch?.add(s),
          remove: (ids) => deps.current.sketch?.remove(ids),
          draft: (s) => deps.current.sketch?.draft(s),
          subscribe: (fn) => deps.current.sketch?.subscribe(fn) ?? (() => {}),
        },
      }),
    [create],
  );
  const [state, setState] = useState<LiveSessionState>(() => {
    let first!: LiveSessionState;
    session.subscribe((s) => (first = s))();
    return first;
  });
  useEffect(() => {
    const off = session.subscribe(setState);
    return () => { off(); session.stop(); };
  }, [session]);
  return [session, state];
}
