// Session record: everything needed to analyze a session offline.
// Pure, except the localStorage/save helpers, which tolerate missing dependencies.
import type { Op } from "@grafito/contract";
import type { LogEntry, Totals } from "./session";
import { CATALOG_IDS, parseOp, zeroUsage } from "@grafito/contract";
import { t } from "../i18n";

export interface RecordRequest {
  n: number;
  model: string;
  /** Full text sent, untruncated. */
  text: string;
  /** Absent in old records: content. */
  mode?: "content" | "instruction";
  undone?: boolean;
  startedAt: number;
  firstOpMs: number | null;
  voiceFirstMs: number | null;
  totalMs: number | null;
  /** Valid ops received, in order. */
  ops: { name: string; input: unknown }[];
  /** Warnings for invalid ops. */
  invalid: string[];
  usage: { input: number; cacheRead: number; cacheWrite: number; output: number };
  costUsd: number;
  error?: string;
}
export interface SessionRecord {
  version: 1;
  id: string;
  startedAt: number;
  updatedAt: number;
  model: string;
  /** Shape preference; may be missing in old records. */
  shape?: string;
  lang: string;
  requests: RecordRequest[];
  transcript: { text: string; at: number }[];
  summary: string;
  totals: { requests: number; costUsd: number; medianVoiceFirstMs: number | null };
}

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export const newSessionId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export interface RecordMeta {
  id: string;
  startedAt: number;
  model: string;
  shape?: string;
  lang: string;
  transcript: { text: string; at: number }[];
  summary: string;
}

export function buildRecord(meta: RecordMeta, entries: LogEntry[], totals: Totals, now = Date.now()): SessionRecord {
  return {
    version: 1,
    id: meta.id,
    startedAt: meta.startedAt,
    updatedAt: now,
    model: meta.model,
    shape: meta.shape,
    lang: meta.lang,
    requests: entries.map((e) => ({
      n: e.id,
      model: e.model,
      text: e.batch,
      mode: e.mode,
      ...(e.undone ? { undone: true } : {}),
      startedAt: e.startedAt,
      firstOpMs: e.firstOpMs,
      voiceFirstMs: e.voiceFirstMs,
      totalMs: e.totalMs,
      ops: e.opList.map((o) => ({ name: o.name, input: (o as any).input })),
      invalid: [...e.warnings],
      usage: { input: e.usage.input_tokens, cacheRead: e.usage.cache_read_input_tokens, cacheWrite: e.usage.cache_creation_input_tokens, output: e.usage.output_tokens },
      costUsd: e.costUsd,
      ...(e.error ? { error: e.error } : {}),
    })),
    transcript: meta.transcript.map((t) => ({ ...t })),
    summary: meta.summary,
    totals: {
      requests: totals.requests,
      costUsd: totals.costUsd,
      medianVoiceFirstMs: median(entries.filter((e) => e.voiceFirstMs !== null).map((e) => e.voiceFirstMs as number)),
    },
  };
}

/**
 * Recorded ops parsed again: a record from disk, localStorage or a file is not trusted.
 * Every known catalog is on, since the record does not say which were. Invalid ops are
 * dropped and their message joins the request's warnings.
 */
function parseRecordedOps(ops: unknown[]): { opList: Op[]; invalid: string[] } {
  const opList: Op[] = [];
  const invalid: string[] = [];
  for (const o of ops) {
    const p = parseOp(o, CATALOG_IDS);
    if (p.ok) opList.push(p.op);
    else invalid.push(p.error);
  }
  return { opList, invalid };
}

/** Rebuilds the log rows and totals from a saved record. */
export function entriesFromRecord(rec: SessionRecord): { entries: LogEntry[]; totals: Totals } {
  const entries: LogEntry[] = rec.requests.map((r) => {
    const { opList, invalid } = parseRecordedOps(r.ops);
    return {
      id: r.n,
      model: r.model,
      batch: r.text,
      mode: r.mode === "instruction" ? "instruction" : "content",
      ...(r.undone ? { undone: true } : {}),
      startedAt: r.startedAt,
      firstOpMs: r.firstOpMs,
      voiceFirstMs: r.voiceFirstMs,
      totalMs: r.totalMs,
      ops: opList.length,
      opList,
      usage: { input_tokens: r.usage.input, output_tokens: r.usage.output, cache_read_input_tokens: r.usage.cacheRead, cache_creation_input_tokens: r.usage.cacheWrite },
      usageEstimated: false,
      costUsd: r.costUsd,
      warnings: [...r.invalid, ...invalid],
      error: r.error,
      done: true,
    };
  });
  const usage = entries.reduce((a, e) => ({
    input_tokens: a.input_tokens + e.usage.input_tokens,
    output_tokens: a.output_tokens + e.usage.output_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + e.usage.cache_read_input_tokens,
    cache_creation_input_tokens: a.cache_creation_input_tokens + e.usage.cache_creation_input_tokens,
  }), zeroUsage());
  return { entries, totals: { requests: rec.totals?.requests ?? entries.length, usage, costUsd: rec.totals?.costUsd ?? entries.reduce((a, e) => a + e.costUsd, 0) } };
}

/** Minimal validation of a record read from disk, localStorage or a file. */
export function isRecord(x: any): x is SessionRecord {
  return !!x && typeof x === "object" && x.version === 1 && typeof x.id === "string" && Array.isArray(x.requests) && Array.isArray(x.transcript);
}

const LS_KEY = "grafito.sessionRecord";
export function saveLocal(rec: SessionRecord) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(rec)); } catch { /* storage unavailable: ignored */ }
}
export function loadLocal(): SessionRecord | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const r = raw ? JSON.parse(raw) : null;
    return isRecord(r) ? r : null;
  } catch { return null; }
}
export function clearLocal() {
  try { localStorage.removeItem(LS_KEY); } catch { /* storage unavailable: ignored */ }
}

/** Saves to the server (sessions/). Returns null on success, or the error message. */
export async function postRecord(rec: SessionRecord, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl("/api/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) });
    return res.ok ? null : `HTTP ${res.status}`;
  } catch (e: any) {
    return e?.message ?? t("net.offline");
  }
}

/** Ops to replay on restore or undo: those of the rows not undone. */
export function replayOps(entries: LogEntry[]): Op[] {
  return entries.filter((e) => !e.undone).flatMap((e) => e.opList);
}
