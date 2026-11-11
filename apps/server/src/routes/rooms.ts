// The HTTP and WebSocket sides of rooms: POST /api/rooms makes one, GET /api/rooms/:id says if it exists,
// and /api/rooms/:id/ws is the connection each browser keeps open. The protocol is in @grafito/contract (room.ts).
// Joining takes the room's invite token, the server says who each connection is, and what a connection, a
// client address and a whole room may send is budgeted (ADR 0009).
import type { Request, Response } from "express";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { RawData, WebSocket } from "ws";
import { ROOM_CLOSE, ROOM_KEY_PREFIX, ROOM_PROTOCOL, ROOM_RESUME_PREFIX, ROOM_TOKEN_PATTERN, createRoomSchema, parseClientMessage, parseOp, participantSchema } from "@grafito/contract";
import type { Op, ServerMessage } from "@grafito/contract";
import { CATALOG_IDS } from "@grafito/icons";
import { RoomsFull } from "../rooms/registry";
import type { RoomRegistry } from "../rooms/registry";
import { ClientBudgets, DEFAULT_LIMITS, TokenBucket, clientBudget } from "../rooms/limits";
import type { ClientBudget, RoomLimits } from "../rooms/limits";
import type { Room } from "../rooms/room";
import { newSecret, safeEqual } from "../secret";

const PING_MS = 30_000;
/** How long a refused connection is given to take its close frame before the socket is cut. */
export const REFUSE_MS = 1000;
/** A refused connection has nothing to say: the largest frame it may send. */
const REFUSED_MAX_FRAME = 256;
const WS_PATH = /^\/api\/rooms\/([^/]+)\/ws$/;
/** What a wrong token is compared with when the room does not exist, so both refusals take the same work. */
const NO_ROOM_TOKEN = newSecret();

export function createRoomsHandlers(registry: RoomRegistry) {
  return {
    /** `POST /api/rooms` with `{ ops? }`: a new room, starting from that board. Answers its id and invite token. Ops that do not parse are dropped. */
    create(req: Request, res: Response) {
      const body = createRoomSchema.safeParse(req.body ?? {});
      if (!body.success) return void res.status(400).json({ error: "Invalid body: expected { ops?: {name, input}[] }" });
      const seed: Op[] = [];
      for (const raw of body.data.ops ?? []) {
        const p = parseOp(raw, CATALOG_IDS, "board");
        if (p.ok) seed.push(p.op);
      }
      try {
        const room = registry.create(seed);
        res.setHeader("Cache-Control", "no-store");
        res.json({ id: room.id, token: room.token });
      } catch (e) {
        if (e instanceof RoomsFull) return void res.status(503).json({ error: e.message });
        throw e;
      }
    },
    /** `GET /api/rooms/:id`: whether the room exists and how many people are in it. Never its token. */
    async info(req: Request, res: Response) {
      const room = await registry.get(String(req.params.id));
      if (!room) return void res.status(404).json({ error: "No such room" });
      res.json({ id: room.id, createdAt: room.createdAt, participants: room.participants().length });
    },
  };
}

function refuse(socket: Duplex, status: string) {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

const bytesOf = (data: RawData): Buffer => (Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data));

/** The part of a WebSocket that sending needs; tests pass a fake. */
export interface Outbound {
  readonly readyState: number;
  readonly OPEN: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  terminate(): void;
}

/**
 * How room messages go out on one connection. A browser that stops reading makes the server hold what it is
 * sent; this keeps that bounded. Past `skipBufferedBytes` waiting, cursors and strokes in progress are not
 * sent (they are stale a moment later anyway); past `maxBufferedBytes`, the connection is cut, and the browser
 * reconnects and gets the log again when it can keep up.
 */
export function sender(ws: Outbound, limits: RoomLimits = DEFAULT_LIMITS): (m: ServerMessage) => void {
  return (m) => {
    if (ws.readyState !== ws.OPEN) return;
    const waiting = ws.bufferedAmount;
    if (waiting > limits.maxBufferedBytes) return ws.terminate();
    if (waiting > limits.skipBufferedBytes && (m.t === "draft" || m.t === "cursor")) return;
    ws.send(JSON.stringify(m));
  };
}

/** What a whole room takes from everyone in it together. */
interface RoomBudget { messages: TokenBucket; bytes: TokenBucket; joins: TokenBucket }

const roomBudget = (limits: RoomLimits, now: () => number): RoomBudget => ({
  messages: new TokenBucket(limits.roomMsgPerSec, Math.max(1, limits.roomMsgPerSec * 2), now),
  bytes: new TokenBucket(limits.roomBytesPerSec, Math.max(limits.roomBytesPerSec, limits.maxFrameBytes), now),
  joins: new TokenBucket(limits.roomJoinsPerMin / 60, Math.max(1, limits.roomJoinBurst), now),
});

export interface ConnectOptions {
  limits?: RoomLimits;
  /** This connection's budget (default: a full one). */
  budget?: ClientBudget;
  /** The budget of the address it comes from, shared by all its connections (default: none). */
  address?: ClientBudget;
  /** The room's budget, shared by everyone in it (default: none). */
  shared?: { messages: TokenBucket; bytes: TokenBucket };
  now?: () => number;
}

/**
 * Puts one connection in its room: frames in through `parseClientMessage`, room messages out as JSON.
 * A frame spends from three budgets: the connection's (messages, bytes, and messages that reach Claude), its
 * address's, which a reconnect does not refill, and the room's. One over budget is dropped and answered with
 * a `rate` error (at most one a second); a connection that keeps going over its own or its address's budget
 * is closed.
 */
export function connect(ws: WebSocket, room: Room, who: { id: string; name: string; resume?: string }, opts: ConnectOptions = {}) {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const now = opts.now ?? Date.now;
  const budget = opts.budget ?? clientBudget(limits, now);
  const send = sender(ws, limits);
  const leave = room.join(who, send);
  const ping = setInterval(() => { if (ws.readyState === ws.OPEN) ws.ping(); }, PING_MS);
  let strikes = 0;
  let toldAt = -Infinity;
  const tooFast = (mine: boolean) => {
    if (mine && ++strikes >= limits.floodStrikes) return ws.close(ROOM_CLOSE.flood, "too many messages");
    if (now() - toldAt < 1000) return;
    toldAt = now();
    send({ t: "error", code: "rate", message: mine ? "You are sending too fast; some of it was dropped" : "This room is receiving too much at once; some of it was dropped" });
  };
  ws.on("message", (data) => {
    const frame = bytesOf(data);
    if (!budget.messages.take() || !budget.bytes.take(frame.length)) return tooFast(true);
    if (opts.address && (!opts.address.messages.take() || !opts.address.bytes.take(frame.length))) return tooFast(true);
    if (opts.shared && (!opts.shared.messages.take() || !opts.shared.bytes.take(frame.length))) return tooFast(false);
    let raw: unknown;
    try { raw = JSON.parse(frame.toString("utf8")); } catch { return send({ t: "error", message: "Malformed message: not JSON" }); }
    const p = parseClientMessage(raw);
    if (!p.ok) return send({ t: "error", message: `Invalid message: ${p.error}` });
    if ((p.message.t === "text" || p.message.t === "sketch") && (!budget.turns.take() || (opts.address && !opts.address.turns.take()))) return tooFast(true);
    room.handle(who.id, p.message);
  });
  const end = () => { clearInterval(ping); leave(); };
  ws.on("close", end);
  ws.on("error", end);
}

/** What a browser offered as subprotocols: the protocol's name, the invite token and, coming back, its resume secret. */
function offered(req: IncomingMessage): { protocol: boolean; token: string | undefined; resume: string | undefined } {
  const list = String(req.headers["sec-websocket-protocol"] ?? "").split(",").map((s) => s.trim());
  const after = (prefix: string) => list.find((s) => s.startsWith(prefix))?.slice(prefix.length);
  const resume = after(ROOM_RESUME_PREFIX);
  return { protocol: list.includes(ROOM_PROTOCOL), token: after(ROOM_KEY_PREFIX), resume: resume && ROOM_TOKEN_PATTERN.test(resume) ? resume : undefined };
}

/** The address the tunnel says the request came from. The edge sets it; without a tunnel there is none. */
const clientAddress = (req: IncomingMessage): string | undefined => {
  const ip = req.headers["cf-connecting-ip"];
  return typeof ip === "string" && ip.length > 0 && ip.length <= 64 ? ip : undefined;
};

export interface RoomSocketOptions {
  limits?: RoomLimits;
  /** Says whether an upgrade may go on, from its headers (share mode: its Origin must be this server). */
  allow?: (req: IncomingMessage) => boolean;
  now?: () => number;
}

/**
 * Answers the WebSocket upgrades of `/api/rooms/:id/ws?name=<name>` on this server. The browser offers the
 * subprotocols `ROOM_PROTOCOL`, `k.<invite token>` and, to come back as who it was, `r.<resume secret>`.
 * Anything else that asks for an upgrade is refused with an HTTP status.
 *
 * A wrong token, or a room that does not exist, gets the handshake and then a close with
 * `ROOM_CLOSE.refused` and nothing else: a browser cannot read an HTTP status on a failed upgrade, it can
 * read a close code. Both cases look the same from outside, and the token is compared in constant time. A
 * full room closes with `ROOM_CLOSE.full`, and one that is being joined too fast with `ROOM_CLOSE.flood`.
 * A refused connection is on a server of its own that takes frames of a few bytes, and its socket is cut
 * `REFUSE_MS` later whether or not the other end answered: it cannot be held open or made to buffer.
 *
 * The participant id is the server's: a new one for a new connection, the same one for a connection that
 * presents the resume secret it was given.
 */
export function attachRoomSockets(server: Server, registry: RoomRegistry, opts: RoomSocketOptions = {}): WebSocketServer {
  const limits = opts.limits ?? DEFAULT_LIMITS;
  const now = opts.now ?? Date.now;
  // answer with the protocol's name, never with an entry that carries a secret
  const handleProtocols = (protocols: Set<string>) => (protocols.has(ROOM_PROTOCOL) ? ROOM_PROTOCOL : false);
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxFrameBytes, handleProtocols });
  const refusals = new WebSocketServer({ noServer: true, maxPayload: REFUSED_MAX_FRAME, handleProtocols });
  const clients = new ClientBudgets(limits, now);
  const rooms = new WeakMap<Room, RoomBudget>();
  const budgetOf = (room: Room) => {
    let b = rooms.get(room);
    if (!b) { b = roomBudget(limits, now); rooms.set(room, b); }
    return b;
  };

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const id = WS_PATH.exec(url.pathname)?.[1];
    if (!id) return refuse(socket, "404 Not Found");
    if (opts.allow && !opts.allow(req)) return refuse(socket, "403 Forbidden");
    const name = participantSchema.shape.name.safeParse(url.searchParams.get("name") ?? "Guest");
    if (!name.success) return refuse(socket, "400 Bad Request");
    const { protocol, token, resume } = offered(req);
    if (!protocol) return refuse(socket, "401 Unauthorized");
    socket.on("error", () => socket.destroy());
    const close = (code: number, reason: string) => refusals.handleUpgrade(req, socket, head, (ws) => {
      ws.on("error", () => ws.terminate());
      const cut = setTimeout(() => ws.terminate(), REFUSE_MS);
      ws.on("close", () => clearTimeout(cut));
      ws.close(code, reason);
    });
    void registry.get(id).then((room) => {
      const ok = safeEqual(token, room?.token ?? NO_ROOM_TOKEN) && !!room;
      if (!ok || !room) return close(ROOM_CLOSE.refused, "refused");
      // Every join is sent the whole log: an address, and a room, take only so many a minute.
      const address = clients.for(clientAddress(req));
      const shared = budgetOf(room);
      if ((address && !address.joins.take()) || !shared.joins.take()) return close(ROOM_CLOSE.flood, "joining too fast");
      const who = room.identify(resume);
      if (!room.admits(who.id)) return close(ROOM_CLOSE.full, "room full");
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on("error", () => ws.terminate());
        connect(ws, room, { ...who, name: name.data }, { limits, address, shared, now });
      });
    });
  });
  return wss;
}
