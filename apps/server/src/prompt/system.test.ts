import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { BOARD_SYSTEM_PROMPT, systemPrompt } from "./system";
import { LANGS, PROMPT_VERSION, toolDefs } from "@grafito/contract";
import { AWS_SERVICES } from "@grafito/icons";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const IDS = AWS_SERVICES.map((s) => s.id);
const joined = (catalogs: string[], lang: (typeof LANGS)[number]["code"]) => systemPrompt({ catalogs, lang }).map((b) => b.text).join("\n\n");

describe("catalog off", () => {
  it("prompt and tools are byte for byte the reviewed version", () => {
    expect(sha(BOARD_SYSTEM_PROMPT)).toBe("50e97c80448286dcbdb4b71c5eb339b67f71feb9acf2ae74fd439bd7127a9cfa");
    expect(sha(JSON.stringify(toolDefs([])))).toBe("b0157243c668fbf4ca66ede709b99f8437e61b8c00c81a947648e02d9ae2b4a3");
    // Session records stamp each request with PROMPT_VERSION: bump it whenever these hashes change.
    expect(PROMPT_VERSION).toBe(2);
  });
  it("is the base prompt, cached, then the language line, not cached", () => {
    expect(systemPrompt({ catalogs: [], lang: "es-CL" })).toEqual([
      { text: BOARD_SYSTEM_PROMPT, cache: true },
      { text: "All drawn text must be in Spanish." },
    ]);
  });
  it("Claude receives nothing from the catalog", () => {
    expect(joined([], "en-US")).not.toMatch(/AWS|set_service|catalog/);
  });
});

describe("language line", () => {
  it("is the last line and names the language of the setting", () => {
    expect(joined([], "es-AR").endsWith("\n\nAll drawn text must be in Spanish.")).toBe(true);
    expect(joined(["aws"], "en-US").endsWith("\n\nAll drawn text must be in English.")).toBe(true);
  });
  it("every language shares the cached block", () => {
    for (const catalogs of [[], ["aws"]]) {
      const cached = new Set(LANGS.map((l) => JSON.stringify(systemPrompt({ catalogs, lang: l.code })[0])));
      expect(cached.size).toBe(1);
    }
  });
});

describe("AWS catalog on", () => {
  const on = ["aws"];
  it("40 service ids", () => {
    expect(IDS).toHaveLength(40);
  });
  it("the cached block is the base plus a block with ids and synonyms generated from services.ts", () => {
    const [cached] = systemPrompt({ catalogs: on, lang: "en-US" });
    expect(cached.cache).toBe(true);
    expect(cached.text.startsWith(BOARD_SYSTEM_PROMPT + "\n\n")).toBe(true);
    for (const id of IDS) expect(cached.text).toContain(id);
    for (const synonym of AWS_SERVICES.flatMap((s) => s.synonyms ?? [])) expect(cached.text).toContain(synonym);
    expect(cached.text).toContain("set_service");
    expect(cached.text).toMatch(/names the service/);
    expect(cached.text).toMatch(/Generic words/);
  });
});
