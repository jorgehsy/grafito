import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createBoardHandler } from "./board";
import { fakeClaude, start, stop, toolBlock } from "../claude/fake";
import type { FakeAttempt, FakeClaude } from "../claude/fake";
import { SKETCH_RULES } from "../prompt/sketch";
import { systemPrompt } from "../prompt/system";

// Sketch requests through POST /api/board on a real ephemeral server, with the fake Claude adapter.

let server: Server | undefined;
afterEach(() => {
  server?.closeAllConnections();
  return new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

type Ev = { event: string; data: any };
async function post(fake: FakeClaude, body: unknown): Promise<Ev[]> {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.post("/api/board", createBoardHandler({ "anthropic-api": fake }));
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
  const res = await fetch(`http://127.0.0.1:${(server!.address() as AddressInfo).port}/api/board`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return (await res.text()).split("\n\n").filter((b) => b.trim()).map((b) => {
    const [e, d] = b.split("\n");
    return { event: e.replace(/^event: /, ""), data: JSON.parse(d.replace(/^data: /, "")) };
  });
}

const ok: FakeAttempt = [start({ input_tokens: 10 }), ...toolBlock(0, "create_zone", JSON.stringify({ id: "a", kind: "system", title: "A" })), ...stop("tool_use", 5)];
const PNG = Buffer.from("not really a png").toString("base64");
const HINTS = "STROKES (1, in the order drawn; board coordinates, y grows downward)\n- s1: closed shape 120x60 at (10,20), on the empty board";

describe("POST /api/board, sketch mode", () => {
  it("sends the picture, the sketch rules and the sketch text to Claude", async () => {
    const fake = fakeClaude([ok]);
    const evs = await post(fake, { mode: "sketch", sketch: { hints: HINTS, image: PNG }, board: "ZONES\n- a", summary: "s", lang: "es-CL" });
    expect(evs.at(-1)).toMatchObject({ event: "done", data: { ops: 1, mode: "sketch" } });
    const p = fake.calls[0].params;
    expect(p).toMatchObject({ maxTokens: 8192, effort: "medium", opSet: "board", image: { mediaType: "image/png", data: PNG } });
    // the cached prefix is the usual one; the rules sit between it and the language line
    const base = systemPrompt({ catalogs: [], lang: "es-CL" });
    expect(p.system).toEqual([base[0], { text: SKETCH_RULES }, base[1]]);
    expect(p.userText).toContain("CURRENT BOARD:\nZONES\n- a");
    expect(p.userText).toContain(`USER SKETCH (drawn by hand on the board; turn it into board elements):\n${HINTS}`);
    expect(p.userText).not.toContain("NEW SPOKEN FRAGMENT");
  });

  it("takes a data: URL, an optional caption and no picture at all", async () => {
    const withUrl = fakeClaude([ok]);
    await post(withUrl, { mode: "sketch", delta: "  this is the login flow ", sketch: { hints: HINTS, image: `data:image/png;base64,${PNG}` } });
    expect(withUrl.calls[0].params.image).toEqual({ mediaType: "image/png", data: PNG });
    expect(withUrl.calls[0].params.userText).toContain("WHAT THE USER SAID ABOUT IT:\nthis is the login flow");
    server!.close();

    const textOnly = fakeClaude([ok]);
    await post(textOnly, { mode: "sketch", sketch: { hints: HINTS } });
    expect(textOnly.calls[0].params.image).toBeUndefined();
    expect(textOnly.calls[0].params.userText).not.toContain("WHAT THE USER SAID");
  });

  it("the other modes get no rules and no picture", async () => {
    const fake = fakeClaude([ok]);
    await post(fake, { delta: "hola", sketch: { hints: HINTS, image: PNG } });
    expect(fake.calls[0].params.system).toEqual(systemPrompt({ catalogs: [], lang: "en-US" }));
    expect(fake.calls[0].params.image).toBeUndefined();
  });

  it("rejects a malformed sketch and never calls Claude", async () => {
    for (const sketch of [undefined, "ink", {}, { hints: "  " }, { hints: 3 }, { hints: HINTS, image: "not base64!" }, { hints: HINTS, image: 5 }]) {
      const fake = fakeClaude([ok]);
      const evs = await post(fake, { mode: "sketch", sketch });
      expect(evs).toEqual([{ event: "error", data: { message: expect.stringContaining("Invalid sketch") } }]);
      expect(fake.calls).toHaveLength(0);
      server!.close();
    }
    const fake = fakeClaude([ok]);
    expect(await post(fake, { mode: "sketch", delta: 4, sketch: { hints: HINTS } })).toEqual([{ event: "error", data: { message: "The text is empty" } }]);
  });
});
