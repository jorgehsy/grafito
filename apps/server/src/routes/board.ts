import type { Request, Response } from "express";
import { DEFAULT_LANG, DEFAULT_MODEL, ZONE_KINDS, isLang, normalizeCatalogs } from "@grafito/contract";
import { systemPrompt } from "../prompt/system";
import { buildUserText } from "../prompt/user-text";
import type { BoardMode } from "../prompt/user-text";
import { openSse, pickModel, sseFail, streamTurn, validateCatalogs } from "./turn";
import type { Clients } from "./turn";

/**
 * `POST /api/board`: validates the request, streams Claude's ops back over SSE
 * (events `op`, `usage`, `error`, `done`). The adapter is picked by the model's provider; a model
 * whose provider is off falls back to `DEFAULT_MODEL` (never to the API twin of a plan model).
 */
export function createBoardHandler(clients: Clients) {
  return async function boardHandler(req: Request, res: Response) {
    openSse(res);
    const { delta, summary, board, model, shape, mode: rawMode, catalogs: rawCatalogs, lang: rawLang } = req.body ?? {};
    const { model: useModel, client } = pickModel(clients, model, DEFAULT_MODEL);
    if (!client) return sseFail(res, "Missing API key in .env");
    if (typeof delta !== "string" || !delta.trim()) return sseFail(res, "The text is empty");
    if (shape !== undefined && shape !== "auto" && !(ZONE_KINDS as readonly string[]).includes(shape))
      return sseFail(res, `Invalid shape: ${JSON.stringify(shape)}`);
    if (rawMode !== undefined && rawMode !== "content" && rawMode !== "instruction")
      return sseFail(res, `Invalid mode: ${JSON.stringify(rawMode)}`);
    const badCatalogs = validateCatalogs(rawCatalogs);
    if (badCatalogs) return sseFail(res, badCatalogs);
    const catalogs = normalizeCatalogs(rawCatalogs ?? []);
    const mode: BoardMode = rawMode === "instruction" ? "instruction" : "content";
    // Like the model, an unknown language falls back instead of failing the request.
    const lang = isLang(rawLang) ? rawLang : DEFAULT_LANG;

    await streamTurn(res, client, {
      model: useModel,
      maxTokens: mode === "instruction" ? 8192 : 4096,
      effort: mode === "instruction" ? "medium" : "low",
      system: systemPrompt({ catalogs, lang }),
      userText: buildUserText({ board, summary, delta, shape, mode }),
      catalogs,
      opSet: "board",
    }, { mode });
  };
}
