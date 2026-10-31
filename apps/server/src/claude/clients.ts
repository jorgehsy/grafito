import { anthropicClient, hasApiKey } from "./anthropic";
import { subscriptionClient } from "./subscription";
import type { Clients } from "../routes/board";

/** The adapters to turn on: the API one needs a usable key, the subscription one is opt-in (it runs on the owner's Claude plan). */
export function buildClients(opts: { apiKey?: string; subscription: boolean }): Clients {
  const clients: Clients = {};
  if (hasApiKey(opts.apiKey)) clients["anthropic-api"] = anthropicClient(opts.apiKey);
  if (opts.subscription) clients["claude-subscription"] = subscriptionClient();
  return clients;
}
