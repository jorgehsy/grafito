import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { BOARD_SYSTEM_PROMPT, boardHandler, buildUserText, parseToolBlock, isRetryable, systemPromptFor, validateCatalogs } from "./board";
import { OP_TOOLS, toolsFor, validateOp } from "@grafito/contract";
import { AWS_SERVICES } from "@grafito/icons";

describe("parseToolBlock", () => {
  it("accepts valid JSON", () => {
    const r = parseToolBlock("create_zone", '{"id":"a","kind":"system","title":"A"}');
    expect(r).toEqual({ ok: true, name: "create_zone", input: { id: "a", kind: "system", title: "A" } });
  });
  it("broken JSON gives a warning and does not throw", () => {
    const r = parseToolBlock("create_zone", '{"id":"a" "kind"');
    expect(r).toMatchObject({ ok: false, invalid: true, name: "create_zone", warning: "create_zone: malformed JSON (skipped)" });
  });
  it("empty buffer is {} and gets validated", () => {
    const r = parseToolBlock("create_zone", "");
    expect(r.ok).toBe(false);
    expect((r as any).warning).not.toContain("malformed");
  });
  it("unknown tool is invalid", () => {
    expect(parseToolBlock("nada", "{}").ok).toBe(false);
  });
});

describe("buildUserText", () => {
// Spanish on purpose: prompt text, translated with the English prompt ticket.
  const base = { board: "ZONAS\n- a", summary: "resumen", delta: "hola" };
  it("content mode carries the fragment and the shape", () => {
    const t = buildUserText({ ...base, shape: "flow", mode: "content" });
    expect(t).toContain("NUEVO FRAGMENTO DICHO:\nhola");
    expect(t).toContain("Forma preferida para zonas nuevas: flow.");
  });
  it("no mode means content; auto adds no shape", () => {
    const t = buildUserText({ ...base, shape: "auto" });
    expect(t).toContain("NUEVO FRAGMENTO DICHO");
    expect(t).not.toContain("Forma preferida");
  });
  it("instruction mode uses the command header and omits the shape", () => {
    const t = buildUserText({ ...base, shape: "flow", mode: "instruction" });
    expect(t).toContain("INSTRUCCIÓN DEL USUARIO (es una orden sobre el tablero, no contenido para dibujar):\nhola");
    expect(t).not.toContain("NUEVO FRAGMENTO");
    expect(t).not.toContain("Forma preferida");
  });
  it("empty board and summary fall back to defaults", () => {
    expect(buildUserText({ delta: "x" })).toContain("(tablero vacío)");
    expect(buildUserText({ delta: "x" })).toContain("(vacío)");
  });
});

describe("isRetryable", () => {
  it("429 and 5xx yes; other 4xx no", () => {
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(529)).toBe(true);
    expect(isRetryable(undefined)).toBe(true);
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(401)).toBe(false);
  });
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const IDS = AWS_SERVICES.map((s) => s.id);

describe("catalog off (cache intact)", () => {
// Spanish on purpose: prompt text, translated with the English prompt ticket.
  it("prompt and tools are byte for byte what they were before the catalog", () => {
    expect(sha(BOARD_SYSTEM_PROMPT)).toBe("bef3c145ac02388481e2598134e648d54533e68e0b5a92c1e789f0289c99f67e");
    expect(sha(JSON.stringify(OP_TOOLS.map((t) => ({ ...t, eager_input_streaming: true }))))).toBe("b1e29c3b1aeab8be449e9564342b5991f5552b0ec74b6fb575b14e28c9b2dbd7");
    expect(systemPromptFor([])).toBe(BOARD_SYSTEM_PROMPT);
    expect(toolsFor([])).toBe(OP_TOOLS);
  });
  it("Claude receives nothing from the catalog", () => {
    const names = toolsFor([]).map((t) => t.name);
    expect(names).not.toContain("set_service");
    expect(JSON.stringify(toolsFor([]))).not.toContain("service\":{");
    expect(systemPromptFor([])).not.toMatch(/AWS|set_service|catálogo/);
  });
  it("an op with service is rejected (additionalProperties) and set_service does not exist", () => {
    expect(validateOp("add_step", { zone: "z", id: "a", label: "A", service: "lambda" })).toMatch(/additional|service/i);
    expect(validateOp("set_service", { id: "a", service: "lambda" })).toContain("unknown");
    expect(parseToolBlock("add_step", '{"zone":"z","id":"a","label":"A","service":"lambda"}')).toMatchObject({ ok: false, invalid: true });
  });
});

describe("AWS catalog on", () => {
// Spanish on purpose: prompt text, translated with the English prompt ticket.
  const on = ["aws"];
  it("service is an enum of the 40 ids in add_step, add_decision and add_component", () => {
    expect(IDS).toHaveLength(40);
    for (const n of ["add_step", "add_decision", "add_component"]) {
      const t: any = toolsFor(on).find((x) => x.name === n);
      expect(t.input_schema.properties.service.enum).toEqual(IDS);
    }
    const other: any = toolsFor(on).find((x) => x.name === "add_node");
    expect(other.input_schema.properties.service).toBeUndefined();
  });
  it("set_service exists and update_summary stays last", () => {
    const names = toolsFor(on).map((t) => t.name);
    expect(names).toContain("set_service");
    expect(names[names.length - 1]).toBe("update_summary");
    expect(names).toHaveLength(OP_TOOLS.length + 1);
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
  it("the validator accepts service:lambda, rejects a made-up one; set_service is valid", () => {
    const step = { zone: "z", id: "a", label: "A" };
    expect(validateOp("add_step", { ...step, service: "lambda" }, on)).toBeNull();
    expect(validateOp("add_step", { ...step, service: "made-up" }, on)).not.toBeNull();
    expect(validateOp("set_service", { id: "a", service: "s3" }, on)).toBeNull();
    expect(validateOp("set_service", { id: "a", service: "" }, on)).toBeNull();
    expect(validateOp("set_service", { id: "a", service: "made-up" }, on)).not.toBeNull();
    expect(parseToolBlock("set_service", '{"id":"a","service":"s3"}', on)).toMatchObject({ ok: true });
  });
});

describe("catalogs in the body", () => {
  it("validateCatalogs", () => {
    expect(validateCatalogs(undefined)).toBeNull();
    expect(validateCatalogs([])).toBeNull();
    expect(validateCatalogs(["aws"])).toBeNull();
    expect(validateCatalogs(["gcp"])).toContain("gcp");
    expect(validateCatalogs("aws")).not.toBeNull();
    expect(validateCatalogs([1])).not.toBeNull();
  });
  it("an unknown catalog answers with an SSE error", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const chunks: string[] = [];
    const res: any = { writeHead() {}, write: (c: string) => chunks.push(c), end() {}, on() {} };
    try {
      await boardHandler({ body: { delta: "hola", catalogs: ["made-up"] } } as any, res);
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
    expect(chunks.join("")).toContain("event: error");
    expect(chunks.join("")).toContain("Invalid catalog");
  });
});
