import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { ARCHITECT_PROMPT_VERSION, LANGS, toolDefs } from "@grafito/contract";
import { AWS_SERVICES } from "@grafito/icons";
import { renderWellArchitectedDigest } from "@grafito/wellarchitected";
import { ARCHITECT_SYSTEM_PROMPT, WELL_ARCHITECTED_DIGEST, architectSystemPrompt, buildArchitectUserText } from "./architect";
import { BOARD_SYSTEM_PROMPT, languageLine, systemPrompt } from "./system";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("architect system prompt", () => {
  it("prompt and tools are byte for byte the reviewed version", () => {
    expect(sha(ARCHITECT_SYSTEM_PROMPT)).toBe("a61f8c63058800c0a2f47a56d655d986a77b2fbb41d3103896dc9c6ed224c620");
    expect(sha(WELL_ARCHITECTED_DIGEST)).toBe("832d66dfb0b386561a47bbc433cfe764bb9e1a64e86d3c34a133c2e1a4a363be");
    expect(sha(JSON.stringify(toolDefs([], "architect")))).toBe("e59a8ad6ab3ba4e985085d72e8f752c9876023c3a6a60eeb2ed4e3c10c8974a5");
    // Architect turns stamp ARCHITECT_PROMPT_VERSION: from the session record slice on, bump it whenever these hashes change.
    expect(ARCHITECT_PROMPT_VERSION).toBe(1);
  });

  it("is the architect prompt and the digest, cached, then the same language line as live mode, not cached", () => {
    expect(architectSystemPrompt({ catalogs: [], lang: "es-CL" })).toEqual([
      { text: `${ARCHITECT_SYSTEM_PROMPT}\n\n${WELL_ARCHITECTED_DIGEST}`, cache: true },
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

  it("follows the Well-Architected digest without quoting it, and offers a pillar review at the end", () => {
    for (const rule of [/never quote it/, /never paste its titles or any other AWS text/, /never cite best-practice IDs outside the pillar review/, /An end\. When nothing big is open/, /review against the six Well-Architected pillars/, /one gap per turn/, /plain words/])
      expect(ARCHITECT_SYSTEM_PROMPT).toMatch(rule);
    expect(ARCHITECT_SYSTEM_PROMPT).toMatch(/raise it again only in the pillar review/);
  });

  it("carries the whole digest inside the cached block, after the rules and catalogs", () => {
    expect(WELL_ARCHITECTED_DIGEST).toBe(renderWellArchitectedDigest());
    for (const catalogs of [[], ["aws"]]) {
      const [cached, language] = architectSystemPrompt({ catalogs, lang: "en-US" });
      expect(cached.cache).toBe(true);
      expect(cached.text.endsWith(`\n\n${WELL_ARCHITECTED_DIGEST}`)).toBe(true);
      expect(language.text).not.toContain("Well-Architected");
    }
    expect(WELL_ARCHITECTED_DIGEST).toContain("- REL10-BP01 ");
  });

  it("leaves the live prompt without the digest", () => {
    const live = systemPrompt({ catalogs: ["aws"], lang: "en-US" }).map((b) => b.text).join("\n");
    expect(live).not.toContain("Well-Architected");
    expect(live).not.toMatch(/[A-Z]+\d{2}-BP\d{2}/);
    expect(BOARD_SYSTEM_PROMPT).not.toContain(WELL_ARCHITECTED_DIGEST.slice(0, 40));
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
