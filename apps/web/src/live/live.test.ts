import { describe, it, expect } from "vitest";
import { emptyBoard, applyOp, applyOps } from "@grafito/board";
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { serializeBoard } from "@grafito/board";
import { createSseParser, streamBoard } from "./sse";
import { createLiveSession } from "./session";
import { costUsd, PRICING, fmtUsd, zeroUsage } from "@grafito/contract";

const ev = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const mockFetch = (chunks: string[]): typeof fetch =>
  (async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;

describe("serializeBoard", () => {
  it("empty and with content", () => {
    expect(serializeBoard(emptyBoard())).toBe("(tablero vacío)");
    let b = emptyBoard();
    const ops: Op[] = [
      op.create_zone({ id: "app", kind: "system", title: "Arch" }),
      op.add_component({ zone: "app", id: "api", label: "API", type: "service" }),
      op.add_component({ zone: "app", id: "db", label: "DB", type: "database" }),
      op.connect({ id: "c1", from: "api", to: "db", label: "saves", style: "dashed" }),
      op.add_callout({ id: "n1", target: "api", text: "Node" }),
      op.emphasize({ target: "db", style: "star" }),
    ];
    for (const o of ops) b = applyOp(b, o).board;
    const s = serializeBoard(b);
    expect(s).toContain('- app [system] "Arch" color:naranja');
    b = applyOp(b, op.create_zone({ id: "z2", kind: "list", title: "L" })).board;
    expect(serializeBoard(b)).toContain('- z2 [list] "L" color:azul');
    expect(s).toContain('- api (component/service) "API" @app');
    expect(s).toContain('- c1: api -> db "saves" dashed');
    expect(s).toContain('- n1 -> api "Node"');
    expect(s).toContain("MARCAS db:star");
    expect(s).not.toContain("{");
  });
});

describe("SSE", () => {
  it("parser junta trozos partidos", () => {
    const p = createSseParser();
    const full = ev("op", { name: "delete", input: { id: "x" } }) + ev("done", { ops: 1 });
    const out = [...p.push(full.slice(0, 15)), ...p.push(full.slice(15, 60)), ...p.push(full.slice(60))];
    expect(out.map((e) => e.event)).toEqual(["op", "done"]);
    expect(out[0].data.input.id).toBe("x");
  });
  it("streamBoard despacha op, invalid, usage, done y error", async () => {
    const log: string[] = [];
    const f = mockFetch([
      ev("usage", { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 5, cache_creation_input_tokens: 0, estimated: true }),
      ev("op", { name: "delete", input: { id: "a" } }),
      ev("op", { invalid: true, name: "x", warning: "x: bad" }),
      ev("done", { usage: zeroUsage(), timings: { first_op_ms: 5, total_ms: 9 }, ops: 1, model: "m" }),
      ev("error", { message: "boom" }),
    ]);
    await streamBoard({ delta: "d", summary: "", board: "", model: "m" }, {
      onOp: (o) => log.push("op:" + o.name), onInvalid: (w) => log.push("inv:" + w),
      onUsage: (u) => log.push("usage:" + u.input_tokens), onDone: (d) => log.push("done:" + d.ops), onError: (m) => log.push("err:" + m),
    }, undefined, f);
    expect(log).toEqual(["usage:10", "op:delete", "inv:x: bad", "done:1", "err:boom"]);
  });
  it("streamBoard parses every op with the request's catalogs: what does not parse goes to onInvalid", async () => {
    const log: string[] = [];
    const ops = [
      ev("op", { name: "delete", input: {} }),
      ev("op", { name: "set_service", input: { id: "a", service: "s3" } }),
    ];
    const h = { onOp: (o: { name: string }) => log.push("op:" + o.name), onInvalid: (w: string) => log.push("inv:" + w), onDone() {}, onError() {} };
    await streamBoard({ delta: "d", summary: "", board: "", model: "m" }, h, undefined, mockFetch(ops));
    await streamBoard({ delta: "d", summary: "", board: "", model: "m", catalogs: ["aws"] }, h, undefined, mockFetch(ops));
    expect(log.map((l) => l.split(" ")[0])).toEqual(["inv:delete:", "inv:set_service:", "inv:delete:", "op:set_service"]);
  });
  it("HTTP error", async () => {
    const f = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    let m = "";
    await streamBoard({ delta: "d", summary: "", board: "", model: "m" }, { onOp() {}, onInvalid() {}, onDone() {}, onError: (x) => (m = x) }, undefined, f);
    expect(m).toContain("500");
  });
});

const idle = async (s: { isBusy(): boolean }) => { for (let k = 0; k < 50; k++) { await new Promise((r) => setTimeout(r, 5)); if (!s.isBusy()) break; } };

describe("catalogs in the request", () => {
  it("streamBoard manda catalogs en el body", async () => {
    let body: any;
    const f = (async (_u: string, init: any) => { body = JSON.parse(init.body); return mockFetch([ev("done", { usage: zeroUsage(), timings: { first_op_ms: null, total_ms: 1 }, ops: 0, model: "m" })])("" as any); }) as unknown as typeof fetch;
    await streamBoard({ delta: "d", summary: "", board: "", model: "m", catalogs: ["aws"] }, { onOp() {}, onInvalid() {}, onDone() {}, onError() {} }, undefined, f);
    expect(body.catalogs).toEqual(["aws"]);
  });
  it("the session sends [] by default and serializes service according to getCatalogs", async () => {
    const bodies: any[] = [];
    const f = (async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return mockFetch([ev("done", { usage: zeroUsage(), timings: { first_op_ms: null, total_ms: 1 }, ops: 0, model: "m" })])("" as any); }) as unknown as typeof fetch;
    const { board } = applyOps(emptyBoard(), [
      { name: "create_zone", input: { id: "z", kind: "flow", title: "Z" } },
      { name: "add_step", input: { zone: "z", id: "fn", label: "Function", service: "lambda" } },
    ]);
    // eslint-disable-next-line prefer-const -- mk() runs before and after the single assignment, so it cannot be const
    let cats: string[] | undefined;
    const mk = () => createLiveSession({ getBoard: () => board, submit: async () => {}, getModel: () => "claude-haiku-5-5", getCatalogs: cats ? () => cats! : undefined, onLog() {}, fetchImpl: f });
    const s1 = mk(); s1.onFragment("one."); await idle(s1);
    cats = ["aws"];
    const s2 = mk(); s2.onFragment("two."); await idle(s2);
    expect(bodies[0].catalogs).toEqual([]);
    expect(bodies[0].board).toContain("fn");
    expect(bodies[0].board).not.toContain("service:");
    expect(bodies[1].catalogs).toEqual(["aws"]);
    expect(bodies[1].board).toContain(" service:lambda");
  });
});

describe("language in the request", () => {
  it("the session sends the language setting as lang", async () => {
    const bodies: any[] = [];
    const f = (async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return mockFetch([ev("done", { usage: zeroUsage(), timings: { first_op_ms: null, total_ms: 1 }, ops: 0, model: "m" })])("" as any); }) as unknown as typeof fetch;
    const s = createLiveSession({ getBoard: () => emptyBoard(), submit: async () => {}, getModel: () => "claude-haiku-5-5", getLang: () => "es-MX", onLog() {}, fetchImpl: f });
    s.onFragment("one."); await idle(s);
    expect(bodies[0].lang).toBe("es-MX");
  });
});

describe("live session", () => {
  it("one request in flight, batches fragments, records usage and cost", async () => {
    const bodies: any[] = [];
    let n = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = (async (_u: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      const i = n++;
      if (i === 0) await gate;
      const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 };
      return mockFetch([ev("op", { name: "update_summary", input: { text: "r" + i } }), ev("done", { usage, timings: { first_op_ms: 7, total_ms: 20 }, ops: 1, model: "claude-haiku-5-5" })])("" as any);
    }) as unknown as typeof fetch;
    const submitted: Op[] = [];
    let totals: any;
    const s = createLiveSession({
      getBoard: () => emptyBoard(), submit: async (o) => { submitted.push(...o); },
      getModel: () => "claude-haiku-5-5", onLog: (_e, _c, t) => (totals = t), fetchImpl: f,
    });
    s.onFragment("one.");
    s.onFragment("two.");
    s.onFragment("three.");
    expect(s.isBusy()).toBe(true);
    release();
    for (let k = 0; k < 50 && (n < 2 || s.isBusy()); k++) await new Promise((r) => setTimeout(r, 5));
    expect(bodies.map((b) => b.delta)).toEqual(["one.", "two. three."]);
    expect(bodies[0].board).toBe("(tablero vacío)");
    expect(submitted).toHaveLength(2);
    expect(totals.requests).toBe(2);
    expect(totals.costUsd).toBeCloseTo(2 * costUsd("claude-haiku-5-5", { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 }), 10);
  });
});

describe("cost", () => {
  it("formula per model", () => {
    const u = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 };
    expect(costUsd("claude-haiku-5-5", u)).toBeCloseTo(0.1 + 0.125 + 0.01 + 0.5, 10);
    expect(costUsd("claude-sonnet-5-5", u)).toBeCloseTo(2 + 2.5 + 0.2 + 10, 10);
    expect(costUsd("claude-haiku-5-5", { ...zeroUsage(), input_tokens: 2000, output_tokens: 1000 })).toBeCloseTo(0.0007, 10);
    expect(PRICING["claude-sonnet-5-5"].output).toBe(10);
    expect(fmtUsd(0.00123456)).toBe("$0.0012");
  });
});

describe("fragments", () => {
  it("serializes the marks and level of a scale", () => {
    const b = applyOps(emptyBoard(), [
      op.create_zone({ id: "e", kind: "scale", title: "Ventana" }),
      op.set_level({ zone: "e", at: 60, label: "se llena" }),
      op.add_mark({ zone: "e", id: "m", at: 20, label: "20%", note: "mal", tone: "warn" }),
    ]).board;
    const t = serializeBoard(b);
    expect(t).toContain("nivel:60");
    expect(t).toContain("m (mark)");
    expect(t).toContain("at:20 tone:warn");
  });
});

describe("serializeBoard with service", () => {
  const b = applyOps(emptyBoard(), [
    op.create_zone({ id: "app", kind: "system", title: "Arch" }),
    op.add_component({ zone: "app", id: "fn", label: "Fn", type: "service", service: "lambda" }),
    op.add_component({ zone: "app", id: "db", label: "DB", type: "database" }),
  ]).board;
  it("an enabled catalog shows service:<id> without prefix; off or omitted does not", () => {
    const on = serializeBoard(b, { catalog: true });
    expect(on).toContain('- fn (component/service) "Fn" @app service:lambda');
    expect(on).not.toContain("aws:");
    expect(on.match(/service:/g)).toHaveLength(1); // db no tiene
    expect(serializeBoard(b, { catalog: false })).not.toContain("service:");
    expect(serializeBoard(b)).not.toContain("service:");
  });
});
