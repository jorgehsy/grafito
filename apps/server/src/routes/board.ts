import type { Request, Response } from "express";
import { DEFAULT_LANG, DEFAULT_MODEL, ZONE_KINDS, isLang, isModelId, normalizeCatalogs } from "@grafito/contract";
import { isCatalogId } from "@grafito/icons";
import type { ClaudeClient } from "../claude/client";
import { systemPrompt } from "../prompt/system";
import { buildUserText } from "../prompt/user-text";
import type { BoardMode } from "../prompt/user-text";

/** `catalogs` from the body: an array of known catalog ids (absent = off). Returns the error message or null. */
function validateCatalogs(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return `Invalid catalogs: ${JSON.stringify(raw)}`;
  const bad = raw.find((c) => !isCatalogId(c));
  return bad === undefined ? null : `Invalid catalog: ${JSON.stringify(bad)}`;
}

function sse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * `POST /api/board`: validates the request, streams Claude's ops back over SSE
 * (events `op`, `usage`, `error`, `done`). `client` is null when there is no usable API key.
 */
export function createBoardHandler(client: ClaudeClient | null) {
  return async function boardHandler(req: Request, res: Response) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    if (!client) {
      sse(res, "error", { message: "Missing API key in .env" });
      return res.end();
    }
    const { delta, summary, board, model, shape, mode: rawMode, catalogs: rawCatalogs, lang: rawLang } = req.body ?? {};
    if (typeof delta !== "string" || !delta.trim()) {
      sse(res, "error", { message: "The text is empty" });
      return res.end();
    }
    if (shape !== undefined && shape !== "auto" && !(ZONE_KINDS as readonly string[]).includes(shape)) {
      sse(res, "error", { message: `Invalid shape: ${JSON.stringify(shape)}` });
      return res.end();
    }
    if (rawMode !== undefined && rawMode !== "content" && rawMode !== "instruction") {
      sse(res, "error", { message: `Invalid mode: ${JSON.stringify(rawMode)}` });
      return res.end();
    }
    const badCatalogs = validateCatalogs(rawCatalogs);
    if (badCatalogs) {
      sse(res, "error", { message: badCatalogs });
      return res.end();
    }
    const catalogs = normalizeCatalogs(rawCatalogs ?? []);
    const mode: BoardMode = rawMode === "instruction" ? "instruction" : "content";
    const useModel = isModelId(model) ? model : DEFAULT_MODEL;
    // Like the model, an unknown language falls back instead of failing the request.
    const lang = isLang(rawLang) ? rawLang : DEFAULT_LANG;

    const t0 = Date.now();
    let firstOp: number | null = null;
    let ops = 0;
    const abort = new AbortController();
    res.on("close", () => abort.abort());

    const params = {
      model: useModel,
      maxTokens: mode === "instruction" ? 8192 : 4096,
      effort: mode === "instruction" ? ("medium" as const) : ("low" as const),
      system: systemPrompt({ catalogs, lang }),
      userText: buildUserText({ board, summary, delta, shape, mode }),
      catalogs,
    };

    try {
      for await (const ev of client.stream(params, abort.signal)) {
        if (ev.type === "op") {
          if (firstOp === null) firstOp = Date.now() - t0;
          ops++;
          sse(res, "op", ev.op);
        } else if (ev.type === "invalid") {
          sse(res, "op", { invalid: true, name: ev.name, warning: ev.warning });
        } else if (ev.type === "usage") {
          sse(res, "usage", ev.estimated ? { ...ev.usage, estimated: true } : { ...ev.usage });
        } else {
          if (ev.stopReason === "refusal") sse(res, "error", { message: "The model refused the request (refusal)" });
          else if (ev.stopReason === "max_tokens") sse(res, "error", { message: "Response cut off by max_tokens" });
          sse(res, "done", {
            usage: { ...ev.usage },
            timings: { first_op_ms: firstOp, total_ms: Date.now() - t0 },
            ops,
            model: useModel,
            mode,
          });
        }
      }
    } catch (e: any) {
      if (!abort.signal.aborted) {
        const status = e?.status ? ` (HTTP ${e.status})` : "";
        sse(res, "error", { message: `Error calling Claude${status}: ${e?.message ?? e}` });
      }
    }
    res.end();
  };
}
