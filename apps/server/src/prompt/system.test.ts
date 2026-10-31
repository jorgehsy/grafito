import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { BOARD_SYSTEM_PROMPT, systemPromptFor } from "./system";
import { PROMPT_VERSION, toolDefs } from "@grafito/contract";
import { AWS_SERVICES } from "@grafito/icons";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const IDS = AWS_SERVICES.map((s) => s.id);

describe("catalog off (cache intact)", () => {
// Spanish on purpose: prompt text, translated with the English prompt ticket.
  it("prompt and tools are byte for byte what they were before the catalog", () => {
    expect(sha(BOARD_SYSTEM_PROMPT)).toBe("bef3c145ac02388481e2598134e648d54533e68e0b5a92c1e789f0289c99f67e");
    expect(sha(JSON.stringify(toolDefs([])))).toBe("b1e29c3b1aeab8be449e9564342b5991f5552b0ec74b6fb575b14e28c9b2dbd7");
    // Session records stamp each request with PROMPT_VERSION: bump it whenever these hashes change.
    expect(PROMPT_VERSION).toBe(1);
    expect(systemPromptFor([])).toBe(BOARD_SYSTEM_PROMPT);
  });
  it("Claude receives nothing from the catalog", () => {
    expect(systemPromptFor([])).not.toMatch(/AWS|set_service|catálogo/);
  });
});

describe("AWS catalog on", () => {
// Spanish on purpose: prompt text, translated with the English prompt ticket.
  const on = ["aws"];
  it("40 service ids", () => {
    expect(IDS).toHaveLength(40);
  });
  it("the prompt is the base plus a block with ids and synonyms generated from services.ts", () => {
    const p = systemPromptFor(on);
    expect(p.startsWith(BOARD_SYSTEM_PROMPT)).toBe(true);
    for (const id of IDS) expect(p).toContain(id);
    for (const synonym of AWS_SERVICES.flatMap((s) => s.synonyms ?? [])) expect(p).toContain(synonym);
    expect(p).toContain("set_service");
    expect(p).toMatch(/nombra el servicio/);
    expect(p).toMatch(/genéricas/);
  });
});
