// What a room, and one connection to it, may use. A room spends the owner's API key and memory for whoever has
// its link, so everything a participant can make the server do has a ceiling (ADR 0009). Defaults here; each one
// can be changed with an environment variable.

export interface RoomLimits {
  /** Rooms held in memory at once. `GRAFITO_MAX_ROOMS` */
  maxRooms: number;
  /** People (distinct participant ids) in one room. `GRAFITO_ROOM_MAX_PEOPLE` */
  maxPeople: number;
  /** Connections one participant id may hold in a room (tabs, a reconnect overlapping the old socket). */
  maxSocketsPerPerson: number;
  /** Largest WebSocket frame, in bytes; a larger one closes the connection. `GRAFITO_WS_MAX_BYTES` */
  maxFrameBytes: number;
  /** Messages per second one connection may send, and the burst it may save up. `GRAFITO_WS_RATE`, `GRAFITO_WS_BURST` */
  msgPerSec: number;
  msgBurst: number;
  /** Bytes per second one connection may send; the burst is one full frame. `GRAFITO_WS_BYTES_PER_SEC` */
  bytesPerSec: number;
  /** Messages that reach Claude (text, sketch) per second from one connection, and their burst. `GRAFITO_WS_TURN_RATE`, `GRAFITO_WS_TURN_BURST` */
  turnPerSec: number;
  turnBurst: number;
  /** Refused messages after which a connection is closed. */
  floodStrikes: number;
  /**
   * Messages and bytes per second a whole room takes, from everyone in it together: a person's budget starts
   * again with each connection, the room's does not. `GRAFITO_ROOM_WS_RATE`, `GRAFITO_ROOM_WS_BYTES_PER_SEC`
   */
  roomMsgPerSec: number;
  roomBytesPerSec: number;
  /** Connections a room accepts per minute (each one is sent the whole log), and their burst. `GRAFITO_ROOM_JOINS_PER_MIN` */
  roomJoinsPerMin: number;
  roomJoinBurst: number;
  /** Connections one client address may open per minute, and their burst. `GRAFITO_CLIENT_JOINS_PER_MIN` */
  clientJoinsPerMin: number;
  clientJoinBurst: number;
  /**
   * Bytes that may wait to be sent on one connection. Past `maxBufferedBytes` the connection is cut (the browser
   * is not reading); past `skipBufferedBytes` it is no longer sent cursors and strokes in progress.
   * `GRAFITO_WS_MAX_BUFFERED`
   */
  maxBufferedBytes: number;
  skipBufferedBytes: number;
  /** Claude requests a room may start in any 60 seconds. `GRAFITO_ROOM_CALLS_PER_MIN` */
  callsPerMinute: number;
  /** Claude requests a room may make in its whole life. `GRAFITO_ROOM_MAX_CALLS` */
  maxCalls: number;
  /** What a room may spend on the API key, in USD; plan models cost nothing and only count as calls. `GRAFITO_ROOM_MAX_USD` */
  maxUsd: number;
  /** Fragments, and their characters in total, that may wait for Claude at once. `GRAFITO_ROOM_QUEUE_MAX`, `GRAFITO_ROOM_QUEUE_CHARS` */
  queueMax: number;
  queueChars: number;
  /** Strokes a room keeps. `GRAFITO_ROOM_MAX_STROKES` */
  maxStrokes: number;
  /**
   * Events a room's log holds, and their size as JSON. The log is what every join is sent and what the room's
   * file holds; past either, the room takes no more ink or messages until it is cleared.
   * `GRAFITO_ROOM_MAX_EVENTS`, `GRAFITO_ROOM_MAX_LOG_BYTES`
   */
  maxEvents: number;
  maxLogBytes: number;
  /** A room nobody is in and nothing happened in for this long cannot be joined any more; 0 = never. `GRAFITO_ROOM_IDLE_MIN` (minutes) */
  idleMs: number;
}

export const DEFAULT_LIMITS: RoomLimits = {
  maxRooms: 20,
  maxPeople: 12,
  maxSocketsPerPerson: 4,
  // a sketch's picture travels in one frame
  maxFrameBytes: 8 * 1024 * 1024,
  // a pointer sends about 20 cursors and 12 drafts a second
  msgPerSec: 60,
  msgBurst: 120,
  bytesPerSec: 1024 * 1024,
  turnPerSec: 1,
  turnBurst: 5,
  floodStrikes: 400,
  roomMsgPerSec: 240,
  roomBytesPerSec: 4 * 1024 * 1024,
  roomJoinsPerMin: 60,
  roomJoinBurst: 24,
  clientJoinsPerMin: 20,
  clientJoinBurst: 8,
  // twice the largest log: one hello may wait whole, a second one behind it may not
  maxBufferedBytes: 16 * 1024 * 1024,
  skipBufferedBytes: 1024 * 1024,
  callsPerMinute: 12,
  maxCalls: 300,
  maxUsd: 5,
  queueMax: 12,
  // one sketch's description (up to 40 000 characters) fits
  queueChars: 48_000,
  maxStrokes: 3000,
  maxEvents: 20_000,
  maxLogBytes: 8 * 1024 * 1024,
  idleMs: 0,
};

/** In share mode a room's link stops working after 12 hours with nobody in it. */
const SHARE_IDLE_MS = 12 * 60 * 60 * 1000;

const ENV: [keyof RoomLimits, string, number?][] = [
  ["maxRooms", "GRAFITO_MAX_ROOMS"],
  ["maxPeople", "GRAFITO_ROOM_MAX_PEOPLE"],
  ["maxFrameBytes", "GRAFITO_WS_MAX_BYTES"],
  ["msgPerSec", "GRAFITO_WS_RATE"],
  ["msgBurst", "GRAFITO_WS_BURST"],
  ["bytesPerSec", "GRAFITO_WS_BYTES_PER_SEC"],
  ["turnPerSec", "GRAFITO_WS_TURN_RATE"],
  ["turnBurst", "GRAFITO_WS_TURN_BURST"],
  ["callsPerMinute", "GRAFITO_ROOM_CALLS_PER_MIN"],
  ["maxCalls", "GRAFITO_ROOM_MAX_CALLS"],
  ["maxUsd", "GRAFITO_ROOM_MAX_USD"],
  ["queueMax", "GRAFITO_ROOM_QUEUE_MAX"],
  ["queueChars", "GRAFITO_ROOM_QUEUE_CHARS"],
  ["maxStrokes", "GRAFITO_ROOM_MAX_STROKES"],
  ["maxEvents", "GRAFITO_ROOM_MAX_EVENTS"],
  ["maxLogBytes", "GRAFITO_ROOM_MAX_LOG_BYTES"],
  ["roomMsgPerSec", "GRAFITO_ROOM_WS_RATE"],
  ["roomBytesPerSec", "GRAFITO_ROOM_WS_BYTES_PER_SEC"],
  ["roomJoinsPerMin", "GRAFITO_ROOM_JOINS_PER_MIN"],
  ["clientJoinsPerMin", "GRAFITO_CLIENT_JOINS_PER_MIN"],
  ["maxBufferedBytes", "GRAFITO_WS_MAX_BUFFERED"],
  // minutes in the environment, milliseconds in the code
  ["idleMs", "GRAFITO_ROOM_IDLE_MIN", 60_000],
];

/** The limits for this run: the defaults, then what the environment sets. A value that is not a number >= 0 is ignored. */
export function limitsFromEnv(env: Record<string, string | undefined>, opts: { share?: boolean } = {}): RoomLimits {
  const limits: RoomLimits = { ...DEFAULT_LIMITS, ...(opts.share ? { idleMs: SHARE_IDLE_MS } : {}) };
  for (const [key, name, scale = 1] of ENV) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) limits[key] = n * scale;
  }
  return limits;
}

/**
 * A token bucket: `rate` tokens a second, at most `burst` saved. `take(n)` spends n if they are there. One whose
 * burst is smaller than a single request never lets it through, so the burst is at least what one request needs.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(private rate: number, private burst: number, private now: () => number = Date.now) {
    this.tokens = burst;
    this.last = now();
  }

  take(n = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + (Math.max(0, t - this.last) / 1000) * this.rate);
    this.last = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/** What one connection, or one client address across its connections, may send. */
export interface ClientBudget {
  messages: TokenBucket;
  bytes: TokenBucket;
  /** Messages that reach Claude. */
  turns: TokenBucket;
  joins: TokenBucket;
}

/** The buckets of one client under these limits. */
export function clientBudget(limits: RoomLimits, now: () => number = Date.now): ClientBudget {
  return {
    messages: new TokenBucket(limits.msgPerSec, Math.max(1, limits.msgBurst), now),
    // the burst holds one full frame, or a single large message could never pass
    bytes: new TokenBucket(limits.bytesPerSec, Math.max(limits.bytesPerSec, limits.maxFrameBytes), now),
    turns: new TokenBucket(limits.turnPerSec, Math.max(1, limits.turnBurst), now),
    joins: new TokenBucket(limits.clientJoinsPerMin / 60, Math.max(1, limits.clientJoinBurst), now),
  };
}

/** How many connections' worth of budget one address gets: several people can sit behind one address. */
export const ADDRESS_SHARE = 4;

/**
 * Budgets by client address, on top of each connection's own, so closing a connection and opening another
 * does not start from a full one. The key is the address the tunnel reports (`Cf-Connecting-Ip`, which the
 * edge sets and a sender cannot choose); a connection without one (this machine, the local network) has no
 * address budget. An address gets `ADDRESS_SHARE` connections' worth. One not seen for a while is forgotten,
 * once its buckets have had time to fill again anyway.
 */
export class ClientBudgets {
  private byKey = new Map<string, { budget: ClientBudget; seen: number }>();

  constructor(private limits: RoomLimits, private now: () => number = Date.now, private keepMs = 10 * 60_000, private max = 5000) {}

  for(key: string | undefined): ClientBudget | undefined {
    if (!key) return undefined;
    const t = this.now();
    let entry = this.byKey.get(key);
    if (!entry) {
      if (this.byKey.size >= this.max) this.sweep(t);
      // still full of addresses seen just now: the oldest goes
      if (this.byKey.size >= this.max) this.byKey.delete(this.byKey.keys().next().value!);
      const L = this.limits;
      const wide = { ...L, msgPerSec: L.msgPerSec * ADDRESS_SHARE, msgBurst: L.msgBurst * ADDRESS_SHARE, bytesPerSec: L.bytesPerSec * ADDRESS_SHARE, turnPerSec: L.turnPerSec * ADDRESS_SHARE, turnBurst: L.turnBurst * ADDRESS_SHARE };
      entry = { budget: clientBudget(wide, this.now), seen: t };
      this.byKey.set(key, entry);
    }
    entry.seen = t;
    return entry.budget;
  }

  private sweep(t: number) {
    for (const [key, e] of this.byKey) if (t - e.seen > this.keepMs) this.byKey.delete(key);
  }

  get size(): number {
    return this.byKey.size;
  }
}
