// The session record: the saved file of a live or architect session, written by the browser and read by the
// server's sessions store and eval script. Version 3 says which app mode made it (`appMode`); version 2 records
// are live records and are read as version 3. Version 1 broke compatibility once and is rejected.
import { z } from "zod";

/** Bump when the system prompt or the tools Claude sees change; each request records it. */
export const PROMPT_VERSION = 3;

/**
 * Architect mode's own counter, stamped in each architect turn's `promptVersion` (the record's `appMode` says
 * which counter a number belongs to). Bump it on every change to the architect prompt, the Well-Architected
 * digest or the architect tools; apps/server/src/prompt/architect.test.ts pins their hash to this value.
 */
export const ARCHITECT_PROMPT_VERSION = 5;

export const RECORD_VERSION = 3;

export const OUTDATED_RECORD = "This session was saved by an older grafito and cannot be restored.";

const ms = z.number().nullable();
const usageSchema = z.object({ input: z.number(), cacheRead: z.number(), cacheWrite: z.number(), output: z.number() });
/** Ops as received; parsed again with parseOp on restore, since a record is not trusted. */
const opsSchema = z.array(z.object({ name: z.string(), input: z.unknown() }));

const requestSchema = z.object({
  n: z.number(),
  model: z.string(),
  promptVersion: z.number(),
  /** The batch sent, untruncated. */
  batch: z.string(),
  mode: z.enum(["content", "instruction"]),
  undone: z.boolean().optional(),
  startedAt: z.number(),
  firstOpMs: ms,
  voiceFirstMs: ms,
  totalMs: ms,
  ops: opsSchema,
  warnings: z.array(z.string()),
  usage: usageSchema,
  costUsd: z.number(),
  error: z.string().optional(),
});

const header = {
  version: z.literal(RECORD_VERSION),
  /** Also part of the file name on the server, hence the narrow alphabet. */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  startedAt: z.number(),
  updatedAt: z.number(),
  model: z.string(),
  /** BCP 47 tag of the language setting. */
  speechLang: z.string(),
  summary: z.string(),
};

const liveSchema = z.object({
  ...header,
  appMode: z.literal("live"),
  shape: z.string(),
  requests: z.array(requestSchema),
  transcript: z.array(z.object({ text: z.string(), at: z.number() })),
  totals: z.object({ requests: z.number(), costUsd: z.number(), medianVoiceFirstMs: ms }),
});

/** One architect turn: what the user typed and Claude's ops (`say` included) as they arrived. */
const turnSchema = z.object({
  kind: z.literal("turn"),
  n: z.number(),
  text: z.string(),
  model: z.string(),
  /** ARCHITECT_PROMPT_VERSION when the turn was sent. */
  promptVersion: z.number(),
  startedAt: z.number(),
  totalMs: ms,
  ops: opsSchema,
  warnings: z.array(z.string()),
  usage: usageSchema,
  costUsd: z.number(),
  /** A turn that broke halfway keeps the ops that arrived. */
  error: z.string().optional(),
});

/** One click on a proposal. Choosing an alternative is an accept. */
const clickSchema = z.object({
  kind: z.literal("click"),
  type: z.enum(["accept", "reject"]),
  proposal: z.string(),
  at: z.number(),
});

/**
 * An architect session. Bubble markers, the open bubble, `recent` and the open proposals are not stored: replaying
 * the timeline rebuilds them. A turn's `actions` are the clicks between it and the turn before.
 */
const architectSchema = z.object({
  ...header,
  appMode: z.literal("architect"),
  /** Turns and clicks in the order they happened. */
  timeline: z.array(z.discriminatedUnion("kind", [turnSchema, clickSchema])),
  /** Architect mode has no voice: `medianVoiceFirstMs` is always null. */
  totals: z.object({ requests: z.number(), costUsd: z.number(), medianVoiceFirstMs: z.null() }),
});

const recordSchema = z.discriminatedUnion("appMode", [liveSchema, architectSchema]);

export type SessionRecord = z.infer<typeof recordSchema>;
export type LiveRecord = z.infer<typeof liveSchema>;
export type ArchitectRecord = z.infer<typeof architectSchema>;
export type AppMode = SessionRecord["appMode"];
export type RecordRequest = LiveRecord["requests"][number];
export type TimelineEntry = ArchitectRecord["timeline"][number];
export type RecordTurn = Extract<TimelineEntry, { kind: "turn" }>;
export type RecordClick = Extract<TimelineEntry, { kind: "click" }>;

export type ParsedRecord = { ok: true; record: SessionRecord } | { ok: false; error: string; outdated: boolean };

/** Version 2 had live mode only: the same body without `appMode`. */
const fromV2 = (x: object) => ({ ...x, version: RECORD_VERSION, appMode: "live" });

export function parseRecord(x: unknown): ParsedRecord {
  const version = x && typeof x === "object" ? (x as { version?: unknown }).version : undefined;
  if (version === 1) return { ok: false, error: OUTDATED_RECORD, outdated: true };
  const r = recordSchema.safeParse(version === 2 ? fromV2(x as object) : x);
  if (r.success) return { ok: true, record: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: `${issue.path.join(".") || "record"}: ${issue.message}`, outdated: false };
}
