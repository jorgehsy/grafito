import type { Request, Response } from "express";
import { DEFAULT_LANG, DEFAULT_MODEL, ZONE_KINDS, isLang, normalizeCatalogs } from "@grafito/contract";
import { boardTurnParams, parseSketch } from "../prompt/board-turn";
import type { BoardMode } from "../prompt/user-text";
import { openSse, pickModel, sseFail, streamTurn, validateCatalogs } from "./turn";
import type { Clients } from "./turn";

/**
 * `POST /api/board`: validates the request, streams Claude's ops back over SSE
 * (events `op`, `usage`, `error`, `done`). The adapter is picked by the model's provider; an API model
 * whose provider is off falls back to `DEFAULT_MODEL`; a plan model with the switch off is an error.
 * `mode: "sketch"` carries `sketch: { hints, image? }` (the user's ink described in text, and its picture as
 * base64 PNG); `delta` is then what the user typed about it and may be empty.
 */
export function createBoardHandler(clients: Clients) {
  return async function boardHandler(req: Request, res: Response) {
    openSse(res);
    const { delta, summary, board, model, shape, mode: rawMode, catalogs: rawCatalogs, lang: rawLang, sketch: rawSketch } = req.body ?? {};
    const picked = pickModel(clients, model, DEFAULT_MODEL);
    if ("error" in picked) return sseFail(res, picked.error);
    const { model: useModel, client } = picked;
    if (rawMode !== undefined && rawMode !== "content" && rawMode !== "instruction" && rawMode !== "sketch")
      return sseFail(res, `Invalid mode: ${JSON.stringify(rawMode)}`);
    const mode: BoardMode = rawMode ?? "content";
    const sketch = mode === "sketch" ? parseSketch(rawSketch) : undefined;
    if (sketch === null) return sseFail(res, "Invalid sketch: expected {hints, image?} with the image as base64 PNG");
    if (mode === "sketch" ? delta !== undefined && typeof delta !== "string" : typeof delta !== "string" || !delta.trim())
      return sseFail(res, "The text is empty");
    if (shape !== undefined && shape !== "auto" && !(ZONE_KINDS as readonly string[]).includes(shape))
      return sseFail(res, `Invalid shape: ${JSON.stringify(shape)}`);
    const badCatalogs = validateCatalogs(rawCatalogs);
    if (badCatalogs) return sseFail(res, badCatalogs);
    const catalogs = normalizeCatalogs(rawCatalogs ?? []);
    // Like the model, an unknown language falls back instead of failing the request.
    const lang = isLang(rawLang) ? rawLang : DEFAULT_LANG;

    await streamTurn(res, client, boardTurnParams({ model: useModel, mode, delta: delta ?? "", board, summary, shape, catalogs, lang, sketch }), { mode });
  };
}
