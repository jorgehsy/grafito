import Anthropic from "@anthropic-ai/sdk";
import { toolDefs } from "@grafito/contract";
import type { ClaudeClient, ClaudeParams } from "./client";
import { modelEvents } from "./stream";
import type { RawEvent } from "./stream";

const PLACEHOLDER = "pega-tu-clave-aqui";

/** There is a usable API key in the environment (not empty, not the example placeholder). */
export function hasApiKey(key = process.env.ANTHROPIC_API_KEY): key is string {
  return !!key && key.trim() !== "" && !key.includes(PLACEHOLDER);
}

/** The production adapter: streams a board request from the Anthropic Messages API. */
export function anthropicClient(apiKey: string): ClaudeClient {
  const client = new Anthropic({ apiKey });
  return {
    stream(p: ClaudeParams, signal: AbortSignal) {
      const params = {
        model: p.model,
        max_tokens: p.maxTokens,
        system: p.system.map((b) => ({
          type: "text" as const,
          text: b.text,
          ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
        })),
        tools: toolDefs(p.catalogs),
        tool_choice: { type: "auto" as const },
        output_config: { effort: p.effort },
        messages: [{ role: "user" as const, content: p.userText }],
      };
      const open = async (s: AbortSignal) =>
        (await client.messages.create({ ...params, stream: true }, { signal: s })) as unknown as AsyncIterable<RawEvent>;
      return modelEvents(open, p.catalogs, signal);
    },
  };
}
