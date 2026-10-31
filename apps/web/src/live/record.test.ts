import { describe, it, expect } from "vitest";
import { applyOps, emptyBoard } from "@grafito/board";
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { createLiveSession } from "./session";
import type { LogEntry, Totals } from "./session";
import { buildRecord, entriesFromRecord, isRecord, median, replayOps } from "./record";

const ev = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const streamOf = (chunks: string[]) => () => {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } }), { status: 200 });
};
const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 100 };

describe("registro de sesión", () => {
  it("acumula peticiones desde un SSE falso, con texto completo, ops, inválidas y error", async () => {
    let n = 0;
    const long = "x".repeat(200);
    const f = (async () => {
      const i = n++;
      if (i === 0) return streamOf([
        ev("op", { name: "update_summary", input: { text: "r" } }),
        ev("op", { invalid: true, name: "zz", warning: "zz: mal" }),
        ev("done", { usage, timings: { first_op_ms: 7, total_ms: 20 }, ops: 1, model: "claude-haiku-5-5" }),
      ])();
      return streamOf([ev("error", { message: "Error al llamar a Claude: boom" })])();
    }) as unknown as typeof fetch;
    let es: LogEntry[] = []; let tot!: Totals;
    const s = createLiveSession({
      getBoard: () => emptyBoard(), submit: async () => {}, getModel: () => "claude-haiku-5-5",
      onLog: (e, _c, t) => { es = e; tot = t; }, fetchImpl: f,
    });
    s.onFinalText(long);
    for (let k = 0; k < 50 && (n < 1 || s.isBusy()); k++) await new Promise((r) => setTimeout(r, 5));
    s.onFinalText("segunda");
    for (let k = 0; k < 50 && (n < 2 || s.isBusy()); k++) await new Promise((r) => setTimeout(r, 5));

    const rec = buildRecord({ id: "abc", startedAt: 1, model: "claude-haiku-5-5", shape: "flow", lang: "es-CL", transcript: [{ text: long, at: 2 }], summary: "r" }, es, tot, 99);
    expect(rec.version).toBe(1);
    expect(rec.updatedAt).toBe(99);
    expect(rec.shape).toBe("flow");
    expect(rec.requests).toHaveLength(2);
    expect(rec.requests[0].text).toBe(long);
    expect(rec.requests[0].ops).toEqual([{ name: "update_summary", input: { text: "r" } }]);
    expect(rec.requests[0].invalid).toEqual(["zz: mal"]);
    expect(rec.requests[0].usage).toEqual({ input: 1000, cacheRead: 500, cacheWrite: 100, output: 200 });
    expect(rec.requests[0].firstOpMs).toBe(7);
    expect(rec.requests[0].error).toBeUndefined();
    expect(rec.requests[1].error).toContain("boom");
    expect(rec.totals.requests).toBe(1);
    expect(rec.totals.costUsd).toBeCloseTo(rec.requests[0].costUsd, 10);
    expect(isRecord(JSON.parse(JSON.stringify(rec)))).toBe(true);

    // ida y vuelta
    const back = entriesFromRecord(rec);
    expect(back.entries[0].opList).toEqual([{ name: "update_summary", input: { text: "r" } } as Op]);
    expect(back.entries[1].error).toContain("boom");
    expect(back.totals.requests).toBe(1);
    // restore continúa la numeración
    const s2 = createLiveSession({ getBoard: () => emptyBoard(), submit: async () => {}, getModel: () => "m", onLog: () => {} });
    s2.restore(back.entries, back.totals);
  });

  it("mediana y totales, tolerando shape ausente", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(3);
    const mk = (id: number, v: number | null): LogEntry => ({
      id, model: "m", delta: "t", mode: "content", startedAt: 0, firstOpMs: 1, voiceFirstMs: v, totalMs: 2, ops: 0, opList: [],
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      usageEstimated: false, costUsd: 0.5, warnings: [], done: true,
    });
    const rec = buildRecord({ id: "a", startedAt: 0, model: "m", lang: "es-CL", transcript: [], summary: "" }, [mk(1, 100), mk(2, 300), mk(3, null)], { requests: 3, usage: mk(1, 0).usage, costUsd: 1.5 });
    expect(rec.shape).toBeUndefined();
    expect(rec.totals).toEqual({ requests: 3, costUsd: 1.5, medianVoiceFirstMs: 200 });
  });

  it("guarda y carga mode y undone; los registros antiguos cargan como contenido", () => {
    const base = { id: 1, model: "m", delta: "t", startedAt: 0, firstOpMs: 1, voiceFirstMs: null, totalMs: 2, ops: 1,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      usageEstimated: false, costUsd: 0, warnings: [], done: true };
    const a: LogEntry = { ...base, id: 1, mode: "content", opList: [{ name: "update_summary", input: { text: "a" } } as Op] };
    const b: LogEntry = { ...base, id: 2, mode: "instruction", undone: true, opList: [{ name: "update_summary", input: { text: "b" } } as Op] };
    const tot = { requests: 2, usage: base.usage, costUsd: 0 };
    const rec = buildRecord({ id: "a", startedAt: 0, model: "m", lang: "es-CL", transcript: [], summary: "" }, [a, b], tot);
    expect(rec.requests[0].undone).toBeUndefined();
    expect(rec.requests[1]).toMatchObject({ mode: "instruction", undone: true });
    const back = entriesFromRecord(JSON.parse(JSON.stringify(rec)));
    expect(back.entries[0].mode).toBe("content");
    expect(back.entries[0].undone).toBeUndefined();
    expect(back.entries[1]).toMatchObject({ mode: "instruction", undone: true });
    // restaurar salta las operaciones de lo deshecho
    expect(replayOps(back.entries)).toEqual(a.opList);
    // registro antiguo sin mode ni undone
    const old = JSON.parse(JSON.stringify(rec));
    delete old.requests[1].mode; delete old.requests[1].undone;
    expect(entriesFromRecord(old).entries[1]).toMatchObject({ mode: "content" });
    expect(entriesFromRecord(old).entries[1].undone).toBeUndefined();
  });
});

describe("service en exportar -> importar", () => {
  it("las ops con service se reaplican y dan aws:lambda con el catálogo apagado", () => {
    const mk = (id: number, opList: Op[]): LogEntry => ({
      id, model: "m", delta: "t", mode: "content", startedAt: 0, firstOpMs: 1, voiceFirstMs: null, totalMs: 2, ops: opList.length, opList,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      usageEstimated: false, costUsd: 0, warnings: [], done: true,
    });
    const entries = [
      mk(1, [op.create_zone({ id: "s", kind: "system", title: "S" }), op.add_component({ zone: "s", id: "fn", label: "Fn", type: "service", service: "lambda" })]),
      mk(2, [op.add_component({ zone: "s", id: "db", label: "BD", type: "database" }), op.set_service({ id: "db", service: "dynamodb" })]),
    ];
    const tot = { requests: 2, usage: entries[0].usage, costUsd: 0 };
    const rec = buildRecord({ id: "a", startedAt: 0, model: "m", lang: "es-CL", transcript: [], summary: "" }, entries, tot);
    const back = entriesFromRecord(JSON.parse(JSON.stringify(rec)));
    const board = applyOps(emptyBoard(), replayOps(back.entries));
    expect(board.warnings).toEqual([]);
    expect(board.board.elements.map((e) => e.service)).toEqual(["aws:lambda", "aws:dynamodb"]);
  });
});
