import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { BOARD_SYSTEM_PROMPT, boardHandler, buildUserText, parseToolBlock, isRetryable, systemPromptFor, validateCatalogs } from "./board";
import { OP_TOOLS, toolsFor, validateOp } from "@grafito/contract";
import { SERVICIOS_AWS } from "@grafito/icons";

describe("parseToolBlock", () => {
  it("acepta JSON válido", () => {
    const r = parseToolBlock("create_zone", '{"id":"a","kind":"system","title":"A"}');
    expect(r).toEqual({ ok: true, name: "create_zone", input: { id: "a", kind: "system", title: "A" } });
  });
  it("JSON roto da warning y no lanza", () => {
    const r = parseToolBlock("create_zone", '{"id":"a" "kind"');
    expect(r).toMatchObject({ ok: false, invalid: true, name: "create_zone", warning: "create_zone: JSON mal formado (se omitió)" });
  });
  it("buffer vacío es {} y se valida", () => {
    const r = parseToolBlock("create_zone", "");
    expect(r.ok).toBe(false);
    expect((r as any).warning).not.toContain("mal formado");
  });
  it("herramienta desconocida es inválida", () => {
    expect(parseToolBlock("nada", "{}").ok).toBe(false);
  });
});

describe("buildUserText", () => {
  const base = { board: "ZONAS\n- a", summary: "resumen", delta: "hola" };
  it("contenido lleva fragmento y forma", () => {
    const t = buildUserText({ ...base, shape: "flow", mode: "content" });
    expect(t).toContain("NUEVO FRAGMENTO DICHO:\nhola");
    expect(t).toContain("Forma preferida para zonas nuevas: flow.");
  });
  it("sin modo es contenido; auto no añade forma", () => {
    const t = buildUserText({ ...base, shape: "auto" });
    expect(t).toContain("NUEVO FRAGMENTO DICHO");
    expect(t).not.toContain("Forma preferida");
  });
  it("instrucción usa la cabecera de orden y omite la forma", () => {
    const t = buildUserText({ ...base, shape: "flow", mode: "instruction" });
    expect(t).toContain("INSTRUCCIÓN DEL USUARIO (es una orden sobre el tablero, no contenido para dibujar):\nhola");
    expect(t).not.toContain("NUEVO FRAGMENTO");
    expect(t).not.toContain("Forma preferida");
  });
  it("tablero y resumen vacíos tienen valor por defecto", () => {
    expect(buildUserText({ delta: "x" })).toContain("(tablero vacío)");
    expect(buildUserText({ delta: "x" })).toContain("(vacío)");
  });
});

describe("isRetryable", () => {
  it("429 y 5xx sí; otros 4xx no", () => {
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(529)).toBe(true);
    expect(isRetryable(undefined)).toBe(true);
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(401)).toBe(false);
  });
});

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const IDS = SERVICIOS_AWS.map((s) => s.id);

describe("catálogo apagado (caché intacto)", () => {
  it("prompt y herramientas son byte a byte los de antes del catálogo", () => {
    expect(sha(BOARD_SYSTEM_PROMPT)).toBe("bef3c145ac02388481e2598134e648d54533e68e0b5a92c1e789f0289c99f67e");
    expect(sha(JSON.stringify(OP_TOOLS.map((t) => ({ ...t, eager_input_streaming: true }))))).toBe("b1e29c3b1aeab8be449e9564342b5991f5552b0ec74b6fb575b14e28c9b2dbd7");
    expect(systemPromptFor([])).toBe(BOARD_SYSTEM_PROMPT);
    expect(toolsFor([])).toBe(OP_TOOLS);
  });
  it("Claude no recibe nada del catálogo", () => {
    const names = toolsFor([]).map((t) => t.name);
    expect(names).not.toContain("set_service");
    expect(JSON.stringify(toolsFor([]))).not.toContain("service\":{");
    expect(systemPromptFor([])).not.toMatch(/AWS|set_service|catálogo/);
  });
  it("una op con service se rechaza (additionalProperties) y set_service no existe", () => {
    expect(validateOp("add_step", { zone: "z", id: "a", label: "A", service: "lambda" })).toMatch(/additional|service/i);
    expect(validateOp("set_service", { id: "a", service: "lambda" })).toContain("desconocida");
    expect(parseToolBlock("add_step", '{"zone":"z","id":"a","label":"A","service":"lambda"}')).toMatchObject({ ok: false, invalid: true });
  });
});

describe("catálogo AWS prendido", () => {
  const on = ["aws"];
  it("service es enum de los 40 ids en add_step, add_decision y add_component", () => {
    expect(IDS).toHaveLength(40);
    for (const n of ["add_step", "add_decision", "add_component"]) {
      const t: any = toolsFor(on).find((x) => x.name === n);
      expect(t.input_schema.properties.service.enum).toEqual(IDS);
    }
    const otros: any = toolsFor(on).find((x) => x.name === "add_node");
    expect(otros.input_schema.properties.service).toBeUndefined();
  });
  it("existe set_service y update_summary sigue al final", () => {
    const names = toolsFor(on).map((t) => t.name);
    expect(names).toContain("set_service");
    expect(names[names.length - 1]).toBe("update_summary");
    expect(names).toHaveLength(OP_TOOLS.length + 1);
  });
  it("el prompt es el base más un bloque con ids y sinónimos generados de servicios.ts", () => {
    const p = systemPromptFor(on);
    expect(p.startsWith(BOARD_SYSTEM_PROMPT)).toBe(true);
    for (const id of IDS) expect(p).toContain(id);
    for (const sin of SERVICIOS_AWS.flatMap((s) => s.sinonimos ?? [])) expect(p).toContain(sin);
    expect(p).toContain("set_service");
    expect(p).toMatch(/nombra el servicio/);
    expect(p).toMatch(/genéricas/);
  });
  it("el validador acepta service:lambda, rechaza uno inventado; set_service válido", () => {
    const step = { zone: "z", id: "a", label: "A" };
    expect(validateOp("add_step", { ...step, service: "lambda" }, on)).toBeNull();
    expect(validateOp("add_step", { ...step, service: "inventado" }, on)).not.toBeNull();
    expect(validateOp("set_service", { id: "a", service: "s3" }, on)).toBeNull();
    expect(validateOp("set_service", { id: "a", service: "" }, on)).toBeNull();
    expect(validateOp("set_service", { id: "a", service: "inventado" }, on)).not.toBeNull();
    expect(parseToolBlock("set_service", '{"id":"a","service":"s3"}', on)).toMatchObject({ ok: true });
  });
});

describe("catalogs en el body", () => {
  it("validateCatalogs", () => {
    expect(validateCatalogs(undefined)).toBeNull();
    expect(validateCatalogs([])).toBeNull();
    expect(validateCatalogs(["aws"])).toBeNull();
    expect(validateCatalogs(["gcp"])).toContain("gcp");
    expect(validateCatalogs("aws")).not.toBeNull();
    expect(validateCatalogs([1])).not.toBeNull();
  });
  it("un catálogo desconocido responde error SSE", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-ant-prueba";
    const chunks: string[] = [];
    const res: any = { writeHead() {}, write: (c: string) => chunks.push(c), end() {}, on() {} };
    try {
      await boardHandler({ body: { delta: "hola", catalogs: ["inventado"] } } as any, res);
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
    expect(chunks.join("")).toContain("event: error");
    expect(chunks.join("")).toContain("Catálogo inválido");
  });
});
