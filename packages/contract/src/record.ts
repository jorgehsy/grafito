// The session record: the saved file of a live session, written by the browser and read by the
// server's sessions store and eval script. Version 1 broke compatibility once and is rejected.
import { z } from "zod";

/** Bump when the system prompt or the tools Claude sees change; each request records it. */
export const PROMPT_VERSION = 2;

export const OUTDATED_RECORD = "This session was saved by an older grafito and cannot be restored.";

const ms = z.number().nullable();

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
  /** Ops as received; parsed again with parseOp on restore, since a record is not trusted. */
  ops: z.array(z.object({ name: z.string(), input: z.unknown() })),
  warnings: z.array(z.string()),
  usage: z.object({ input: z.number(), cacheRead: z.number(), cacheWrite: z.number(), output: z.number() }),
  costUsd: z.number(),
  error: z.string().optional(),
});

const recordSchema = z.object({
  version: z.literal(2),
  /** Also part of the file name on the server, hence the narrow alphabet. */
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  startedAt: z.number(),
  updatedAt: z.number(),
  model: z.string(),
  shape: z.string(),
  /** BCP 47 tag of the language setting. */
  speechLang: z.string(),
  requests: z.array(requestSchema),
  transcript: z.array(z.object({ text: z.string(), at: z.number() })),
  summary: z.string(),
  totals: z.object({ requests: z.number(), costUsd: z.number(), medianVoiceFirstMs: ms }),
});

export type SessionRecord = z.infer<typeof recordSchema>;
export type RecordRequest = SessionRecord["requests"][number];

export type ParsedRecord = { ok: true; record: SessionRecord } | { ok: false; error: string; outdated: boolean };

export function parseRecord(x: unknown): ParsedRecord {
  const version = x && typeof x === "object" ? (x as { version?: unknown }).version : undefined;
  if (version === 1) return { ok: false, error: OUTDATED_RECORD, outdated: true };
  const r = recordSchema.safeParse(x);
  if (r.success) return { ok: true, record: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: `${issue.path.join(".") || "record"}: ${issue.message}`, outdated: false };
}
