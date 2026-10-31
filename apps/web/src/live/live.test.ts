import { describe, it, expect } from "vitest";
import { emptyBoard, applyOp, applyOps } from "@grafito/board";
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { serializeBoard } from "@grafito/board";
import { createSseParser, streamBoard } from "./sse";
import { costUsd, fmtUsd, priceOf, zeroUsage } from "@grafito/contract";

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
    expect(serializeBoard(emptyBoard())).toBe("(empty board)");
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
    expect(s).toContain('- app [system] "Arch" color:orange');
    b = applyOp(b, op.create_zone({ id: "z2", kind: "list", title: "L" })).board;
    expect(serializeBoard(b)).toContain('- z2 [list] "L" color:blue');
    expect(s).toContain('- api (component/service) "API" @app');
    expect(s).toContain('- c1: api -> db "saves" dashed');
    expect(s).toContain('- n1 -> api "Node"');
    expect(s).toContain("ANNOTATIONS db:star");
    expect(s).not.toContain("{");
  });
});

describe("SSE", () => {
  it("the parser joins split chunks", () => {
    const p = createSseParser();
    const full = ev("op", { name: "delete", input: { id: "x" } }) + ev("done", { ops: 1 });
    const out = [...p.push(full.slice(0, 15)), ...p.push(full.slice(15, 60)), ...p.push(full.slice(60))];
    expect(out.map((e) => e.event)).toEqual(["op", "done"]);
    expect(out[0].data.input.id).toBe("x");
  });
  it("streamBoard dispatches op, invalid, usage, done and error", async () => {
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

describe("catalogs in the request", () => {
  it("streamBoard sends catalogs in the body", async () => {
    let body: any;
    const f = (async (_u: string, init: any) => { body = JSON.parse(init.body); return mockFetch([ev("done", { usage: zeroUsage(), timings: { first_op_ms: null, total_ms: 1 }, ops: 0, model: "m" })])("" as any); }) as unknown as typeof fetch;
    await streamBoard({ delta: "d", summary: "", board: "", model: "m", catalogs: ["aws"] }, { onOp() {}, onInvalid() {}, onDone() {}, onError() {} }, undefined, f);
    expect(body.catalogs).toEqual(["aws"]);
  });
});

describe("cost", () => {
  it("formula per model", () => {
    const u = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000 };
    expect(costUsd("claude-haiku-5-5", u)).toBeCloseTo(0.1 + 0.125 + 0.01 + 0.5, 10);
    expect(costUsd("claude-sonnet-5-5", u)).toBeCloseTo(2 + 2.5 + 0.2 + 10, 10);
    expect(costUsd("claude-haiku-5-5", { ...zeroUsage(), input_tokens: 2000, output_tokens: 1000 })).toBeCloseTo(0.0007, 10);
    expect(priceOf("claude-sonnet-5-5").output).toBe(10);
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
    expect(t).toContain("level:60");
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
