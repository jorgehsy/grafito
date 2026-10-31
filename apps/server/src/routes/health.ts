import type { Request, Response } from "express";
import { availableModelIds } from "./board";
import type { Clients } from "./board";

/** `GET /api/health`: whether the server is up, whether an API key is set, and which model ids can be used. */
export function createHealthHandler(clients: Clients) {
  return function healthHandler(_req: Request, res: Response) {
    res.json({ ok: true, hasKey: !!clients["anthropic-api"], models: availableModelIds(clients) });
  };
}
