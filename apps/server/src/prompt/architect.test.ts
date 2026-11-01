import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ARCHITECT_PROMPT_VERSION, LANGS, toolDefs } from "@grafito/contract";
import { AWS_SERVICES } from "@grafito/icons";
import { ARCHITECT_SYSTEM_PROMPT, architectSystemPrompt, buildArchitectUserText } from "./architect";
import { languageLine } from "./system";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("architect system prompt", () => {
  it("prompt and tools are byte for byte the reviewed version", () => {
    expect(sha(ARCHITECT_SYSTEM_PROMPT)).toBe("13576801f99547fcd63988551ade1b7f2250bb406aa9c3ffe2f74bf92bceb421");
    expect(sha(JSON.stringify(toolDefs([], "architect")))).toBe("e59a8ad6ab3ba4e985085d72e8f752c9876023c3a6a60eeb2ed4e3c10c8974a5");
    // Architect turns stamp ARCHITECT_PROMPT_VERSION: from the session record slice on, bump it whenever these hashes change.
    expect(ARCHITECT_PROMPT_VERSION).toBe(1);
  });

  it("is the architect prompt, cached, then the same language line as live mode, not cached", () => {
    expect(architectSystemPrompt({ catalogs: [], lang: "es-CL" })).toEqual([
      { text: ARCHITECT_SYSTEM_PROMPT, cache: true },
      { text: languageLine("es-CL") },
    ]);
    const cached = new Set(LANGS.map((l) => JSON.stringify(architectSystemPrompt({ catalogs: ["aws"], lang: l.code })[0])));
    expect(cached.size).toBe(1);
  });

  it("carries the persona rules that need no proposals", () => {
    for (const rule of [/Draw first/, /One question per turn/, /No lectures/, /what happens if/, /Blunt, not blocking/, /Push back once/, /exactly one say/, /Out of scope/, /draw nothing/, /AWS service names stay in English/, /language named on the last line/])
      expect(ARCHITECT_SYSTEM_PROMPT).toMatch(rule);
    expect(ARCHITECT_SYSTEM_PROMPT).not.toMatch(/proposal|pencil/i);
  });

  it("draws in the app-made system zone and never makes zones", () => {
    expect(ARCHITECT_SYSTEM_PROMPT).toContain('zone "system"');
    expect(ARCHITECT_SYSTEM_PROMPT).not.toMatch(/create_zone/);
  });

  it("names AWS service ids only with the catalog on", () => {
    expect(architectSystemPrompt({ catalogs: [], lang: "en-US" })[0].text).not.toMatch(/set_service|Valid ids/);
    const [cached] = architectSystemPrompt({ catalogs: ["aws"], lang: "en-US" });
    expect(cached.text.startsWith(ARCHITECT_SYSTEM_PROMPT + "\n\n")).toBe(true);
    for (const s of AWS_SERVICES) expect(cached.text).toContain(s.id);
    expect(cached.text).toContain("set_service");
  });
});

describe("architect user text", () => {
  it("has the board, summary, the last 3 turns word for word and the message", () => {
    const recent = [1, 2, 3, 4].map((n) => ({ text: `ask ${n}`, bubble: n === 4 ? "" : `bubble ${n}` }));
    expect(buildArchitectUserText({ board: "ZONES\n- system", summary: "s", recent, text: "add an S3 bucket" })).toBe(
      "CURRENT BOARD:\nZONES\n- system\n\nSUMMARY SO FAR:\ns\n\nRECENT TURNS:\nUSER: ask 2\nYOUR BUBBLE: bubble 2\nUSER: ask 3\nYOUR BUBBLE: bubble 3\nUSER: ask 4\nYOUR BUBBLE: (none)\n\nUSER MESSAGE:\nadd an S3 bucket",
    );
  });
  it("says so when there is nothing yet", () => {
    expect(buildArchitectUserText({ text: "hi" })).toBe("CURRENT BOARD:\n(empty board)\n\nSUMMARY SO FAR:\n(empty)\n\nRECENT TURNS:\n(none)\n\nUSER MESSAGE:\nhi");
  });
});
