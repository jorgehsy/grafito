// One request of the board kind as Claude gets it: the same for POST /api/board and for a room, so a room
// is live mode with more people in it and nothing else differs.
import { sketchSchema } from "@grafito/contract";
import type { Lang } from "@grafito/contract";
import type { ClaudeParams } from "../claude/client";
import { ROOM_RULES } from "./room";
import { SKETCH_RULES } from "./sketch";
import { systemPrompt } from "./system";
import { buildUserText } from "./user-text";
import type { BoardMode } from "./user-text";

/** A sketch as a request carries it: its description in text and, when one could be made, its picture. */
export interface TurnSketch {
  hints: string;
  /** PNG as base64, no `data:` prefix. */
  image?: string;
}

const sketchBody = sketchSchema.omit({ strokeIds: true });
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** `sketch` from a request body: `{ hints, image? }`, the image as base64 with or without a `data:` prefix. Null when malformed. */
export function parseSketch(raw: unknown): TurnSketch | null {
  const r = sketchBody.safeParse(raw);
  if (!r.success || !r.data.hints.trim()) return null;
  if (r.data.image === undefined) return { hints: r.data.hints };
  const image = r.data.image.replace(/^data:image\/png;base64,/, "");
  return BASE64.test(image) ? { hints: r.data.hints, image } : null;
}

export interface BoardTurn {
  model: string;
  mode: BoardMode;
  /** The batch: spoken fragments, an instruction, or what the user typed about a sketch (may be empty then). */
  delta: string;
  board?: unknown;
  summary?: unknown;
  shape?: unknown;
  catalogs: readonly string[];
  lang: Lang;
  /** Sketch mode only. */
  sketch?: TurnSketch;
  /** The request comes from a room: the room rules and the `room` op set (the board ops plus `say`). */
  room?: boolean;
}

/**
 * The system prompt keeps its cached prefix and its last line (the language); the room and sketch rules go
 * between them, outside the cache, so they cost nothing to the requests that do not need them.
 */
export function boardTurnParams(a: BoardTurn): ClaudeParams {
  const base = systemPrompt({ catalogs: a.catalogs, lang: a.lang });
  const extra = [...(a.room ? [{ text: ROOM_RULES }] : []), ...(a.mode === "sketch" ? [{ text: SKETCH_RULES }] : [])];
  const thoughtful = a.mode !== "content";
  return {
    model: a.model,
    maxTokens: thoughtful ? 8192 : 4096,
    effort: thoughtful ? "medium" : "low",
    system: [...base.slice(0, -1), ...extra, ...base.slice(-1)],
    userText: buildUserText({ board: a.board, summary: a.summary, delta: a.delta, shape: a.shape, mode: a.mode, sketch: a.sketch?.hints }),
    ...(a.mode === "sketch" && a.sketch?.image ? { image: { mediaType: "image/png" as const, data: a.sketch.image } } : {}),
    catalogs: a.catalogs,
    opSet: a.room ? "room" : "board",
  };
}
