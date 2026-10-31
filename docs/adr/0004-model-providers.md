# Models carry a provider; the Claude subscription is one, local only

Status: accepted (implementation: #24–#28)

Grafito called Claude through one adapter, the Anthropic API. The owner also wants to run the same board on their Claude subscription, and later on other models (ChatGPT, Gemma). Each of those is billed, authenticated and called differently.

We decided:

- **Every model in the registry has a `provider`** (`anthropic-api` or `claude-subscription`) and an `apiModel`, the name sent to the provider. The id stays what the request carries, so one model can be offered twice: `claude-sonnet-5-5` (API) and `claude-sonnet-5-5@subscription` (plan). `packages/contract/src/models.ts` stays the single source of truth. Plan models have `price: null` and show "included in plan", never dollars.
- **The server holds one `ClaudeClient` per provider** (`Clients` in `routes/board.ts`, built by `claude/clients.ts`). The route picks the client from the model's provider; `/api/health` lists the available model ids and the UI offers only those.
- **The subscription adapter uses the Agent SDK** (`claude/subscription.ts`), not `claude -p`: it gives partial stream events, which are mapped to the raw events `claude/stream.ts` already reads, so buffering, `parseOp` and the SSE timing are the same as with the API. The ops are tools of an in-process MCP server that serves the `toolDefs` JSON Schemas as they are and answers "ok" to every call. Claude Code's own tools, settings files and other MCP servers are off.
- **One turn only** (`maxTurns: 1`), like the API adapter. With more turns Claude repeated ops after the "ok" results.
- **The API key is stripped from the SDK env** (also the auth token, base URL, Bedrock, Vertex and Foundry switches), so a plan call can never bill the API. Login is `CLAUDE_CODE_OAUTH_TOKEN` if set, else the local `claude` login.
- **Off by default and local only.** `GRAFITO_SUBSCRIPTION=1` turns it on. Anthropic does not allow an app to offer claude.ai login to other people, so this is for the owner's own machine and must not be hosted for others.
- **Fallback never reaches the paid twin.** A request (or restored session) naming an unavailable model uses `DEFAULT_MODEL`, never the API version of a plan model. "Not logged in" (401) and "plan limit reached" (402) are plain English errors and are not retried.

Considered: spawning `claude -p` (no partial events, so ops would arrive at the end); one adapter that switches on the model id (every new provider would edit it); falling back to the API when the plan is unavailable (a silent charge).

## Consequences

- Plan runs use the plan's limits and the Claude Code login; they are not a service Grafito can offer to others.
- Adding a provider (ChatGPT, Gemma): add its name to `Provider` and its models to `MODELS` in `models.ts`; write an adapter in `apps/server/src/claude/` that returns a `ClaudeClient` and maps the provider's stream to the raw events of `stream.ts`; register it in `buildClients` (`claude/clients.ts`), behind an opt-in switch if it is not the owner's API; add `.env.example` entries. The route, `/api/health` and the web tiles follow from `MODELS` and need no change, apart from tile labels in `apps/web/src/live/models.ts` if needed.
