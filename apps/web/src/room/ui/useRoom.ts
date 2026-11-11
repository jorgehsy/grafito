import { useCallback, useEffect, useRef, useState } from "react";
import { createRoomClient } from "../client";
import type { RoomClient, RoomCursor, RoomState } from "../client";
import { loadIdentity, saveName } from "../identity";
import { takeRoomKey } from "../start";

/** What a room needs from the canvas: where my pointer is, and a place to show everyone else's. */
export interface RoomCanvas {
  /** `fn` gets the pointer in board coordinates, null when it leaves the board; null stops the reports. */
  onPointer(fn: ((at: { x: number; y: number } | null) => void) | null): void;
  setCursors(list: RoomCursor[]): void;
}

export interface RoomHandle {
  /** Null outside a room, and in one until the person has a name. */
  client: RoomClient | null;
  state: RoomState | null;
  /** In a room, but nobody has typed a name in this browser yet: show the join dialog. */
  needsName: boolean;
  join(name: string): void;
}

/**
 * One room client for as long as `roomId` stays the same. Other people's cursors go to the canvas and this
 * person's pointer goes to the room. `canvas` may arrive late (the engine mounts after the first render).
 */
export function useRoom(roomId: string | null, canvas: RoomCanvas | null): RoomHandle {
  const [name, setName] = useState(() => loadIdentity().name);
  // The invite token arrives in the link's fragment (`#k=`), which only this page ever sees. It is read once,
  // kept for this tab and taken off the address bar; a reload finds it in the tab's storage.
  const [token] = useState(() => (roomId ? takeRoomKey(roomId) : ""));
  const [client, setClient] = useState<RoomClient | null>(null);
  const [state, setState] = useState<RoomState | null>(null);
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;
  const hasName = !!name;

  useEffect(() => {
    if (!roomId || !hasName) return;
    const c = createRoomClient({ roomId, token, identity: loadIdentity() });
    setClient(c);
    const off = c.subscribe(setState);
    return () => { off(); c.close(); setClient(null); setState(null); };
  }, [roomId, hasName, token]);

  const hasCanvas = !!canvas;
  useEffect(() => {
    if (!client || !hasCanvas) return;
    canvasRef.current?.onPointer((at) => client.sendCursor(at));
    const off = client.subscribe((s) => canvasRef.current?.setCursors(s.cursors));
    return () => { off(); canvasRef.current?.onPointer(null); canvasRef.current?.setCursors([]); };
  }, [client, hasCanvas]);

  const join = useCallback((n: string) => { const saved = saveName(n); if (saved) setName(saved); }, []);

  return { client, state, needsName: !!roomId && !hasName, join };
}
