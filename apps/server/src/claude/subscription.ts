import { query as sdkQuery, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, USAGE_LIMIT_ERROR_PREFIXES } from "@anthropic-ai/claude-agent-sdk";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MODELS, toolDefs } from "@grafito/contract";
import type { ClaudeClient, ClaudeParams, SystemBlock, Usage } from "./client";
import { modelEvents } from "./stream";
import type { RawEvent } from "./stream";

/** The Agent SDK's `query`, injectable so tests run without a login. */
export type QueryFn = (params: { prompt: string; options: Options }) => AsyncIterable<SDKMessage>;

export interface SubscriptionOptions {
  query?: QueryFn;
  /** The environment the SDK's env is built from (default `process.env`). */
  env?: NodeJS.ProcessEnv;
}

// The SDK names in-process tools `mcp__<server>__<tool>`; the model sees these names.
const SERVER = "grafito";
const PREFIX = `mcp__${SERVER}__`;
// One turn, like the API adapter: Claude sends every op in one answer. More turns can repeat ops after the "ok" results.
const MAX_TURNS = 1;

// Anything that would send the call to the paid API (or another provider) instead of the plan.
const NOT_PLAN_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"];

/**
 * The env given to the SDK (it replaces the subprocess env). No API key, so a plan call can never bill
 * the API; `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`) is kept if set, else the local login is used.
 */
export function subscriptionEnv(source: NodeJS.ProcessEnv, maxTokens: number): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...source };
  for (const k of NOT_PLAN_ENV) delete env[k];
  if (!env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) delete env.CLAUDE_CODE_OAUTH_TOKEN;
  env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(maxTokens);
  env.CLAUDE_AGENT_SDK_CLIENT_APP = "grafito";
  return env;
}

/** The adapter for the owner's Claude subscription: runs the board request through the Agent SDK (local `claude` login). */
export function subscriptionClient(opts: SubscriptionOptions = {}): ClaudeClient {
  const query = opts.query ?? (sdkQuery as QueryFn);
  const source = opts.env ?? process.env;
  return {
    stream(p: ClaudeParams, signal: AbortSignal) {
      const open = async (s: AbortSignal): Promise<AsyncIterable<RawEvent>> => {
        const abortController = new AbortController();
        const messages = query({ prompt: p.userText, options: { ...options(p, subscriptionEnv(source, p.maxTokens)), abortController } });
        return rawEvents(messages, abortController, s);
      };
      return modelEvents(open, p.catalogs, signal);
    },
  };
}

function options(p: ClaudeParams, env: Record<string, string | undefined>): Options {
  const tools = toolDefs(p.catalogs);
  return {
    model: MODELS.find((m) => m.id === p.model)?.apiModel ?? p.model,
    systemPrompt: systemPrompt(p.system),
    // No Claude Code: no built-in tools, no settings files (CLAUDE.md, hooks, plugins), no other MCP servers.
    tools: [],
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    mcpServers: { [SERVER]: { type: "sdk", name: SERVER, instance: opServer(p.catalogs) } },
    allowedTools: tools.map((t) => PREFIX + t.name),
    permissionMode: "dontAsk",
    maxTurns: MAX_TURNS,
    includePartialMessages: true,
    effort: p.effort,
    thinking: { type: "disabled" },
    env,
  };
}

// Our blocks in full; the SDK's boundary marker goes where our cached prefix ends.
function systemPrompt(blocks: readonly SystemBlock[]): string[] {
  const texts = blocks.map((b) => b.text);
  const last = blocks.map((b) => !!b.cache).lastIndexOf(true);
  if (last >= 0 && last < texts.length - 1) texts.splice(last + 1, 0, SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
  return texts;
}

/**
 * The op tools as an in-process MCP server. It serves the JSON Schemas of `toolDefs` as they are, not
 * through the SDK's `tool()` (which wants Zod shapes and would rebuild the schemas and validate a second
 * time): the model sees the same schemas as with the API and `parseOp` stays the only check. Every call answers "ok".
 */
function opServer(catalogs: readonly string[]): McpServer {
  const server = new McpServer({ name: SERVER, version: "1.0.0" }, { capabilities: { tools: {} } });
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: toolDefs(catalogs).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.input_schema,
      // Always in the prompt, never deferred behind tool search.
      _meta: { "anthropic/alwaysLoad": true },
    })),
  }));
  server.server.setRequestHandler(CallToolRequestSchema, () => ({ content: [{ type: "text" as const, text: "ok" }] }));
  return server;
}

const ZERO: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const plus = (a: Usage, b: Usage): Usage => ({
  input_tokens: a.input_tokens + b.input_tokens,
  output_tokens: a.output_tokens + b.output_tokens,
  cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
  cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens,
});

/**
 * SDK messages -> the raw stream events `modelEvents` reads. Tool names lose the `mcp__grafito__` prefix.
 * Usage is summed over the turns: each message_start and message_delta carries the earlier turns' total
 * plus this turn's figures, so the usage the parser reports is always the running total.
 */
async function* rawEvents(messages: AsyncIterable<SDKMessage>, ac: AbortController, signal: AbortSignal): AsyncGenerator<RawEvent> {
  const onAbort = () => ac.abort();
  if (signal.aborted) ac.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  let total = ZERO;
  let turn = ZERO;
  let errorKind: string | undefined;
  let limited = false;
  let done = false;
  let failure: Error | undefined;
  try {
    for await (const m of messages) {
      if (m.type === "stream_event" && m.parent_tool_use_id === null) {
        const ev = m.event;
        if (ev.type === "message_start") {
          const u = ev.message.usage;
          turn = {
            input_tokens: u.input_tokens ?? 0,
            output_tokens: u.output_tokens ?? 0,
            cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
            cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
          };
          yield { type: "message_start", message: { usage: plus(total, turn) } };
        } else if (ev.type === "content_block_start") {
          const b = ev.content_block;
          yield { type: "content_block_start", index: ev.index, content_block: b.type === "tool_use" ? { type: b.type, name: opName(b.name) } : { type: b.type } };
        } else if (ev.type === "content_block_delta") {
          const d = ev.delta;
          yield { type: "content_block_delta", index: ev.index, delta: d.type === "input_json_delta" ? { type: d.type, partial_json: d.partial_json } : { type: d.type } };
        } else if (ev.type === "content_block_stop") {
          yield { type: "content_block_stop", index: ev.index };
        } else if (ev.type === "message_delta") {
          if (ev.usage.output_tokens != null) turn = { ...turn, output_tokens: ev.usage.output_tokens };
          yield { type: "message_delta", delta: { stop_reason: ev.delta.stop_reason }, usage: { output_tokens: total.output_tokens + turn.output_tokens } };
        } else if (ev.type === "message_stop") {
          total = plus(total, turn);
          turn = ZERO;
          yield { type: "message_stop" };
        }
      } else if (m.type === "assistant" && m.error) {
        errorKind = m.error;
      } else if (m.type === "rate_limit_event" && m.rate_limit_info.status === "rejected") {
        limited = true;
      } else if (m.type === "result") {
        done = true;
        // Hitting the turn limit just ends the request: the ops have already streamed.
        if (m.subtype === "success" && !m.is_error) return;
        if (m.subtype === "error_max_turns") return;
        const text = m.subtype === "success" ? m.result : m.errors.join("; ") || m.subtype;
        failure = subscriptionError(text, errorKind, limited, m.subtype === "success" ? m.api_error_status : undefined);
        break;
      }
    }
    done = true;
  } catch (e) {
    done = true;
    if (signal.aborted) throw e;
    throw subscriptionError(e instanceof Error ? e.message : String(e), errorKind, limited);
  } finally {
    signal.removeEventListener("abort", onAbort);
    // Left early (the caller stopped reading): stop the Claude Code process.
    if (!done) ac.abort();
  }
  if (failure) throw failure;
}

const opName = (name: string): string => (name.startsWith(PREFIX) ? name.slice(PREFIX.length) : name);

const NOT_LOGGED_IN = /not logged in|\/login|invalid api key|authentication/i;

/**
 * Maps an SDK failure to a plain English message. "not logged in" and "plan limit reached" carry a 4xx
 * status so the one retry is not tried; anything else passes through as it came.
 */
export function subscriptionError(text: string, kind?: string, limited = false, status?: number | null): Error {
  if (kind === "authentication_failed" || kind === "oauth_org_not_allowed" || NOT_LOGGED_IN.test(text))
    return Object.assign(new Error("not logged in"), { status: 401 });
  if (limited || kind === "rate_limit" || kind === "billing_error" || USAGE_LIMIT_ERROR_PREFIXES.some((p) => text.startsWith(p)))
    return Object.assign(new Error("plan limit reached"), { status: 402 });
  return Object.assign(new Error(text), status == null ? {} : { status });
}
