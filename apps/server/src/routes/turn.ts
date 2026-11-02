// What POST /api/board and POST /api/architect share: picking the model and its adapter, validating
// catalogs, and streaming one Claude request back as SSE events (`op`, `usage`, `error`, `done`).
import type { Response } from "express";
import { MODELS, fallbackModel } from "@grafito/contract";
import type { Provider } from "@grafito/contract";
import { isCatalogId } from "@grafito/icons";
import type { ClaudeClient, ClaudeParams } from "../claude/client";

/** The adapters that are on, by provider. A missing provider is not available (no key, or the switch is off). */
export type Clients = Partial<Record<Provider, ClaudeClient>>;

/** Ids of the models whose provider has an adapter, in catalog order. */
export function availableModelIds(clients: Clients): string[] {
  return MODELS.filter((m) => clients[m.provider]).map((m) => m.id);
}

/**
 * The model to run and its adapter. An unknown or unavailable model falls back quietly to `fallback`, or to
 * `DEFAULT_MODEL` when `fallback` is the API twin of the requested plan model (`fallbackModel`); `client` is
 * missing when the fallback's provider is off too.
 */
export function pickModel(clients: Clients, model: unknown, fallback: string): { model: string; client: ClaudeClient | undefined } {
  const use = typeof model === "string" && availableModelIds(clients).includes(model) ? model : fallbackModel(model, fallback);
  return { model: use, client: clients[MODELS.find((m) => m.id === use)!.provider] };
}

/** `catalogs` from the body: an array of known catalog ids (absent = off). Returns the error message or null. */
export function validateCatalogs(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return `Invalid catalogs: ${JSON.stringify(raw)}`;
  const bad = raw.find((c) => !isCatalogId(c));
  return bad === undefined ? null : `Invalid catalog: ${JSON.stringify(bad)}`;
}

export function openSse(res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
}

export function sse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Sends one `error` event and ends the response. */
export function sseFail(res: Response, message: string) {
  sse(res, "error", { message });
  res.end();
}

/**
 * Streams one request to Claude as SSE and ends the response. `done` carries usage, timings, the op count,
 * the model and `doneExtra`. A client that disconnects aborts the upstream request.
 */
export async function streamTurn(res: Response, client: ClaudeClient, params: ClaudeParams, doneExtra: Record<string, unknown> = {}) {
  const t0 = Date.now();
  let firstOp: number | null = null;
  let ops = 0;
  const abort = new AbortController();
  res.on("close", () => abort.abort());

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
          model: params.model,
          ...doneExtra,
        });
      }
    }
  } catch (e: any) {
    if (!abort.signal.aborted) {
      // Login and plan-limit errors already say it all; the status would only add noise.
      const status = e?.status && e.status !== 401 && e.status !== 402 ? ` (HTTP ${e.status})` : "";
      sse(res, "error", { message: `Error calling Claude${status}: ${e?.message ?? e}` });
    }
  }
  res.end();
}
