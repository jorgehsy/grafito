// The room protocol: what a browser and the server say to each other over a room's WebSocket.
// A room is one shared board. The server keeps its event log and makes the Claude calls; every browser applies
// the same events in the same order, so they all show the same board.
import { z } from "zod";

/** Room ids are short, lowercase and safe in a URL and a file name. */
export const ROOM_ID_PATTERN = /^[a-z0-9]{6,12}$/;
/** A room's invite token: what a browser must present to join. Crypto-random on the server, at least 128 bits, URL-safe. */
export const ROOM_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;
/**
 * The WebSocket subprotocols a browser offers when it joins: `ROOM_PROTOCOL` (the one the server answers with) and
 * `ROOM_KEY_PREFIX + <invite token>`. A browser cannot set headers on a WebSocket, and a token in the URL would
 * land in server and proxy logs; the subprotocol header does neither.
 */
export const ROOM_PROTOCOL = "grafito.room.v1";
export const ROOM_KEY_PREFIX = "k.";
/**
 * A third subprotocol a browser may offer: `ROOM_RESUME_PREFIX + <resume secret>`, the secret the server gave it
 * in `hello`. It is how a reconnect or a reload is the same participant: the server assigns participant ids,
 * a browser cannot choose one (or take someone else's).
 */
export const ROOM_RESUME_PREFIX = "r.";
/** Close codes the server uses to say why it ended a connection; a browser sees them, unlike an HTTP status on the upgrade. */
export const ROOM_CLOSE = {
  /** No such room, or the wrong invite token (the same answer on purpose). Do not reconnect. */
  refused: 4403,
  /** The room has all the people it takes. Do not reconnect. */
  full: 4409,
  /** This connection kept sending faster than the room allows. */
  flood: 4429,
} as const;
/** Why the server refused something a participant sent; the browser shows a message for each. */
export const ROOM_ERROR_CODES = ["rate", "busy", "calls_per_minute", "room_cap", "ink", "log_full"] as const;
export type RoomErrorCode = (typeof ROOM_ERROR_CODES)[number];
/** The participant id of Claude: it is in every room and cannot be taken by a person. */
export const CLAUDE_ID = "claude";
/** The colours people get, in join order. Claude keeps the graphite ink. */
export const PARTICIPANT_COLORS = ["#3E5E8C", "#C9622A", "#3E8C4F", "#8A4FA8", "#C03A3A", "#1C8C8C", "#C48A1C", "#B0447A"] as const;

const shortText = (max: number) => z.string().trim().min(1).max(max);
const coord = z.number().finite();

export const participantSchema = z.object({
  /** Stable per browser, so a reconnect is the same person. */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  name: shortText(40),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

/** One pen stroke in board coordinates; `pts` is flat (x0, y0, x1, y1…). The same shape as `Stroke` in @grafito/board. */
export const strokeSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  by: z.string().max(40),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  pts: z.array(coord).min(2).max(6000).refine((p) => p.length % 2 === 0, "odd number of coordinates"),
});

/** The sender's settings for the Claude request its message causes: the same four live mode sends. */
export const turnSettingsSchema = z.object({
  model: z.string().max(80),
  /** Shape preference: "auto" or a zone kind. */
  shape: z.string().max(20),
  catalogs: z.array(z.string().max(20)).max(8),
  lang: z.string().max(12),
});

/** A sketch handed to Claude: the strokes it covers, their description in text and, when it can be made, a picture. */
export const sketchSchema = z.object({
  strokeIds: z.array(z.string().max(40)).min(1).max(400),
  /** `describeSketch` output. */
  hints: z.string().max(40_000),
  /** PNG as base64 (no data: prefix). */
  image: z.string().max(6_000_000).optional(),
});

/** Browser to server. */
export const clientMessageSchema = z.discriminatedUnion("t", [
  /** A fragment of finished text (grouped speech or typed), already split at the wake word. */
  z.object({ t: z.literal("text"), text: shortText(8000), mode: z.enum(["content", "instruction"]), settings: turnSettingsSchema }),
  /** "Turn these strokes into board elements." */
  z.object({ t: z.literal("sketch"), sketch: sketchSchema, settings: turnSettingsSchema }),
  /** A finished stroke. */
  z.object({ t: z.literal("stroke"), stroke: strokeSchema }),
  /** The stroke being drawn right now, so others see it grow; null when it ends. Not logged. */
  z.object({ t: z.literal("draft"), stroke: strokeSchema.nullable() }),
  z.object({ t: z.literal("erase"), ids: z.array(z.string().max(40)).min(1).max(400) }),
  /** Where the pointer is in board coordinates; null when it leaves the board. Not logged. */
  z.object({ t: z.literal("cursor"), at: z.object({ x: coord, y: coord }).nullable() }),
  z.object({ t: z.literal("rename"), name: shortText(40) }),
  /** Wipes the board, the sketch and the log for everyone. */
  z.object({ t: z.literal("reset") }),
]);

const usageSchema = z.object({ input_tokens: z.number(), output_tokens: z.number(), cache_read_input_tokens: z.number(), cache_creation_input_tokens: z.number() });

/**
 * What the room log holds, in order. Replaying it from the start rebuilds the board, the sketch and the feed,
 * which is how someone who joins late catches up.
 */
const roomEventBody = z.discriminatedUnion("type", [
  /** What someone said or typed, or that they handed in a sketch (`text` is then its caption, possibly ""). */
  z.object({ type: z.literal("message"), by: z.string(), name: z.string(), text: z.string(), mode: z.enum(["content", "instruction", "sketch"]) }),
  /** One board op, as received: from Claude (`request` = its number) or from the seed the room was made with (`request` 0). */
  z.object({ type: z.literal("op"), op: z.object({ name: z.string(), input: z.unknown() }), request: z.number() }),
  /** Claude speaking to the room. */
  z.object({ type: z.literal("say"), text: z.string(), target: z.string().optional(), request: z.number() }),
  z.object({ type: z.literal("stroke"), stroke: strokeSchema }),
  /** Strokes removed: by a person's eraser, or by Claude (`by` = CLAUDE_ID) once it turned them into elements. */
  z.object({ type: z.literal("erase"), ids: z.array(z.string()), by: z.string() }),
  /** A Claude request starts. `batch` is the text sent: fragments joined, each with its speaker's name. */
  z.object({ type: z.literal("request"), n: z.number(), model: z.string(), mode: z.enum(["content", "instruction", "sketch"]), batch: z.string(), promptVersion: z.number() }),
  /** That request ended. `costUsd` is null for a plan model. */
  z.object({
    type: z.literal("request_end"), n: z.number(), firstOpMs: z.number().nullable(), totalMs: z.number(), ops: z.number(),
    usage: usageSchema, costUsd: z.number().nullable(), warnings: z.array(z.string()), error: z.string().optional(),
  }),
  /** The room was wiped: the log starts again from this event. */
  z.object({ type: z.literal("reset"), by: z.string() }),
]);
export const roomEventSchema = z.intersection(z.object({ seq: z.number(), at: z.number() }), roomEventBody);

export const claudeStatusSchema = z.enum(["idle", "thinking", "drawing"]);

/** Server to browser. */
export const serverMessageSchema = z.discriminatedUnion("t", [
  /** First message after connecting: who you are, who is here and the whole log so far. */
  z.object({
    t: z.literal("hello"), you: participantSchema,
    /** Present this (as a subprotocol) on the next connection to be the same participant. Only you are sent it. */
    resume: z.string().regex(ROOM_TOKEN_PATTERN).optional(),
    room: z.object({ id: z.string(), createdAt: z.number() }),
    participants: z.array(participantSchema), events: z.array(roomEventSchema), claude: claudeStatusSchema,
  }),
  z.object({ t: z.literal("event"), event: roomEventSchema }),
  z.object({ t: z.literal("presence"), participants: z.array(participantSchema) }),
  z.object({ t: z.literal("cursor"), id: z.string(), at: z.object({ x: coord, y: coord }).nullable() }),
  z.object({ t: z.literal("draft"), id: z.string(), stroke: strokeSchema.nullable() }),
  z.object({ t: z.literal("claude"), status: claudeStatusSchema }),
  /** `code` says which limit refused the message, when one did (`ROOM_ERROR_CODES`). */
  z.object({ t: z.literal("error"), message: z.string(), code: z.enum(ROOM_ERROR_CODES).optional() }),
]);

export type Participant = z.infer<typeof participantSchema>;
export type WireStroke = z.infer<typeof strokeSchema>;
export type TurnSettings = z.infer<typeof turnSettingsSchema>;
export type SketchPayload = z.infer<typeof sketchSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type RoomEvent = z.infer<typeof roomEventSchema>;
/** A room event before the server numbers and dates it. */
export type RoomEventBody = z.infer<typeof roomEventBody>;
export type ClaudeStatus = z.infer<typeof claudeStatusSchema>;

export type ParsedMessage<T> = { ok: true; message: T } | { ok: false; error: string };

function parseWith<T>(schema: z.ZodType<T>, x: unknown): ParsedMessage<T> {
  const r = schema.safeParse(x);
  if (r.success) return { ok: true, message: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: `${issue.path.join(".") || "message"}: ${issue.message}` };
}

/** What the server accepts from a browser. */
export const parseClientMessage = (x: unknown) => parseWith<ClientMessage>(clientMessageSchema, x);
/** What a browser accepts from the server. */
export const parseServerMessage = (x: unknown) => parseWith<ServerMessage>(serverMessageSchema, x);

/**
 * HTTP side of a room:
 * - `POST /api/rooms` with `{ ops?: {name, input}[] }` (a board to start from) answers `{ id, token }`.
 * - `GET /api/rooms/:id` answers `{ id, createdAt, participants }` or 404.
 * - WebSocket `/api/rooms/:id/ws?name=<name>`, offering the subprotocols `ROOM_PROTOCOL`,
 *   `ROOM_KEY_PREFIX + token` and, to come back as the same participant, `ROOM_RESUME_PREFIX + resume`. The share link is `?room=<id>#k=<token>`: the fragment never reaches a server.
 */
export const createRoomSchema = z.object({ ops: z.array(z.object({ name: z.string(), input: z.unknown() })).max(5000).optional() });
