// Converts a version 1 session record (0.2.0-alpha.4 and earlier) to version 2, so old recordings,
// such as the eval baseline, can be replayed. The record is not trusted: the result goes through parseRecord.
import { parseRecord } from "@grafito/contract";
import type { SessionRecord } from "@grafito/contract";

/** Every version 1 request was answered by the Spanish prompt, which is prompt version 1. */
const V1_PROMPT_VERSION = 1;

type V1Request = Record<string, unknown> & { text?: unknown; invalid?: unknown; mode?: unknown };

export function convertV1(x: unknown): SessionRecord {
  if (!x || typeof x !== "object" || (x as { version?: unknown }).version !== 1) throw new Error("not a version 1 session record");
  const { lang, shape, requests, ...rest } = x as Record<string, unknown>;
  const converted = {
    ...rest,
    version: 2,
    shape: shape ?? "auto",
    speechLang: lang,
    requests: Array.isArray(requests)
      ? requests.map((r: V1Request) => {
          const { text, invalid, mode, ...kept } = r;
          return { ...kept, promptVersion: V1_PROMPT_VERSION, batch: text, mode: mode ?? "content", warnings: invalid ?? [] };
        })
      : requests,
  };
  const parsed = parseRecord(converted);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.record;
}
