import { useEffect, useMemo, useRef, useState } from "react";
import { createLiveSession } from "../session";
import type { LiveSession, LiveSessionDeps, LiveSessionState, Settings } from "../session";
import { browserStore } from "../../storage";

/** One live session for the component's lifetime; deps are read through a ref, so they may change every render. */
export function useLiveSession(board: LiveSessionDeps["board"], settings: Settings, apply: LiveSessionDeps["settings"]["apply"]): [LiveSession, LiveSessionState] {
  const deps = useRef({ board, settings, apply });
  deps.current = { board, settings, apply };
  const session = useMemo(
    () =>
      createLiveSession({
        board: { get: () => deps.current.board.get(), submit: (ops) => deps.current.board.submit(ops), clear: () => deps.current.board.clear() },
        settings: { get: () => deps.current.settings, apply: (s) => deps.current.apply(s) },
        storage: browserStore,
      }),
    [],
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
