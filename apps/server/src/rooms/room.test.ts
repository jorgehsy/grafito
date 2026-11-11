import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_ID, PARTICIPANT_COLORS, PROMPT_VERSION, op } from "@grafito/contract";
import type { ClientMessage, RoomEvent, ServerMessage, TurnSettings } from "@grafito/contract";
import { fakeClaude, fail, start, stop, toolBlock } from "../claude/fake";
import type { FakeAttempt } from "../claude/fake";
import { ROOM_RULES } from "../prompt/room";
import { SKETCH_RULES } from "../prompt/sketch";
import { Room } from "./room";
import { RoomRegistry } from "./registry";

const settings: TurnSettings = { model: "claude-haiku-5-5", shape: "auto", catalogs: [], lang: "en-US" };
const say = (text: string, mode: "content" | "instruction" = "content"): ClientMessage => ({ t: "text", text, mode, settings });
const zone = (id: string) => JSON.stringify({ id, kind: "system", title: id.toUpperCase() });
const comp = (id: string, z = "a") => JSON.stringify({ zone: z, id, label: id, type: "service" });
const answer = (...blocks: [string, string][]): FakeAttempt => [start({ input_tokens: 100 }), ...blocks.flatMap(([name, json], i) => toolBlock(i, name, json)), ...stop("tool_use", 20)];
const stroke = (id: string) => ({ id, by: "whoever", color: "#3E5E8C", pts: [0, 0, 10, 10] });

/** A connection that records what it is sent. */
function inbox() {
  const got: ServerMessage[] = [];
  return {
    got,
    send: (m: ServerMessage) => void got.push(m),
    events: () => got.flatMap((m) => (m.t === "event" ? [m.event] : [])),
    types: () => got.flatMap((m) => (m.t === "event" ? [m.event.type] : [])),
  };
}

function room(script: readonly FakeAttempt[]) {
  const fake = fakeClaude(script);
  const r = new Room("abcdef12", { clients: { "anthropic-api": fake } });
  const ana = inbox();
  r.join({ id: "ana", name: "Ana" }, ana.send);
  return { r, fake, ana };
}

describe("Room", () => {
  it("greets with the log, and tells everyone who is here", () => {
    const { r, ana } = room([]);
    expect(ana.got[0]).toMatchObject({ t: "hello", you: { id: "ana", name: "Ana", color: PARTICIPANT_COLORS[0] }, room: { id: "abcdef12" }, events: [], claude: "idle" });
    const luis = inbox();
    r.join({ id: "luis", name: "Luis" }, luis.send);
    expect(luis.got[0]).toMatchObject({ t: "hello", you: { color: PARTICIPANT_COLORS[1] }, participants: [{ id: "ana" }, { id: "luis" }] });
    expect(ana.got.at(-1)).toMatchObject({ t: "presence", participants: [{ name: "Ana" }, { name: "Luis" }] });
  });

  it("draws what was said: the ops are applied and logged in order, with the request around them", async () => {
    const { r, fake, ana } = room([answer(["create_zone", zone("a")], ["add_component", comp("api")], ["update_summary", JSON.stringify({ text: "An API." })])]);
    r.handle("ana", say("there is an API"));
    await r.idle();
    expect(ana.types()).toEqual(["message", "request", "op", "op", "op", "request_end"]);
    const evs = ana.events();
    expect(evs.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(evs[0]).toMatchObject({ type: "message", by: "ana", name: "Ana", text: "there is an API", mode: "content" });
    expect(evs[1]).toMatchObject({ type: "request", n: 1, model: "claude-haiku-5-5", mode: "content", batch: "[Ana] there is an API", promptVersion: PROMPT_VERSION });
    expect(evs[3]).toMatchObject({ type: "op", request: 1, op: { name: "add_component", input: { id: "api" } } });
    expect(evs[5]).toMatchObject({ type: "request_end", n: 1, ops: 3, usage: { input_tokens: 100, output_tokens: 20 }, warnings: [] });
    expect((evs[5] as Extract<RoomEvent, { type: "request_end" }>).costUsd).toBeGreaterThan(0);
    expect(r.currentBoard().elements.map((e) => e.id)).toEqual(["api"]);
    expect(r.currentBoard().summary).toBe("An API.");
    // Claude's status goes thinking, drawing, idle
    expect(ana.got.flatMap((m) => (m.t === "claude" ? [m.status] : []))).toEqual(["thinking", "drawing", "idle"]);
    // the request is a room request: room rules, room tools, the board as text
    const p = fake.calls[0].params;
    expect(p.opSet).toBe("room");
    expect(p.system.map((b) => b.text)).toContain(ROOM_RULES);
    expect(p.system.at(-1)).toEqual({ text: "All drawn text must be in English." });
    expect(p.userText).toContain("NEW SPOKEN FRAGMENT:\n[Ana] there is an API");
  });

  it("joins what several people say meanwhile into one batch, each line with its speaker; an instruction goes alone", async () => {
    const { r, fake } = room([answer(["create_zone", zone("a")]), answer(["update_summary", JSON.stringify({ text: "s" })]), answer(["update_summary", JSON.stringify({ text: "s" })])]);
    r.join({ id: "luis", name: "Luis" }, () => {});
    r.handle("ana", say("first"));
    r.handle("luis", say("the queue feeds a worker"));
    r.handle("ana", say("and the worker writes to S3"));
    r.handle("luis", say("make it a flow", "instruction"));
    await r.idle();
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[0].params.userText).toContain("NEW SPOKEN FRAGMENT:\n[Ana] first");
    expect(fake.calls[1].params.userText).toContain("NEW SPOKEN FRAGMENT:\n[Luis] the queue feeds a worker\n[Ana] and the worker writes to S3");
    // the second request saw the board the first one drew
    expect(fake.calls[1].params.userText).toContain("- a [system]");
    expect(fake.calls[2].params.userText).toContain("USER INSTRUCTION");
    expect(fake.calls[2].params.userText).toContain("[Luis] make it a flow");
    expect(fake.calls[2].params).toMatchObject({ effort: "medium", maxTokens: 8192 });
  });

  it("say is logged for the room and never applied to the board", async () => {
    const { r, ana } = room([answer(["say", JSON.stringify({ text: "Ana, which database?", target: "api" })], ["update_summary", JSON.stringify({ text: "s" })])]);
    r.handle("ana", say("Grafito, what do you think?"));
    await r.idle();
    expect(ana.types()).toEqual(["message", "request", "say", "op", "request_end"]);
    expect(ana.events()[2]).toMatchObject({ type: "say", text: "Ana, which database?", target: "api", request: 1 });
    expect(ana.events().at(-1)).toMatchObject({ ops: 2, warnings: [] });
  });

  it("logs an op the board refuses, and reports why", async () => {
    const { r, ana } = room([answer(["add_component", comp("api", "nowhere")], ["bogus", "{}"])]);
    r.handle("ana", say("an API"));
    await r.idle();
    expect(ana.types()).toEqual(["message", "request", "op", "request_end"]);
    const end = ana.events().at(-1) as Extract<RoomEvent, { type: "request_end" }>;
    expect(end.warnings).toEqual([expect.stringContaining("zone 'nowhere' does not exist"), expect.stringContaining("bogus")]);
  });

  it("a failed request ends with its error, and the room goes on", async () => {
    const { r, ana } = room([[fail(400, "bad")], answer(["create_zone", zone("a")])]);
    r.handle("ana", say("one"));
    await r.idle();
    expect(ana.events().at(-1)).toMatchObject({ type: "request_end", ops: 0, error: "Error calling Claude (HTTP 400): bad" });
    r.handle("ana", say("two"));
    await r.idle();
    expect(ana.events().at(-1)).toMatchObject({ type: "request_end", n: 2, ops: 1 });
    expect(ana.events().at(-1)).not.toHaveProperty("error");
  });

  it("without a provider for the model, the request ends with the error and Claude is never called", async () => {
    const r = new Room("abcdef12", { clients: {} });
    const ana = inbox();
    r.join({ id: "ana", name: "Ana" }, ana.send);
    r.handle("ana", say("hola"));
    await r.idle();
    expect(ana.types()).toEqual(["message", "request", "request_end"]);
    expect(ana.events().at(-1)).toMatchObject({ error: "Missing API key in .env", ops: 0 });
  });

  it("strokes are logged under whoever sent them; drafts and cursors go to the others only", () => {
    const { r, ana } = room([]);
    const luis = inbox();
    r.join({ id: "luis", name: "Luis" }, luis.send);
    r.handle("ana", { t: "stroke", stroke: stroke("s1") });
    r.handle("ana", { t: "stroke", stroke: stroke("s1") }); // the same id again: ignored
    expect(luis.events()).toEqual([expect.objectContaining({ type: "stroke", stroke: { ...stroke("s1"), by: "ana" } })]);
    const before = ana.got.length;
    r.handle("ana", { t: "draft", stroke: stroke("d1") });
    r.handle("ana", { t: "cursor", at: { x: 5, y: 6 } });
    expect(ana.got.length).toBe(before);
    expect(luis.got.slice(-2)).toEqual([{ t: "draft", id: "ana", stroke: { ...stroke("d1"), by: "ana" } }, { t: "cursor", id: "ana", at: { x: 5, y: 6 } }]);
    r.handle("luis", { t: "erase", ids: ["s1", "ghost"] });
    expect(ana.events().at(-1)).toMatchObject({ type: "erase", ids: ["s1"], by: "luis" });
    r.handle("luis", { t: "erase", ids: ["s1"] }); // already gone: nothing logged
    expect(ana.types()).toEqual(["stroke", "erase"]);
  });

  it("a sketch Claude draws from is erased; one it draws nothing from stays", async () => {
    const { r, fake, ana } = room([answer(["create_zone", zone("a")], ["update_summary", JSON.stringify({ text: "s" })]), answer(["update_summary", JSON.stringify({ text: "s" })])]);
    r.handle("ana", { t: "stroke", stroke: stroke("s1") });
    r.handle("ana", { t: "stroke", stroke: stroke("s2") });
    r.handle("ana", { t: "stroke", stroke: stroke("s3") });
    r.handle("ana", { t: "erase", ids: ["s2"] });
    r.handle("ana", { t: "sketch", sketch: { strokeIds: ["s1", "s2"], hints: "STROKES (2)", image: "aGk=" }, settings });
    await r.idle();
    expect(ana.types().slice(4)).toEqual(["message", "request", "op", "op", "request_end", "erase"]);
    expect(ana.events().at(-1)).toMatchObject({ type: "erase", ids: ["s1"], by: CLAUDE_ID });
    expect(ana.events()[5]).toMatchObject({ type: "request", mode: "sketch", batch: "[Ana] sketch\nSTROKES (2)" });
    const p = fake.calls[0].params;
    expect(p.image).toEqual({ mediaType: "image/png", data: "aGk=" });
    expect(p.system.map((b) => b.text).slice(1)).toEqual([ROOM_RULES, SKETCH_RULES, "All drawn text must be in English."]);
    expect(p.userText).toContain("USER SKETCH (drawn by hand on the board; turn it into board elements):\nSTROKES (2)");

    r.handle("ana", { t: "sketch", sketch: { strokeIds: ["s3"], hints: "STROKES (1)" }, settings });
    await r.idle();
    expect(ana.types().at(-1)).toBe("request_end");
  });

  it("reset wipes board, sketch and log, drops the request in flight, and the log starts again", async () => {
    const { r, fake, ana } = room(["hang", answer(["create_zone", zone("b")])]);
    r.handle("ana", { t: "stroke", stroke: stroke("s1") });
    r.handle("ana", say("this will be dropped"));
    r.handle("ana", say("so will this"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    r.handle("ana", { t: "reset" });
    expect(fake.calls[0].signal.aborted).toBe(true);
    await r.idle();
    r.handle("ana", say("fresh start"));
    await r.idle();
    expect(r.snapshot().events.map((e) => e.type)).toEqual(["reset", "message", "request", "op", "request_end"]);
    expect(r.snapshot().events[0]).toMatchObject({ type: "reset", by: "ana", seq: 5 });
    expect(r.currentBoard().zones.map((z) => z.id)).toEqual(["b"]);
    expect(ana.got.filter((m) => m.t === "claude").at(-1)).toEqual({ t: "claude", status: "idle" });
    // someone who joins now gets only the new log, and no ink
    const late = inbox();
    r.join({ id: "luis", name: "Luis" }, late.send);
    expect(late.got[0]).toMatchObject({ t: "hello", events: [{ type: "reset" }, { type: "message" }, { type: "request" }, { type: "op" }, { type: "request_end" }] });
  });

  it("someone who joins late gets the whole log", async () => {
    const { r } = room([answer(["create_zone", zone("a")])]);
    r.handle("ana", { t: "stroke", stroke: stroke("s1") });
    r.handle("ana", say("hola"));
    await r.idle();
    const late = inbox();
    r.join({ id: "luis", name: "Luis" }, late.send);
    const hello = late.got[0] as Extract<ServerMessage, { t: "hello" }>;
    expect(hello.events.map((e) => e.type)).toEqual(["stroke", "message", "request", "op", "request_end"]);
    expect(hello.events).toEqual(r.snapshot().events);
  });

  it("the same id on two connections is one person, who leaves when the last one closes", () => {
    const { r, ana } = room([]);
    const tab2 = inbox();
    const leave2 = r.join({ id: "ana", name: "Ana again" }, tab2.send);
    expect(r.participants()).toEqual([{ id: "ana", name: "Ana", color: PARTICIPANT_COLORS[0] }]);
    expect(tab2.got[0]).toMatchObject({ t: "hello", you: { name: "Ana" } });
    r.handle("ana", { t: "stroke", stroke: stroke("s1") });
    expect(tab2.types()).toEqual(["stroke"]);
    expect(ana.types()).toEqual(["stroke"]);
    leave2();
    leave2();
    expect(r.participants()).toHaveLength(1);
    r.handle("ana", { t: "rename", name: "Anita" });
    expect(ana.got.at(-1)).toEqual({ t: "presence", participants: [{ id: "ana", name: "Anita", color: PARTICIPANT_COLORS[0] }] });
  });

  it("colours go in join order, skip the ones in use, and come back with their owner", () => {
    const { r } = room([]);
    const leaveLuis = r.join({ id: "luis", name: "Luis" }, () => {});
    r.join({ id: "eva", name: "Eva" }, () => {});
    leaveLuis();
    r.join({ id: "noa", name: "Noa" }, () => {});
    r.join({ id: "luis", name: "Luis" }, () => {});
    expect(r.participants().map((p) => [p.id, p.color])).toEqual([["ana", PARTICIPANT_COLORS[0]], ["eva", PARTICIPANT_COLORS[2]], ["noa", PARTICIPANT_COLORS[1]], ["luis", PARTICIPANT_COLORS[3]]]);
  });

  it("someone who is not in the room is ignored", () => {
    const { r, ana } = room([]);
    r.handle("ghost", { t: "stroke", stroke: stroke("s1") });
    expect(ana.types()).toEqual([]);
  });
});

describe("RoomRegistry", () => {
  const withDir = async (fn: (dir: string) => Promise<void>) => {
    const dir = await mkdtemp(join(tmpdir(), "grafito-rooms-"));
    try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
  };

  it("makes rooms with a URL-safe id, seeded with a board", async () => {
    const reg = new RoomRegistry({ clients: {}, dir: null });
    const r = reg.create([op.create_zone({ id: "a", kind: "system", title: "A" }), op.add_component({ zone: "a", id: "api", label: "API", type: "service" })]);
    expect(r.id).toMatch(/^[a-z0-9]{8}$/);
    expect(await reg.get(r.id)).toBe(r);
    expect(r.snapshot().events).toMatchObject([{ seq: 1, type: "op", request: 0, op: { name: "create_zone" } }, { seq: 2, type: "op", request: 0, op: { name: "add_component" } }]);
    expect(r.currentBoard().elements).toHaveLength(1);
    expect(await reg.get("nosuchroom")).toBeUndefined();
    expect(await reg.get("../etc")).toBeUndefined();
  });

  it("saves a room and another registry loads it back: same log, board and ink", async () => {
    await withDir(async (dir) => {
      const fake = fakeClaude([answer(["create_zone", zone("a")], ["add_component", comp("api")])]);
      const reg = new RoomRegistry({ clients: { "anthropic-api": fake }, dir, saveDelayMs: 5 });
      const r = reg.create();
      r.join({ id: "ana", name: "Ana" }, () => {});
      r.handle("ana", { t: "stroke", stroke: stroke("s1") });
      r.handle("ana", { t: "stroke", stroke: stroke("s2") });
      r.handle("ana", { t: "erase", ids: ["s1"] });
      r.handle("ana", say("an API"));
      await r.idle();
      await reg.flush();
      expect(JSON.parse(await readFile(join(dir, `${r.id}.json`), "utf8"))).toMatchObject({ id: r.id, createdAt: r.createdAt });

      const again = new RoomRegistry({ clients: { "anthropic-api": fakeClaude([answer(["add_component", comp("db")])]) }, dir, saveDelayMs: 5 });
      const loaded = (await again.get(r.id))!;
      expect(loaded).not.toBe(r);
      expect(loaded.createdAt).toBe(r.createdAt);
      expect(loaded.snapshot().events).toEqual(r.snapshot().events);
      expect(loaded.currentBoard()).toEqual(r.currentBoard());
      expect(await again.get(r.id)).toBe(loaded);
      // it goes on where it left: numbering continues, the ink that was left is still there to erase
      const ana = inbox();
      loaded.join({ id: "ana", name: "Ana" }, ana.send);
      loaded.handle("ana", { t: "erase", ids: ["s1", "s2"] });
      loaded.handle("ana", say("and a database"));
      await loaded.idle();
      // (the erased stroke and its erase are not in the log, so the next number is not the log's length)
      expect(ana.events()[0]).toMatchObject({ type: "erase", ids: ["s2"], seq: r.snapshot().events.at(-1)!.seq + 1 });
      expect(ana.events().at(-1)).toMatchObject({ type: "request_end", n: 2 });
      expect(loaded.currentBoard().elements.map((e) => e.id)).toEqual(["api", "db"]);
      await again.flush();
    });
  });

  it("a file that is not a room is not loaded", async () => {
    await withDir(async (dir) => {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(dir, "broken12.json"), "{ not json");
      await writeFile(join(dir, "other123.json"), JSON.stringify({ id: "someone1", createdAt: 1, events: [] }));
      const reg = new RoomRegistry({ clients: {}, dir });
      expect(await reg.get("broken12")).toBeUndefined();
      expect(await reg.get("other123")).toBeUndefined();
    });
  });
});
