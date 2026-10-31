import { describe, it, expect } from "vitest";
import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { toolDefs } from "@grafito/contract";
import type { ClaudeParams, ModelEvent } from "./client";
import { start, stop, toolBlock } from "./fake";
import type { RawEvent } from "./stream";
import { subscriptionClient } from "./subscription";
import type { QueryFn } from "./subscription";

// The adapter runs against a fake `query` that plays SDK messages; no login, no Claude Code process.

const params: ClaudeParams = {
  model: "claude-haiku-5-5@subscription",
  maxTokens: 4000,
  effort: "low",
  system: [{ text: "board prompt", cache: true }, { text: "language line" }],
  userText: "NEW SPOKEN FRAGMENT: hello",
  catalogs: [],
};

const P = "mcp__grafito__";
const ev = (event: RawEvent): SDKMessage => ({ type: "stream_event", event, parent_tool_use_id: null, uuid: "u", session_id: "s" }) as unknown as SDKMessage;
const msg = (m: object): SDKMessage => m as unknown as SDKMessage;
const ok = msg({ type: "result", subtype: "success", is_error: false, result: "" });
const zone = (id: string) => JSON.stringify({ id, kind: "flow", title: id });

type Step = SDKMessage | Error;
interface FakeQuery extends QueryFn {
  calls: Options[];
}

/** One script per call (a retry is a second call); an Error is thrown at its place. "hang" waits for the abort. */
function fakeQuery(...scripts: (readonly Step[] | "hang")[]): FakeQuery {
  const calls: Options[] = [];
  const fn = ({ options }: { prompt: string; options: Options }) => {
    calls.push(options);
    const script = scripts[calls.length - 1] ?? [];
    return (async function* () {
      if (script === "hang") {
        const s = options.abortController!.signal;
        await new Promise<void>((resolve) => (s.aborted ? resolve() : s.addEventListener("abort", () => resolve())));
        throw new Error("Claude Code process aborted by user");
      }
      for (const step of script) {
        if (step instanceof Error) throw step;
        yield step;
      }
    })();
  };
  return Object.assign(fn, { calls });
}

async function collect(q: QueryFn, env: NodeJS.ProcessEnv = {}, signal = new AbortController().signal): Promise<ModelEvent[]> {
  const out: ModelEvent[] = [];
  for await (const e of subscriptionClient({ query: q, env }).stream(params, signal)) out.push(e);
  return out;
}

const twoTurns: Step[] = [
  ev(start({ input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 })),
  ...toolBlock(0, P + "create_zone", zone("a")).map(ev),
  ...toolBlock(1, P + "create_zone", zone("b")).map(ev),
  ...stop("tool_use", 20).map(ev),
  msg({ type: "user", message: { role: "user", content: [] }, parent_tool_use_id: null }),
  ev(start({ input_tokens: 30, cache_read_input_tokens: 5 })),
  ...toolBlock(0, P + "create_zone", zone("c")).map(ev),
  ...stop("end_turn", 7).map(ev),
  ok,
];

describe("subscriptionClient", () => {
  it("streams the ops of every turn in order, without the mcp__grafito__ prefix", async () => {
    const out = await collect(fakeQuery(twoTurns));
    const ops = out.filter((e) => e.type === "op").map((e) => (e.type === "op" ? e.op.input : null));
    expect(ops.map((o) => (o as { id: string }).id)).toEqual(["a", "b", "c"]);
    expect(out.some((e) => e.type === "invalid")).toBe(false);
    expect(out.at(-1)).toMatchObject({ type: "end", stopReason: "end_turn" });
  });

  it("reports usage summed over the turns", async () => {
    const out = await collect(fakeQuery(twoTurns));
    const sum = { input_tokens: 130, output_tokens: 27, cache_read_input_tokens: 55, cache_creation_input_tokens: 10 };
    expect(out.at(-1)).toEqual({ type: "end", stopReason: "end_turn", usage: sum });
    const finals = out.filter((e) => e.type === "usage" && !e.estimated).map((e) => (e.type === "usage" ? e.usage.output_tokens : 0));
    expect(finals).toEqual([20, 27]);
  });

  it("ending on the turn limit is not an error", async () => {
    const q = fakeQuery([...twoTurns.slice(0, -1), msg({ type: "result", subtype: "error_max_turns", is_error: true, errors: [] })]);
    expect((await collect(q)).at(-1)).toMatchObject({ type: "end" });
  });

  it("sends our prompt and op tools only: no preset, built-in tools or settings", async () => {
    const q = fakeQuery([ok]);
    await collect(q);
    const o = q.calls[0];
    expect(o.model).toBe("claude-haiku-5-5");
    expect(o.systemPrompt).toEqual(["board prompt", "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__", "language line"]);
    expect(o).toMatchObject({ tools: [], settingSources: [], strictMcpConfig: true, maxTurns: 3, includePartialMessages: true, effort: "low", permissionMode: "dontAsk" });
    expect(o.allowedTools).toEqual(toolDefs([]).map((t) => P + t.name));
    expect(Object.keys(o.mcpServers ?? {})).toEqual(["grafito"]);
  });

  it("serves the toolDefs schemas as they are, and every call answers ok", async () => {
    const q = fakeQuery([ok]);
    await collect(q);
    const server = q.calls[0].mcpServers!.grafito as { instance: { connect(t: unknown): Promise<void> } };
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.instance.connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    const { tools } = await client.listTools();
    expect(tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }))).toEqual(
      toolDefs([]).map(({ name, description, input_schema }) => ({ name, description, input_schema })),
    );
    expect(await client.callTool({ name: "create_zone", arguments: { id: "a" } })).toMatchObject({ content: [{ type: "text", text: "ok" }] });
    await client.close();
  });

  it("gives the SDK an env without the API key", async () => {
    const q = fakeQuery([ok]);
    await collect(q, { PATH: "/bin", HOME: "/h", ANTHROPIC_API_KEY: "sk-ant-x", ANTHROPIC_AUTH_TOKEN: "t", ANTHROPIC_BASE_URL: "http://x" });
    const env = q.calls[0].env!;
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(env).not.toHaveProperty("ANTHROPIC_BASE_URL");
    expect(env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
    expect(env).toMatchObject({ PATH: "/bin", HOME: "/h", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "4000" });
  });

  it("passes CLAUDE_CODE_OAUTH_TOKEN when it is set", async () => {
    const q = fakeQuery([ok]);
    await collect(q, { ANTHROPIC_API_KEY: "sk-ant-x", CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-1" });
    expect(q.calls[0].env).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat-1" });
    expect(q.calls[0].env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("stops the Claude Code process when the request is aborted", async () => {
    const q = fakeQuery("hang");
    const ac = new AbortController();
    const run = collect(q, {}, ac.signal);
    await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    await expect(run).rejects.toThrow();
    expect(q.calls).toHaveLength(1);
    expect(q.calls[0].abortController!.signal.aborted).toBe(true);
  });

  it("maps a failed login to 'not logged in', without a retry", async () => {
    const q = fakeQuery([
      msg({ type: "assistant", error: "authentication_failed", message: { content: [] }, parent_tool_use_id: null }),
      msg({ type: "result", subtype: "success", is_error: true, result: "Failed to authenticate. API Error: 401", api_error_status: 401 }),
    ]);
    await expect(collect(q)).rejects.toThrow(/^not logged in$/);
    expect(q.calls).toHaveLength(1);
  });

  it("maps a thrown login error to 'not logged in'", async () => {
    await expect(collect(fakeQuery([new Error("Not logged in · Please run /login")]))).rejects.toThrow(/^not logged in$/);
  });

  it("maps the plan's usage limit to 'plan limit reached', without a retry", async () => {
    const q = fakeQuery([
      msg({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour" } }),
      msg({ type: "result", subtype: "success", is_error: true, result: "You've hit your limit · resets 5pm" }),
    ]);
    await expect(collect(q)).rejects.toThrow(/^plan limit reached$/);
    expect(q.calls).toHaveLength(1);
    await expect(collect(fakeQuery([msg({ type: "result", subtype: "success", is_error: true, result: "You've reached your usage limit" })]))).rejects.toThrow(
      /^plan limit reached$/,
    );
  });

  it("passes any other error through as it came (after the one retry)", async () => {
    const q = fakeQuery([new Error("socket hang up")], [new Error("socket hang up")]);
    await expect(collect(q)).rejects.toThrow(/^socket hang up$/);
    expect(q.calls).toHaveLength(2);
  });
});
