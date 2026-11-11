import type { Request, Response } from "express";
import { ARCHITECT_DEFAULT_MODEL, DEFAULT_LANG, isLang, normalizeCatalogs, parseClicks } from "@grafito/contract";
import { isBestPracticeId } from "@grafito/wellarchitected";
import type { ClaudeClient } from "../claude/client";
import { architectSystemPrompt, buildArchitectUserText } from "../prompt/architect";
import type { RecentTurn } from "../prompt/architect";
import { parseSketch } from "../prompt/board-turn";
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

/** The longest `review` text a turn may carry: far above what a review of 8 findings takes. */
const MAX_REVIEW = 20_000;

/**
 * A finding may only cite a best practice the digest has. One that does not exist is dropped from the finding,
 * with a warning; the finding itself stays.
 */
export function knownPracticesOnly(client: ClaudeClient): ClaudeClient {
  return {
    async *stream(params, signal) {
      for await (const ev of client.stream(params, signal)) {
        if (ev.type === "op" && ev.op.name === "add_finding" && ev.op.input.best_practice !== undefined && !isBestPracticeId(ev.op.input.best_practice)) {
          const { best_practice, ...input } = ev.op.input;
          yield { type: "op", op: { name: "add_finding", input } };
          yield { type: "invalid", name: "add_finding", warning: `add_finding: best practice '${best_practice}' is not in the Well-Architected digest; left out` };
        } else yield ev;
      }
    },
  };
}

/**
 * `POST /api/architect`: one architect turn. Same SSE events, adapters and retry rule as `POST /api/board`,
 * with the architect prompt and op set. Body: `text` (required, unless a sketch comes with it), `board`, `summary`,
 * `review` (the Well-Architected review so far, as text), `recent`, `actions` (proposals the user accepted or
 * rejected by click since the last turn), `sketch` (`{ hints, image? }`: the user's ink described in text and its
 * picture as base64 PNG, as `POST /api/board` takes it), `model`, `lang`, `catalogs`. An
 * unknown or unavailable API model falls back to `ARCHITECT_DEFAULT_MODEL`; a plan model with the switch off is an error.
 */
export function createArchitectHandler(clients: Clients) {
  return async function architectHandler(req: Request, res: Response) {
    openSse(res);
    const { text: rawText, board, summary, review, recent: rawRecent, actions: rawActions, sketch: rawSketch, model, catalogs: rawCatalogs, lang: rawLang } = req.body ?? {};
    const picked = pickModel(clients, model, ARCHITECT_DEFAULT_MODEL);
    if ("error" in picked) return sseFail(res, picked.error);
    const { model: useModel, client } = picked;
    const sketch = rawSketch === undefined ? undefined : parseSketch(rawSketch);
    if (sketch === null) return sseFail(res, "Invalid sketch: expected {hints, image?} with the image as base64 PNG");
    // A sketch is a message of its own: the text with it may be empty or absent.
    const text = rawText === undefined && sketch ? "" : rawText;
    if (typeof text !== "string" || (!text.trim() && !sketch)) return sseFail(res, "The text is empty");
    if (review !== undefined && (typeof review !== "string" || review.length > MAX_REVIEW)) return sseFail(res, "Invalid review: expected text");
    const recent = parseRecent(rawRecent);
    if (!recent) return sseFail(res, "Invalid recent: expected a list of {text, bubble}");
    const actions = parseClicks(rawActions);
    if (!actions) return sseFail(res, "Invalid actions: expected a list of {type: accept | reject, proposal}");
    const badCatalogs = validateCatalogs(rawCatalogs);
    if (badCatalogs) return sseFail(res, badCatalogs);
    const catalogs = normalizeCatalogs(rawCatalogs ?? []);
    const lang = isLang(rawLang) ? rawLang : DEFAULT_LANG;

    await streamTurn(res, knownPracticesOnly(client), {
      model: useModel,
      maxTokens: MAX_TOKENS,
      effort: "medium",
      adaptiveThinking: true,
      system: architectSystemPrompt({ catalogs, lang, sketch: !!sketch }),
      userText: buildArchitectUserText({ board, summary, review, recent, actions, sketch: sketch?.hints, text }),
      ...(sketch?.image ? { image: { mediaType: "image/png" as const, data: sketch.image } } : {}),
      catalogs,
      opSet: "architect",
    });
  };
}
