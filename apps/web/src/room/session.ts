// A room seen as a live session, so the live panel drives a shared board exactly like a solo one. The difference
// is who does the work: here the server keeps the log and calls Claude, and this session only sends what the
// person says or sketches and builds the board, the request log and the transcript from the room's events.
import { CLAUDE_ID, PROMPT_VERSION, addUsage, parseOp, RECORD_VERSION, zeroUsage } from "@grafito/contract";
import type { LiveRecord, Op, RoomEvent, SketchPayload, TurnSettings } from "@grafito/contract";
import { CATALOG_IDS } from "@grafito/icons";
import { splitInstruction } from "../live/instruction";
import { createGrouper } from "../live/speech/grouper";
import type { LiveSession, LiveSessionDeps, LiveSessionState, LogEntry, Settings, Totals } from "../live/session";
import { t } from "../i18n";
import type { RoomClient } from "./client";

export type RoomSessionDeps = Pick<LiveSessionDeps, "board" | "settings">;

/** A sketch handed in and not answered yet. */
interface PendingSketch {
  ids: Set<string>;
  /** The request that carries it, once the server starts it. */
  request: number | null;
  /** The room took it: its message is in the log. Until then the server may still refuse it. */
  accepted: boolean;
  resolve(drew: boolean): void;
  timer: ReturnType<typeof setTimeout>;
}

/** The request number of the ops a room was made with, and the model its entry names: nobody was asked. */
export const SEED_REQUEST = 0;
export const SEED_MODEL = "seed";

/** Give up waiting for a sketch's answer after this long (the room may have dropped it). */
export const SKETCH_TIMEOUT_MS = 120_000;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export const turnSettings = (s: Settings): TurnSettings => ({ model: s.model, shape: s.shape, catalogs: s.catalogs, lang: s.speechLang });

export function createRoomSession(client: RoomClient, d: RoomSessionDeps): LiveSession {
  const zeroTotals = (): Totals => ({ requests: 0, usage: zeroUsage(), costUsd: 0 });
  let entries: LogEntry[] = [];
  let current: LogEntry | null = null;
  let totals = zeroTotals();
  let transcript: { text: string; at: number }[] = [];
  let warning = "";
  let startedAt = Date.now();
  let stopped = false;
  const listeners = new Set<(s: LiveSessionState) => void>();

  // Sketches go to Claude one at a time and in the order their messages were logged, so the k-th sketch
  // message is the k-th sketch request: that is how a request is matched to the person who handed it in.
  let sketchAuthors: string[] = [];
  let pendingSketches: PendingSketch[] = [];

  // Ops are submitted in one go per tick: a replayed log reaches the board as one batch.
  let opBuffer: Op[] = [];
  let flushing = false;
  const flushOps = () => {
    flushing = false;
    if (!opBuffer.length) return;
    const ops = opBuffer;
    opBuffer = [];
    void d.board.submit(ops);
  };
  const submit = (o: Op) => {
    opBuffer.push(o);
    if (!flushing) { flushing = true; queueMicrotask(flushOps); }
  };

  const state = (): LiveSessionState => ({
    entries: [...entries], current, totals: { ...totals }, busy: !!current, transcript,
    canUndo: false,
    medianVoiceFirstMs: median(entries.filter((e) => e.voiceFirstMs !== null).map((e) => e.voiceFirstMs as number)),
    unclosed: null, savedAt: null, warning,
  });
  const emit = () => { const s = state(); listeners.forEach((f) => f(s)); };

  const settle = (p: PendingSketch, drew: boolean) => {
    clearTimeout(p.timer);
    pendingSketches = pendingSketches.filter((x) => x !== p);
    p.resolve(drew);
  };

  const clearAll = () => {
    opBuffer = [];
    d.board.clear();
    entries = []; current = null; totals = zeroTotals(); transcript = [];
    sketchAuthors = [];
    for (const p of [...pendingSketches]) settle(p, false);
  };

  const entryOf = (n: number) => entries.find((e) => e.id === n);
  const myId = () => client.identity.id;

  function onEvent(e: RoomEvent) {
    switch (e.type) {
      case "message":
        if (e.mode === "sketch") {
          sketchAuthors.push(e.by);
          if (e.by === myId()) { const mine = pendingSketches.find((p) => !p.accepted); if (mine) mine.accepted = true; }
        }
        if (e.text.trim()) transcript = [...transcript, { text: e.by === myId() ? e.text : `${e.name}: ${e.text}`, at: e.at }];
        break;
      case "request": {
        const entry: LogEntry = {
          id: e.n, model: e.model, promptVersion: e.promptVersion, batch: e.batch, mode: e.mode, startedAt: e.at,
          firstOpMs: null, voiceFirstMs: null, totalMs: null, ops: 0, opList: [], usage: zeroUsage(), usageEstimated: false, costUsd: 0, warnings: [], done: false,
        };
        entries.push(entry);
        current = entry;
        if (e.mode === "sketch" && sketchAuthors.shift() === myId()) {
          const mine = pendingSketches.find((p) => p.request === null);
          if (mine) mine.request = e.n;
        }
        break;
      }
      case "op": {
        const p = parseOp(e.op, CATALOG_IDS, "room");
        // Request 0 is the board the room was made from, which no request event announces. It gets an entry
        // like any other, already done, so an export carries those ops and can be made before Claude draws.
        if (e.request === SEED_REQUEST && !entryOf(SEED_REQUEST)) {
          entries.push({
            id: SEED_REQUEST, model: SEED_MODEL, promptVersion: PROMPT_VERSION, batch: "", mode: "content", startedAt: e.at,
            firstOpMs: 0, voiceFirstMs: null, totalMs: 0, ops: 0, opList: [], usage: zeroUsage(), usageEstimated: false, costUsd: 0, warnings: [], done: true,
          });
        }
        const entry = entryOf(e.request);
        if (!p.ok) { entry?.warnings.push(p.error); break; }
        if (entry) {
          if (entry.firstOpMs === null) entry.firstOpMs = Math.max(0, e.at - entry.startedAt);
          entry.ops++;
          entry.opList.push(p.op);
        }
        // `say` is Claude talking to the room: the feed shows it, the board never gets it.
        if (p.op.name !== "say") submit(p.op);
        break;
      }
      case "erase":
        if (e.by !== CLAUDE_ID) break;
        for (const p of [...pendingSketches]) if (e.ids.some((id) => p.ids.has(id))) settle(p, true);
        break;
      case "request_end": {
        const entry = entryOf(e.n);
        if (entry) {
          entry.firstOpMs = e.firstOpMs ?? entry.firstOpMs;
          entry.totalMs = e.totalMs;
          entry.usage = { ...e.usage };
          entry.costUsd = e.costUsd;
          entry.warnings.push(...e.warnings);
          if (e.error) entry.error = e.error;
          entry.done = true;
          totals = { requests: totals.requests + 1, usage: addUsage(totals.usage, entry.usage), costUsd: totals.costUsd + (e.costUsd ?? 0) };
        }
        if (current?.id === e.n) current = null;
        for (const p of [...pendingSketches]) if (p.request === e.n) settle(p, false);
        break;
      }
      case "reset":
        clearAll();
        startedAt = e.at;
        break;
      case "say":
      case "stroke":
        break;
    }
    emit();
  }

  // When the server refuses a sketch (the room's cap, Claude busy, too fast) it answers with an error and
  // logs nothing, so no event will ever settle it. An error that arrives while a sketch is still waiting to
  // be taken settles it: nothing was drawn. A sketch already in the log is left to its request.
  let seenErrorAt = client.getState().errorAt;
  const offErrors = client.subscribe((s) => {
    if (s.errorAt === seenErrorAt) return;
    seenErrorAt = s.errorAt;
    // too much ink is about a stroke, not about a sketch handed in
    if (!s.errorAt || s.errorCode === "ink") return;
    for (const p of [...pendingSketches]) if (!p.accepted && p.request === null) settle(p, false);
  });

  // Attached a tick later: the session is made while React renders, and a replay clears the board.
  let detach: (() => void) | null = null;
  queueMicrotask(() => {
    if (stopped) return;
    detach = client.listen({ restart() { clearAll(); emit(); }, event: onEvent });
  });

  const grouper = createGrouper((text) => {
    const settings = turnSettings(d.settings.get());
    // Content goes first and the instruction after, always separately.
    const { content, instruction } = splitInstruction(text);
    if (content) client.sendText(content, "content", settings);
    if (instruction) client.sendText(instruction, "instruction", settings);
  });

  function snapshot(): LiveRecord {
    const s = d.settings.get();
    return {
      version: RECORD_VERSION, appMode: "live", id: `room-${client.roomId}`, startedAt: client.getState().createdAt ?? startedAt, updatedAt: Date.now(),
      model: s.model, shape: s.shape, speechLang: s.speechLang,
      requests: entries.map((e) => ({
        n: e.id, model: e.model, promptVersion: e.promptVersion, batch: e.batch, mode: e.mode,
        startedAt: e.startedAt, firstOpMs: e.firstOpMs, voiceFirstMs: e.voiceFirstMs, totalMs: e.totalMs,
        ops: e.opList.map((o) => ({ name: o.name, input: o.input })),
        warnings: [...e.warnings],
        usage: { input: e.usage.input_tokens, cacheRead: e.usage.cache_read_input_tokens, cacheWrite: e.usage.cache_creation_input_tokens, output: e.usage.output_tokens },
        costUsd: e.costUsd ?? 0,
        ...(e.error ? { error: e.error } : {}),
      })),
      transcript: transcript.map((x) => ({ ...x })),
      summary: d.board.get().summary,
      totals: { requests: totals.requests, costUsd: totals.costUsd, medianVoiceFirstMs: state().medianVoiceFirstMs },
    };
  }

  return {
    onFinalText(text, opts) {
      const s = text.trim();
      if (s) grouper.push(s);
      if (opts?.endOfTurn) grouper.flush();
    },
    sendSketch(sketch: SketchPayload) {
      return new Promise<boolean>((resolve) => {
        const p: PendingSketch = { ids: new Set(sketch.strokeIds), request: null, accepted: false, resolve, timer: setTimeout(() => settle(p, false), SKETCH_TIMEOUT_MS) };
        pendingSketches.push(p);
        client.sendSketch(sketch, turnSettings(d.settings.get()));
      });
    },
    stop() {
      stopped = true;
      grouper.cancel();
      detach?.();
      detach = null;
      offErrors();
      for (const p of [...pendingSketches]) settle(p, false);
      emit();
    },
    reset() {
      grouper.cancel();
      warning = "";
      client.reset(); // the `reset` event that comes back clears the board here and everywhere else
    },
    undoLastInstruction: () => false,
    snapshot,
    restore() {
      warning = t("room.noRestore");
      emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      fn(state());
      return () => { listeners.delete(fn); };
    },
  };
}
