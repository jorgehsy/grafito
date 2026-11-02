import type { Request, Response } from "express";
import { ARCHITECT_DEFAULT_MODEL, DEFAULT_LANG, isLang, normalizeCatalogs, parseActions } from "@grafito/contract";
import { architectSystemPrompt, buildArchitectUserText } from "../prompt/architect";
import type { RecentTurn } from "../prompt/architect";
import { openSse, pickModel, sseFail, streamTurn, validateCatalogs } from "./turn";
import type { Clients } from "./turn";

/** Thinking counts against it, so it is well above what the ops of one turn need. */
const MAX_TOKENS = 16000;

/** `recent` from the body: absent, or a list of `{text, bubble?}`. Null when malformed. */
function parseRecent(raw: unknown): RecentTurn[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const out: RecentTurn[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const { text, bubble } = r as { text?: unknown; bubble?: unknown };
    if (typeof text !== "string" || (bubble !== undefined && typeof bubble !== "string")) return null;
    out.push({ text, bubble: bubble ?? "" });
  }
  return out;
}

/**
 * `POST /api/architect`: one architect turn. Same SSE events, adapters and retry rule as `POST /api/board`,
 * with the architect prompt and op set. Body: `text` (required), `board`, `summary`, `recent`, `actions`
 * (proposals the user accepted or rejected by click since the last turn), `model`, `lang`, `catalogs`. An
 * unknown or unavailable model falls back to `ARCHITECT_DEFAULT_MODEL`.
 */
export function createArchitectHandler(clients: Clients) {
  return async function architectHandler(req: Request, res: Response) {
    openSse(res);
    const { text, board, summary, recent: rawRecent, actions: rawActions, model, catalogs: rawCatalogs, lang: rawLang } = req.body ?? {};
    const { model: useModel, client } = pickModel(clients, model, ARCHITECT_DEFAULT_MODEL);
    if (!client) return sseFail(res, "Missing API key in .env");
    if (typeof text !== "string" || !text.trim()) return sseFail(res, "The text is empty");
    const recent = parseRecent(rawRecent);
    if (!recent) return sseFail(res, "Invalid recent: expected a list of {text, bubble}");
    const actions = parseActions(rawActions);
    if (!actions) return sseFail(res, "Invalid actions: expected a list of {type: accept | reject, proposal}");
    const badCatalogs = validateCatalogs(rawCatalogs);
    if (badCatalogs) return sseFail(res, badCatalogs);
    const catalogs = normalizeCatalogs(rawCatalogs ?? []);
    const lang = isLang(rawLang) ? rawLang : DEFAULT_LANG;

    await streamTurn(res, client, {
      model: useModel,
      maxTokens: MAX_TOKENS,
      effort: "medium",
      adaptiveThinking: true,
      system: architectSystemPrompt({ catalogs, lang }),
      userText: buildArchitectUserText({ board, summary, recent, actions, text }),
      catalogs,
      opSet: "architect",
    });
  };
}
