// The browser's end of a room: one WebSocket to the server, kept open across drops. It holds what a room shows
// besides the board (who is here, their cursors, Claude's status, the feed, the shared sketch) and hands the
// room's logged events, in order, to whoever builds the board from them (the room session).
import { CLAUDE_ID, ROOM_CLOSE, ROOM_KEY_PREFIX, ROOM_PROTOCOL, ROOM_RESUME_PREFIX, parseServerMessage } from "@grafito/contract";
import type { ClaudeStatus, ClientMessage, Participant, RoomErrorCode, RoomEvent, ServerMessage, SketchPayload, TurnSettings } from "@grafito/contract";
import type { Stroke } from "@grafito/board";
import type { SketchStore } from "../sketch/store";
import { cleanName, saveName } from "./identity";
import type { Identity } from "./identity";
import { loadResume, saveResume } from "./keep";
import type { Store } from "../storage";

/** The part of a WebSocket the client uses; tests pass a fake. */
export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  /** `code` is the close code; the server's own are in `ROOM_CLOSE`. */
  onclose: ((e?: { code?: number }) => void) | null;
  onerror: (() => void) | null;
}

/**
 * `refused`: the server does not let this browser in (no such room, or the link's invite token is missing or
 * wrong). `full`: the room has all the people it takes. Neither is retried.
 */
export type RoomStatus = "connecting" | "open" | "reconnecting" | "closed" | "refused" | "full";

export interface RoomCursor { id: string; name: string; color: string; x: number; y: number }

/** One line of the feed: something a person said, typed or sketched, something Claude said, or a wipe. */
export interface FeedItem {
  /** The event's `seq`: unique and ordered. */
  id: number;
  kind: "message" | "say" | "reset";
  by: string;
  name: string;
  color: string;
  text: string;
  /** `message` only. */
  mode?: "content" | "instruction" | "sketch";
  at: number;
}

export interface RoomState {
  roomId: string;
  status: RoomStatus;
  /** Null until the first `hello`. */
  me: Participant | null;
  /** Everyone connected, me first. Claude is not in the list: it is always there. */
  participants: Participant[];
  claude: ClaudeStatus;
  /** Other people's pointers on the board. */
  cursors: RoomCursor[];
  feed: FeedItem[];
  createdAt: number | null;
  /** The last error the server sent; "" if none. */
  error: string;
  /** Which limit refused something, when the error is one of those; the UI has a message for each. */
  errorCode: RoomErrorCode | null;
  /** When that error arrived (ms); 0 if none. A new time is a new error, even with the same text. */
  errorAt: number;
}

export interface RoomListener {
  /** The log starts again: on attaching, on every (re)connect. Clear what was built from it; the events follow. */
  restart(): void;
  event(e: RoomEvent): void;
}

export interface RoomClient {
  readonly roomId: string;
  /** The room's invite token, as this browser has it ("" if it was opened without one). */
  readonly token: string;
  readonly identity: Identity;
  getState(): RoomState;
  /** Calls `fn` now and on every change; returns the unsubscribe function. */
  subscribe(fn: (s: RoomState) => void): () => void;
  /** Replays the log so far to `l` (after a `restart`), then feeds it every new event. Returns the detach function. */
  listen(l: RoomListener): () => void;
  /** The room's sketch: the same strokes in every browser. */
  readonly sketch: SketchStore;
  sendText(text: string, mode: "content" | "instruction", settings: TurnSettings): void;
  sendSketch(sketch: SketchPayload, settings: TurnSettings): void;
  /** Throttled; null when the pointer leaves the board. */
  sendCursor(at: { x: number; y: number } | null): void;
  rename(name: string): void;
  /** Wipes the board, the sketch and the log for everyone. */
  reset(): void;
  close(): void;
}

export interface RoomClientOptions {
  roomId: string;
  /** The room's invite token, from the link's `#k=`. */
  token?: string;
  identity: Identity;
  /** Opens the socket, offering `protocols` (default: the browser's WebSocket). */
  socket?: (url: string, protocols: string[]) => WebSocketLike;
  /** Where the resume secret the server gives this tab is kept (default: sessionStorage). */
  resumeStore?: Store;
  /** Where the name is kept, so a rename survives a reload (default: localStorage). */
  nameStore?: Store;
  /** `ws://host` the room lives at (default: this page's host). */
  base?: string;
  /** First reconnect delay; it doubles up to `maxBackoffMs`. */
  backoffMs?: number;
  maxBackoffMs?: number;
  cursorThrottleMs?: number;
}

export const CLAUDE_COLOR = "#2A2A2E";
const UNKNOWN_COLOR = "#7A7A80";
const FEED_MAX = 300;
const OUTBOX_MAX = 200;

const defaultBase = () => (typeof location === "undefined" ? "ws://localhost" : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

export function createRoomClient(o: RoomClientOptions): RoomClient {
  const open = o.socket ?? ((url: string, protocols: string[]) => new WebSocket(url, protocols) as unknown as WebSocketLike);
  const token = o.token ?? "";
  /** What the server gave this tab to come back as the same participant; "" the first time. */
  let resume = loadResume(o.roomId, o.resumeStore);
  const firstBackoff = o.backoffMs ?? 500, maxBackoff = o.maxBackoffMs ?? 8000, cursorEvery = o.cursorThrottleMs ?? 50;
  const identity: Identity = { ...o.identity };

  let status: RoomStatus = "connecting";
  let me: Participant | null = null;
  let people: Participant[] = [];
  let claude: ClaudeStatus = "idle";
  let createdAt: number | null = null;
  let error = "";
  let errorCode: RoomErrorCode | null = null;
  let errorAt = 0;
  let feed: FeedItem[] = [];
  /** The log since the last reset (or the room's start), as the server sent it. */
  let events: RoomEvent[] = [];
  const cursors = new Map<string, { x: number; y: number }>();
  /** Every colour seen, so the feed can tint someone who already left. */
  const colors = new Map<string, string>();

  // sketch
  let strokes: Stroke[] = [];
  let drafts: Stroke[] = [];
  /** Strokes added here that the server has not echoed yet. */
  const unsent = new Map<string, Stroke>();
  const sketchListeners = new Set<() => void>();
  const emitSketch = () => sketchListeners.forEach((f) => f());

  let ws: WebSocketLike | null = null;
  let ready = false; // hello received on the current socket
  let closed = false;
  let backoff = firstBackoff;
  let retry: ReturnType<typeof setTimeout> | undefined;
  /** Messages that must not be lost while the socket is down. */
  let outbox: ClientMessage[] = [];

  const stateListeners = new Set<(s: RoomState) => void>();
  const logListeners = new Set<RoomListener>();
  let cached: RoomState | null = null;

  const state = (): RoomState => {
    if (cached) return cached;
    const others = people.filter((p) => p.id !== me?.id);
    cached = {
      roomId: o.roomId, status, me, participants: me ? [me, ...others] : others, claude, createdAt, error, errorCode, errorAt, feed,
      cursors: others.flatMap((p) => { const c = cursors.get(p.id); return c ? [{ id: p.id, name: p.name, color: p.color, ...c }] : []; }),
    };
    return cached;
  };
  const emit = () => { cached = null; const s = state(); stateListeners.forEach((f) => f(s)); };

  const setPeople = (list: Participant[]) => {
    people = list.filter((p) => p.id !== CLAUDE_ID);
    for (const p of people) colors.set(p.id, p.color);
    me = people.find((p) => p.id === identity.id) ?? me;
    const here = new Set(people.map((p) => p.id));
    for (const id of [...cursors.keys()]) if (!here.has(id)) cursors.delete(id);
    const before = drafts.length;
    drafts = drafts.filter((d) => here.has(d.by));
    if (drafts.length !== before) emitSketch();
  };

  const nameOf = (id: string, fallback = "") => (id === CLAUDE_ID ? "Claude" : people.find((p) => p.id === id)?.name ?? fallback);
  const colorOf = (id: string) => (id === CLAUDE_ID ? CLAUDE_COLOR : colors.get(id) ?? UNKNOWN_COLOR);
  const pushFeed = (item: FeedItem) => { feed = [...feed, item].slice(-FEED_MAX); };

  /** Folds one logged event into the feed and the sketch. Returns whether the sketch changed. */
  function fold(e: RoomEvent): boolean {
    switch (e.type) {
      case "message":
        pushFeed({ id: e.seq, kind: "message", by: e.by, name: e.name, color: colorOf(e.by), text: e.text, mode: e.mode, at: e.at });
        return false;
      case "say":
        pushFeed({ id: e.seq, kind: "say", by: CLAUDE_ID, name: "Claude", color: CLAUDE_COLOR, text: e.text, at: e.at });
        return false;
      case "stroke": {
        unsent.delete(e.stroke.id);
        const hadDraft = drafts.some((d) => d.by === e.stroke.by);
        if (hadDraft) drafts = drafts.filter((d) => d.by !== e.stroke.by);
        if (strokes.some((s) => s.id === e.stroke.id)) return hadDraft;
        strokes = [...strokes, e.stroke];
        return true;
      }
      case "erase": {
        const gone = new Set(e.ids);
        for (const id of e.ids) unsent.delete(id);
        const next = strokes.filter((s) => !gone.has(s.id));
        if (next.length === strokes.length) return false;
        strokes = next;
        return true;
      }
      case "reset": {
        // the log starts again from here
        events = [];
        feed = [];
        unsent.clear();
        const had = strokes.length + drafts.length > 0;
        strokes = []; drafts = [];
        pushFeed({ id: e.seq, kind: "reset", by: e.by, name: nameOf(e.by), color: colorOf(e.by), text: "", at: e.at });
        return had;
      }
      default:
        return false;
    }
  }

  function take(e: RoomEvent) {
    const sketchChanged = fold(e);
    events.push(e);
    logListeners.forEach((l) => l.event(e));
    if (sketchChanged) emitSketch();
  }

  function onHello(m: Extract<ServerMessage, { t: "hello" }>) {
    ready = true;
    backoff = firstBackoff;
    status = "open";
    error = ""; errorCode = null; errorAt = 0;
    me = m.you;
    // The server says who this connection is. Its secret is kept so the next connection is the same person.
    identity.id = m.you.id;
    identity.name = m.you.name;
    if (m.resume) { resume = m.resume; saveResume(o.roomId, m.resume, o.resumeStore); }
    createdAt = m.room.createdAt;
    claude = m.claude;
    setPeople(m.participants);
    colors.set(m.you.id, m.you.color);
    // Rebuild everything from the log; strokes drawn here that it does not have yet are kept and sent again.
    const mine = [...unsent.values()];
    events = []; feed = []; strokes = []; drafts = []; cursors.clear();
    logListeners.forEach((l) => l.restart());
    for (const e of m.events) { fold(e); events.push(e); logListeners.forEach((l) => l.event(e)); }
    for (const s of mine) {
      if (strokes.some((x) => x.id === s.id)) continue;
      unsent.set(s.id, s);
      strokes = [...strokes, s];
      raw({ t: "stroke", stroke: s });
    }
    for (const msg of outbox.splice(0)) raw(msg);
    emitSketch();
    emit();
  }

  function onMessage(data: unknown) {
    let json: unknown;
    try { json = JSON.parse(String(data)); } catch { return; }
    const p = parseServerMessage(json);
    if (!p.ok) return;
    const m = p.message;
    switch (m.t) {
      case "hello": return onHello(m);
      case "event": take(m.event); return emit();
      case "presence": setPeople(m.participants); return emit();
      case "cursor":
        if (m.id === identity.id) return;
        if (m.at) cursors.set(m.id, m.at); else cursors.delete(m.id);
        return emit();
      case "draft":
        if (m.id === identity.id) return;
        drafts = drafts.filter((d) => d.by !== m.id);
        if (m.stroke) drafts = [...drafts, { ...m.stroke, by: m.id }];
        return emitSketch();
      case "claude": claude = m.status; return emit();
      case "error": error = m.message; errorCode = m.code ?? null; errorAt = Date.now(); return emit();
    }
  }

  const raw = (m: ClientMessage) => { try { ws?.send(JSON.stringify(m)); } catch { /* the close handler reconnects */ } };
  /** Sends now, or once the socket is back. */
  const send = (m: ClientMessage) => {
    if (ready) raw(m);
    else if (!closed) outbox = [...outbox, m].slice(-OUTBOX_MAX);
  };
  /** Sends only if connected: for what is stale a moment later (cursor, draft). */
  const sendNow = (m: ClientMessage) => { if (ready) raw(m); };

  function connect() {
    if (closed) return;
    const url = `${o.base ?? defaultBase()}/api/rooms/${o.roomId}/ws?name=${encodeURIComponent(identity.name)}`;
    // The secrets go as subprotocols, not in the URL: URLs end up in logs, this header does not.
    const sock = open(url, [ROOM_PROTOCOL, ...(token ? [ROOM_KEY_PREFIX + token] : []), ...(resume ? [ROOM_RESUME_PREFIX + resume] : [])]);
    ws = sock;
    sock.onmessage = (e) => { if (ws === sock) onMessage(e.data); };
    sock.onopen = () => { /* the server speaks first: hello */ };
    sock.onerror = () => { /* onclose follows */ };
    sock.onclose = (e) => {
      if (ws !== sock) return;
      ws = null;
      ready = false;
      if (closed) return;
      // The server said no, and will say no again: stop here instead of knocking forever.
      if (e?.code === ROOM_CLOSE.refused || e?.code === ROOM_CLOSE.full) {
        closed = true;
        status = e.code === ROOM_CLOSE.full ? "full" : "refused";
        claude = "idle";
        cursors.clear();
        outbox = [];
        drafts = [];
        emitSketch();
        return emit();
      }
      status = "reconnecting";
      claude = "idle";
      cursors.clear();
      if (drafts.length) { drafts = []; emitSketch(); }
      emit();
      retry = setTimeout(connect, backoff);
      backoff = Math.min(maxBackoff, backoff * 2);
    };
  }

  // cursor: at most one message per `cursorEvery` ms, always ending on the latest position
  let cursorAt = 0;
  let cursorNext: { x: number; y: number } | null | undefined;
  let cursorTimer: ReturnType<typeof setTimeout> | undefined;
  const flushCursor = () => {
    cursorTimer = undefined;
    if (cursorNext === undefined) return;
    const at = cursorNext;
    cursorNext = undefined;
    cursorAt = Date.now();
    sendNow({ t: "cursor", at: at && { x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10 } });
  };

  const sketch: SketchStore = {
    strokes: () => strokes,
    drafts: () => drafts,
    add(stroke) {
      if (strokes.some((s) => s.id === stroke.id)) return;
      const s = { ...stroke, by: identity.id };
      strokes = [...strokes, s];
      unsent.set(s.id, s);
      sendNow({ t: "stroke", stroke: s }); // while offline it stays in `unsent` and goes out after the next hello
      emitSketch();
    },
    remove(ids) {
      const gone = new Set(ids);
      const next = strokes.filter((s) => !gone.has(s.id));
      if (next.length === strokes.length) return;
      strokes = next;
      for (const id of ids) unsent.delete(id);
      // the server ignores ids it never had
      send({ t: "erase", ids: [...ids] });
      emitSketch();
    },
    draft(stroke) { sendNow({ t: "draft", stroke: stroke && { ...stroke, by: identity.id } }); },
    subscribe(fn) { sketchListeners.add(fn); return () => { sketchListeners.delete(fn); }; },
  };

  connect();

  return {
    roomId: o.roomId,
    token,
    identity,
    getState: state,
    subscribe(fn) { stateListeners.add(fn); fn(state()); return () => { stateListeners.delete(fn); }; },
    listen(l) {
      l.restart();
      for (const e of [...events]) l.event(e);
      logListeners.add(l);
      return () => { logListeners.delete(l); };
    },
    sketch,
    sendText(text, mode, settings) { const s = text.trim(); if (s) send({ t: "text", text: s, mode, settings }); },
    sendSketch(payload, settings) { send({ t: "sketch", sketch: payload, settings }); },
    sendCursor(at) {
      cursorNext = at;
      if (cursorTimer) return;
      const wait = cursorEvery - (Date.now() - cursorAt);
      if (wait <= 0) flushCursor(); else cursorTimer = setTimeout(flushCursor, wait);
    },
    rename(name) {
      const n = cleanName(name);
      if (!n || n === identity.name) return;
      identity.name = n;
      // kept, or a reload would join under the old name
      saveName(n, o.nameStore);
      if (me) { me = { ...me, name: n }; people = people.map((p) => (p.id === me!.id ? me! : p)); }
      send({ t: "rename", name: n });
      emit();
    },
    reset() { send({ t: "reset" }); },
    close() {
      const ended = status === "refused" || status === "full";
      closed = true;
      clearTimeout(retry);
      clearTimeout(cursorTimer);
      outbox = [];
      if (!ended) status = "closed";
      const sock = ws;
      ws = null;
      ready = false;
      try { sock?.close(); } catch { /* already gone */ }
      emit();
    },
  };
}
