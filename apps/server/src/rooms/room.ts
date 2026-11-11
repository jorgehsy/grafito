// A room: one board shared by several people, with Claude as one more of them. The room keeps the event log
// (what every browser replays), the board Claude is told about, the sketch, who is here, and the queue of
// what was said. It makes the Claude requests itself, one at a time, so everybody draws from the same answers.
// No sockets in here: `join` takes a `send` function, which makes the room testable on its own.
import { applyOp, emptyBoard, serializeBoard } from "@grafito/board";
import type { Board } from "@grafito/board";
import { CLAUDE_ID, DEFAULT_LANG, DEFAULT_MODEL, PARTICIPANT_COLORS, PROMPT_VERSION, ZONE_KINDS, costUsd, isLang, normalizeCatalogs, parseOp, zeroUsage } from "@grafito/contract";
import type { ClaudeStatus, ClientMessage, Op, Participant, RoomErrorCode, RoomEvent, RoomEventBody, ServerMessage, SketchPayload, TurnSettings, Usage, WireStroke } from "@grafito/contract";
import { CATALOG_IDS, isCatalogId } from "@grafito/icons";
import type { ClaudeParams } from "../claude/client";
import { boardTurnParams, parseSketch } from "../prompt/board-turn";
import { pickModel } from "../routes/turn";
import type { Clients } from "../routes/turn";
import { fingerprint, newSecret } from "../secret";
import { DEFAULT_LIMITS } from "./limits";
import type { RoomLimits } from "./limits";

/** A room as it is written to disk: replaying `events` rebuilds everything else. */
export interface SavedRoom {
  id: string;
  createdAt: number;
  events: RoomEvent[];
  /** The invite token. A room saved without one gets a new one, so nobody holds a link to it. */
  token?: string;
  /** Claude requests made and USD spent in the room's whole life: a reset wipes the log, not these. */
  calls?: number;
  spentUsd?: number;
  /** When someone was last in the room or something was last logged. */
  lastActiveAt?: number;
}

export interface RoomDeps {
  clients: Clients;
  now?: () => number;
  /** Called after every logged event (the registry saves the room). */
  onChange?: (room: Room) => void;
  /** What the room may use (default: `DEFAULT_LIMITS`). */
  limits?: RoomLimits;
}

type Send = (m: ServerMessage) => void;
const LOG_FULL: { code: RoomErrorCode; message: string } = { code: "log_full", message: "This room's history is full; clear the board to go on" };
type Mode = "content" | "instruction" | "sketch";

/** One thing waiting for Claude: a fragment someone said, or a sketch someone handed in. */
interface Pending {
  name: string;
  text: string;
  mode: Mode;
  settings: TurnSettings;
  sketch?: SketchPayload;
}

/** More ink than this in one room is refused: the log is replayed by everyone who joins. */
export const MAX_STROKES = DEFAULT_LIMITS.maxStrokes;

const DRAWS = (name: string) => name !== "say" && name !== "update_summary";

/** Resume secrets a room remembers; past this, the oldest of people who are not connected go. */
const MAX_IDENTITIES = 200;

/**
 * A name as the room shows it and as Claude reads it (`[name] text`): no control characters or line breaks,
 * no square brackets, one space between words, at most 40 characters. "" when nothing is left or when it
 * reads as Claude's own name, which no person may carry.
 */
export function cleanRoomName(raw: string): string {
  const name = raw.normalize("NFKC").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}[\]]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  return name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === CLAUDE_ID ? "" : name;
}

/**
 * What an interrupted request is billed as when the model never reported usage: the whole prompt as input
 * (about three characters a token, a picture at Claude's ceiling for one) and the most it could have written.
 * High on purpose: the cap is there for requests that are cut short to dodge it.
 */
export function estimateUsage(params: ClaudeParams): Usage {
  const chars = params.userText.length + params.system.reduce((n, b) => n + b.text.length, 0);
  return { ...zeroUsage(), input_tokens: Math.ceil(chars / 3) + (params.image ? 1600 : 0), output_tokens: params.maxTokens };
}

export class Room {
  readonly id: string;
  readonly createdAt: number;
  /** What a browser must present to join (ADR 0009). */
  readonly token: string;
  private readonly limits: RoomLimits;
  /** Claude requests started and USD spent since the room was made: what the caps are checked against. */
  private calls = 0;
  private spentUsd = 0;
  /** When each of the last minute's requests started. */
  private recent: number[] = [];
  private lastActiveAt: number;
  private events: RoomEvent[] = [];
  /** Each logged event's size as JSON, by seq, and their sum: what the log weighs in a hello and on disk. */
  private sizes = new Map<number, number>();
  private logBytes = 0;
  /** Resume secret (its fingerprint) to the participant id the server gave its holder. */
  private identities = new Map<string, string>();
  private board: Board = emptyBoard();
  private strokes = new Map<string, WireStroke>();
  private people = new Map<string, { info: Participant; sends: Set<Send> }>();
  /** The colour each person had, so leaving and coming back keeps it while it is free. */
  private colors = new Map<string, string>();
  private queue: Pending[] = [];
  private running = false;
  private status: ClaudeStatus = "idle";
  private seq = 0;
  private requests = 0;
  /** Bumped by reset: a request still unwinding from before it logs nothing. */
  private epoch = 0;
  private abort: AbortController | null = null;
  private waiters: (() => void)[] = [];
  private readonly now: () => number;

  constructor(id: string, private deps: RoomDeps, saved?: SavedRoom) {
    this.id = id;
    this.now = deps.now ?? Date.now;
    this.limits = deps.limits ?? DEFAULT_LIMITS;
    this.createdAt = saved?.createdAt ?? this.now();
    this.token = saved?.token ?? newSecret();
    if (saved) this.replay(saved.events);
    // a log saved before the counters existed still counts what it shows
    this.calls = Math.max(saved?.calls ?? 0, this.calls);
    this.spentUsd = Math.max(saved?.spentUsd ?? 0, this.spentUsd);
    this.lastActiveAt = saved?.lastActiveAt ?? this.now();
  }

  /** Rebuilds board, sketch and counters from a saved log. */
  private replay(events: RoomEvent[]) {
    for (const e of events) {
      if (e.type === "reset") { this.board = emptyBoard(); this.strokes.clear(); this.wipeLog(); }
      this.seq = Math.max(this.seq, e.seq);
      // a log saved before erases were compacted: the erase and the strokes it removed are not kept
      if (e.type === "erase") { for (const id of e.ids) this.strokes.delete(id); this.forgetStrokes(e.ids); continue; }
      this.keep(e);
      if (e.type === "op") {
        const p = parseOp(e.op, CATALOG_IDS, "room");
        if (p.ok) this.board = applyOp(this.board, p.op).board;
      } else if (e.type === "stroke") this.strokes.set(e.stroke.id, e.stroke);
      else if (e.type === "request") { this.requests = Math.max(this.requests, e.n); this.calls++; }
      else if (e.type === "request_end") this.spentUsd += e.costUsd ?? 0;
    }
  }

  /** The board to start from (a solo session turned into a room): logged like Claude's ops, as request 0. */
  seed(ops: readonly Op[]) {
    for (const op of ops) {
      this.board = applyOp(this.board, op).board;
      this.log({ type: "op", op: { name: op.name, input: op.input }, request: 0 });
    }
  }

  participants(): Participant[] {
    return [...this.people.values()].map((p) => p.info);
  }

  snapshot(): SavedRoom {
    return { id: this.id, createdAt: this.createdAt, token: this.token, calls: this.calls, spentUsd: this.spentUsd, lastActiveAt: this.lastActiveAt, events: [...this.events] };
  }

  /** Claude requests made and USD spent so far: what the room's caps are checked against. */
  spend(): { calls: number; usd: number } {
    return { calls: this.calls, usd: this.spentUsd };
  }

  /** How many events the log holds and what they weigh as JSON. */
  logSize(): { events: number; bytes: number } {
    return { events: this.events.length, bytes: this.logBytes };
  }

  /**
   * Who a connection is. With the resume secret of someone this room knows, that participant; otherwise a new
   * one, with an id and a secret made here. A browser never names its own id, so it cannot take another's.
   */
  identify(resume?: string): { id: string; resume: string } {
    const known = resume ? this.identities.get(fingerprint(resume)) : undefined;
    if (known && resume) return { id: known, resume };
    if (this.identities.size >= MAX_IDENTITIES) {
      for (const [print, id] of this.identities) {
        if (this.identities.size < MAX_IDENTITIES) break;
        if (!this.people.has(id)) { this.identities.delete(print); this.colors.delete(id); }
      }
    }
    const id = "p" + newSecret(9);
    const secret = newSecret();
    this.identities.set(fingerprint(secret), id);
    return { id, resume: secret };
  }

  /** Whether one more connection as `id` fits: a new person while there is room, or one more tab of someone here. */
  admits(id: string): boolean {
    const person = this.people.get(id);
    return person ? person.sends.size < this.limits.maxSocketsPerPerson : this.people.size < this.limits.maxPeople;
  }

  /** Nobody connected and nothing waiting for Claude. */
  empty(): boolean {
    return this.people.size === 0 && !this.running && this.queue.length === 0;
  }

  /** How long ago someone was last here or something was last logged; 0 while someone is connected. */
  idleFor(): number {
    return this.people.size ? 0 : Math.max(0, this.now() - this.lastActiveAt);
  }

  /** The board as the room has it (what Claude is told). */
  currentBoard(): Board {
    return this.board;
  }

  /** Resolves once nothing is waiting for Claude and no request is in flight. */
  idle(): Promise<void> {
    if (!this.running && !this.queue.length) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /**
   * Someone connects. The same id on a second connection is the same person. `send` gets `hello` with the
   * whole log, then everything that happens. Returns the function that disconnects this connection.
   */
  join(who: { id: string; name: string; resume?: string }, send: Send): () => void {
    let person = this.people.get(who.id);
    if (!person) {
      person = { info: { id: who.id, name: cleanRoomName(who.name) || "Guest", color: this.colorFor(who.id) }, sends: new Set() };
      this.people.set(who.id, person);
    }
    person.sends.add(send);
    this.lastActiveAt = this.now();
    send({ t: "hello", you: person.info, ...(who.resume ? { resume: who.resume } : {}), room: { id: this.id, createdAt: this.createdAt }, participants: this.participants(), events: [...this.events], claude: this.status });
    this.broadcast({ t: "presence", participants: this.participants() });
    let left = false;
    return () => {
      if (left) return;
      left = true;
      const p = this.people.get(who.id);
      if (!p) return;
      p.sends.delete(send);
      if (p.sends.size) return;
      this.people.delete(who.id);
      this.lastActiveAt = this.now();
      this.deps.onChange?.(this);
      // whatever they were in the middle of goes with them
      this.broadcast({ t: "draft", id: who.id, stroke: null });
      this.broadcast({ t: "cursor", id: who.id, at: null });
      this.broadcast({ t: "presence", participants: this.participants() });
    };
  }

  private colorFor(id: string): string {
    const used = new Set(this.participants().map((p) => p.color));
    const kept = this.colors.get(id);
    const color = kept && !used.has(kept) ? kept : (PARTICIPANT_COLORS.find((c) => !used.has(c)) ?? PARTICIPANT_COLORS[this.people.size % PARTICIPANT_COLORS.length]);
    this.colors.set(id, color);
    return color;
  }

  /** A message from a participant, already validated with `parseClientMessage`. */
  handle(from: string, m: ClientMessage) {
    const person = this.people.get(from);
    if (!person) return;
    const me = person.info;
    switch (m.t) {
      case "text": {
        const no = this.refusal(m.mode, m.text.length);
        if (no) return this.tell(person.sends, { t: "error", ...no });
        // a rejected message is told to its sender, who may be waiting on it
        this.log({ type: "message", by: me.id, name: me.name, text: m.text, mode: m.mode });
        this.queue.push({ name: me.name, text: m.text, mode: m.mode, settings: m.settings });
        void this.pump();
        return;
      }
      case "sketch": {
        // the same check POST /api/board makes: a description, and a picture that is base64 or absent
        const sketch = parseSketch({ hints: m.sketch.hints, image: m.sketch.image });
        if (!sketch) return this.tell(person.sends, { t: "error", message: "Invalid sketch: it needs a description, and its picture must be base64 PNG" });
        const no = this.refusal("sketch", sketch.hints.length);
        if (no) return this.tell(person.sends, { t: "error", ...no });
        this.log({ type: "message", by: me.id, name: me.name, text: "", mode: "sketch" });
        this.queue.push({ name: me.name, text: "", mode: "sketch", settings: m.settings, sketch: { strokeIds: m.sketch.strokeIds, ...sketch } });
        void this.pump();
        return;
      }
      case "stroke": {
        if (this.strokes.has(m.stroke.id)) return;
        if (this.strokes.size >= this.limits.maxStrokes) return this.tell(person.sends, { t: "error", code: "ink", message: "The room has too much ink; erase some first" });
        if (this.logFull()) return this.tell(person.sends, { t: "error", ...LOG_FULL });
        // the stroke is whoever sent it, whatever it claims
        const stroke = { ...m.stroke, by: me.id };
        this.strokes.set(stroke.id, stroke);
        this.log({ type: "stroke", stroke });
        return;
      }
      case "erase": {
        const ids = m.ids.filter((id) => this.strokes.delete(id));
        if (ids.length) this.erased(ids, me.id);
        return;
      }
      case "draft":
        this.broadcast({ t: "draft", id: me.id, stroke: m.stroke ? { ...m.stroke, by: me.id } : null }, person.sends);
        return;
      case "cursor":
        this.broadcast({ t: "cursor", id: me.id, at: m.at }, person.sends);
        return;
      case "rename": {
        const name = cleanRoomName(m.name);
        if (!name) return this.tell(person.sends, { t: "error", message: "That name cannot be used" });
        person.info = { ...me, name };
        this.broadcast({ t: "presence", participants: this.participants() });
        return;
      }
      case "reset":
        this.epoch++;
        this.abort?.abort();
        this.abort = null;
        this.queue = [];
        this.board = emptyBoard();
        this.strokes.clear();
        this.wipeLog();
        this.setStatus("idle");
        this.log({ type: "reset", by: me.id });
        return;
    }
  }

  /**
   * Why one more message for Claude is not taken, or null if it is. Checked before anything is logged or queued,
   * so a refused message costs nothing. It counts the requests the queue will turn into (content said in a row
   * is one request), so the queue never holds more than the per-minute and lifetime caps allow.
   */
  private refusal(mode: Mode, chars: number): { code: RoomErrorCode; message: string } | null {
    const L = this.limits;
    const modes = [...this.queue.map((q) => q.mode), mode];
    const waiting = modes.filter((m, i) => m !== "content" || modes[i - 1] !== "content").length;
    const cap = this.capReached();
    if (cap) return cap;
    if (this.calls + waiting > L.maxCalls) return { code: "room_cap", message: `This room reached its cap of ${L.maxCalls} Claude requests: Claude no longer answers here` };
    if (this.logFull()) return LOG_FULL;
    const queued = this.queue.reduce((n, q) => n + q.text.length + (q.sketch?.hints.length ?? 0), 0);
    if (this.queue.length >= L.queueMax || queued + chars > L.queueChars) return { code: "busy", message: "Claude has too much waiting; try again in a moment" };
    const since = this.now() - 60_000;
    this.recent = this.recent.filter((t) => t > since);
    if (this.recent.length + waiting > L.callsPerMinute) return { code: "calls_per_minute", message: `This room is limited to ${L.callsPerMinute} Claude requests a minute; try again in a moment` };
    return null;
  }

  /** The room's cap on Claude, if it has been reached: what it spent, or how many requests it made. */
  private capReached(): { code: RoomErrorCode; message: string } | null {
    const L = this.limits;
    if (this.spentUsd >= L.maxUsd) return { code: "room_cap", message: `This room reached its spending cap (${L.maxUsd} USD): Claude no longer answers here` };
    if (this.calls >= L.maxCalls) return { code: "room_cap", message: `This room reached its cap of ${L.maxCalls} Claude requests: Claude no longer answers here` };
    return null;
  }

  private logFull(): boolean {
    return this.events.length >= this.limits.maxEvents || this.logBytes >= this.limits.maxLogBytes;
  }

  private keep(event: RoomEvent) {
    const size = JSON.stringify(event).length;
    this.events.push(event);
    this.sizes.set(event.seq, size);
    this.logBytes += size;
  }

  private wipeLog() {
    this.events = [];
    this.sizes.clear();
    this.logBytes = 0;
  }

  /** Takes the stroke events of these strokes out of the log. */
  private forgetStrokes(ids: readonly string[]) {
    const gone = new Set(ids);
    this.events = this.events.filter((e) => {
      if (e.type !== "stroke" || !gone.has(e.stroke.id)) return true;
      this.logBytes -= this.sizes.get(e.seq) ?? 0;
      this.sizes.delete(e.seq);
      return false;
    });
  }

  private log(body: RoomEventBody) {
    this.lastActiveAt = this.now();
    const event = { seq: ++this.seq, at: this.now(), ...body } as RoomEvent;
    this.keep(event);
    this.broadcast({ t: "event", event });
    this.deps.onChange?.(this);
  }

  /**
   * Strokes were removed. Everyone connected is told, as an event like any other, but the log does not grow:
   * the erase is not kept and neither are the strokes it removed, since replaying a stroke and its erase
   * draws nothing. Drawing and erasing for hours leaves a log the size of the ink that is on the board.
   */
  private erased(ids: string[], by: string) {
    this.lastActiveAt = this.now();
    this.forgetStrokes(ids);
    this.broadcast({ t: "event", event: { seq: ++this.seq, at: this.now(), type: "erase", ids, by } });
    this.deps.onChange?.(this);
  }

  private tell(sends: Iterable<Send>, m: ServerMessage) {
    for (const send of sends) send(m);
  }

  private broadcast(m: ServerMessage, except?: Set<Send>) {
    for (const p of this.people.values()) for (const send of p.sends) if (!except?.has(send)) send(m);
  }

  private setStatus(status: ClaudeStatus) {
    if (status === this.status) return;
    this.status = status;
    this.broadcast({ t: "claude", status });
  }

  /** One request in flight. Content said meanwhile is joined into the next one; an instruction or a sketch goes alone. */
  private async pump() {
    if (this.running || !this.queue.length) return;
    // The cap is checked again here, not only when a message was taken: what waited behind a request that
    // reached the cap is dropped, and everyone is told.
    const cap = this.capReached();
    if (cap) {
      this.queue = [];
      this.broadcast({ t: "error", ...cap });
      for (const w of this.waiters.splice(0)) w();
      return;
    }
    let n = 1;
    if (this.queue[0].mode === "content") while (n < this.queue.length && this.queue[n].mode === "content") n++;
    const items = this.queue.splice(0, n);
    this.running = true;
    try {
      await this.request(items);
    } finally {
      this.running = false;
    }
    if (this.queue.length) return void this.pump();
    for (const w of this.waiters.splice(0)) w();
  }

  private async request(items: Pending[]) {
    const epoch = this.epoch;
    const t0 = this.now();
    const { mode, settings, sketch } = items[0];
    // Like POST /api/board: what the sender chose, and a fallback instead of a failure for what is unknown.
    const catalogs = normalizeCatalogs(settings.catalogs.filter(isCatalogId));
    const lang = isLang(settings.lang) ? settings.lang : DEFAULT_LANG;
    const shape = (ZONE_KINDS as readonly string[]).includes(settings.shape) ? settings.shape : "auto";
    const picked = pickModel(this.deps.clients, settings.model, DEFAULT_MODEL);
    const model = "error" in picked ? settings.model : picked.model;
    // Every line says who said it. A sketch has no words: the request sends its description instead.
    const delta = mode === "sketch" ? "" : items.map((i) => `[${i.name}] ${i.text}`).join("\n");
    const n = ++this.requests;
    this.calls++;
    this.recent.push(t0);
    this.log({ type: "request", n, model, mode, batch: mode === "sketch" ? `[${items[0].name}] sketch\n${sketch?.hints ?? ""}` : delta, promptVersion: PROMPT_VERSION });

    let usage: Usage = zeroUsage();
    let sawUsage = false;
    let firstOpMs: number | null = null;
    let ops = 0;
    let drew = false;
    let error: string | undefined;
    let cost: number | null = costUsd(model, usage);
    const warnings: string[] = [];
    if ("error" in picked) error = picked.error;
    else {
      const abort = new AbortController();
      this.abort = abort;
      this.setStatus("thinking");
      const params = boardTurnParams({
        model, mode, delta, shape, catalogs, lang, room: true,
        board: serializeBoard(this.board, { catalog: catalogs.length > 0 }), summary: this.board.summary,
        ...(sketch ? { sketch: { hints: sketch.hints, image: sketch.image } } : {}),
      });
      try {
        for await (const ev of picked.client.stream(params, abort.signal)) {
          if (ev.type === "usage" || ev.type === "end") { usage = { ...ev.usage }; sawUsage = true; }
          if (epoch !== this.epoch) return;
          if (ev.type === "op") {
            if (firstOpMs === null) firstOpMs = this.now() - t0;
            ops++;
            this.setStatus("drawing");
            if (ev.op.name === "say") {
              this.log({ type: "say", text: ev.op.input.text, ...(ev.op.input.target ? { target: ev.op.input.target } : {}), request: n });
              continue;
            }
            // Logged even when the board refuses it: every browser applies the same op and gets the same refusal.
            const r = applyOp(this.board, ev.op);
            if (DRAWS(ev.op.name) && r.board !== this.board) drew = true;
            this.board = r.board;
            warnings.push(...r.warnings);
            this.log({ type: "op", op: { name: ev.op.name, input: ev.op.input }, request: n });
          } else if (ev.type === "invalid") warnings.push(ev.warning);
          else if (ev.type === "end") {
            if (ev.stopReason === "refusal") error = "The model refused the request (refusal)";
            else if (ev.stopReason === "max_tokens") error = "Response cut off by max_tokens";
          }
        }
      } catch (e: any) {
        if (epoch !== this.epoch) return;
        const status = e?.status && e.status !== 401 && e.status !== 402 ? ` (HTTP ${e.status})` : "";
        error = `Error calling Claude${status}: ${e?.message ?? e}`;
      } finally {
        // What the request cost is counted here, on every way out: a request cut short by a reset was still
        // sent, and is billed. If the model had not reported usage yet, it counts as the most it could cost.
        const cut = epoch !== this.epoch;
        cost = costUsd(model, cut && !sawUsage ? estimateUsage(params) : usage);
        this.spentUsd += cost ?? 0;
        if (cut) this.deps.onChange?.(this);
      }
      if (epoch !== this.epoch) return;
      if (this.abort === abort) this.abort = null;
    }

    this.log({ type: "request_end", n, firstOpMs, totalMs: this.now() - t0, ops, usage, costUsd: cost, warnings, ...(error ? { error } : {}) });
    // Claude turned the ink into elements: the ink goes. If it drew nothing, the ink stays where it is.
    if (sketch && drew) {
      const ids = sketch.strokeIds.filter((id) => this.strokes.delete(id));
      if (ids.length) this.erased(ids, CLAUDE_ID);
    }
    this.setStatus("idle");
  }
}
