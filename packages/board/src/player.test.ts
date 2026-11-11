import { describe, expect, it } from "vitest";
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import {
  MS_PER_WORD, chapterAt, demoTimeline, formatClock, latencyMs, nextChapterTime, opsUpTo, prevChapterTime, shortTitle, stateAt, timeline,
} from "./demo-timeline";
import type { Demo, SketchFrame, Subtitle } from "./demo-timeline";
import { Player } from "./player";
import { BoardController } from "./controller";
import type { Sink } from "./controller";

const zone = op.create_zone({ id: "z", kind: "flow", title: "Z" });
const node = (id: string): Op => op.add_step({ zone: "z", id, label: id });
const demo: Demo = timeline([
  { text: "one two three", ops: [zone, node("a")] },
  { text: "four five", ops: [node("b")] },
  { text: "six", ops: [node("c"), op.connect({ id: "ab", from: "a", to: "b" })] },
]);
const sketchDemo: Demo = timeline([
  { title: "Draw", text: "one two three four", ops: [zone, node("a")], strokes: [{ pts: [0, 0, 100, 0] }, { pts: [0, 10, 50, 10, 100, 10, 150, 10, 200, 10], color: "#C00" }] },
  { text: "five", ops: [node("b")] },
  { title: "More", text: "six seven", ops: [node("c")] },
]);

function record(d: Demo) {
  const log: string[] = [];
  const subs: Subtitle[] = [];
  const frames: SketchFrame[] = [];
  const jumps: { ops: Op[]; delivered: number }[] = [];
  const p = new Player(d, {
    onSubtitle: (s) => { subs.push(s); log.push(`sub:${s.spoken.length}:${s.current}`); },
    onOps: (_ops, i) => log.push(`ops:${i}`),
    onEnd: () => log.push("end"),
    onSketch: (f) => frames.push(f),
    onJump: (ops, delivered) => { jumps.push({ ops, delivered }); log.push(`jump:${delivered}`); },
  });
  return { p, log, subs, frames, jumps };
}
const run = (p: Player, ms: number, step = 20) => { for (let t = 0; t < ms; t += step) p.tick(step); };

describe("demoTimeline", () => {
  const tl = demoTimeline(demo);

  it("times each chunk: speech, then ops after the simulated latency, then a tail", () => {
    expect(tl.chunks.map((c) => c.start)).toEqual(demo.map((c) => c.at_ms));
    tl.chunks.forEach((c, i) => {
      expect(c.speakEnd).toBe(c.start + c.words.length * MS_PER_WORD);
      expect(c.opsAt).toBeGreaterThanOrEqual(c.speakEnd + latencyMs(i));
    });
    expect(tl.duration).toBe(tl.chunks[2].opsAt + 1500);
  });

  it("ops never land out of chunk order, even when a later chunk has a shorter latency", () => {
    // hand-timed chunks that overlap: chunk 1 waits 3 s and chunk 2 less, so without the clamp 2 would land first
    const d: Demo = [0, 5, 10].map((at_ms, i) => ({ at_ms, text: "x", ops: [node(`n${i}`)] }));
    const at = demoTimeline(d).chunks.map((c) => c.opsAt);
    expect(d[1].at_ms + latencyMs(1)).toBeGreaterThan(d[2].at_ms + latencyMs(2));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("without titles every chunk is a chapter named after its text", () => {
    expect(tl.chapters.map((c) => c.title)).toEqual(["one two three", "four five", "six"]);
    expect(tl.chapters.map((c) => c.start)).toEqual([0, demo[1].at_ms, demo[2].at_ms]);
    expect(tl.chapters.map((c) => c.end)).toEqual([demo[1].at_ms, demo[2].at_ms, tl.duration]);
  });

  it("with titles a chapter runs until the next titled chunk", () => {
    const s = demoTimeline(sketchDemo);
    expect(s.chapters.map((c) => [c.title, c.firstChunk, c.lastChunk])).toEqual([["Draw", 0, 1], ["More", 2, 2]]);
  });

  it("a first chunk without a title still opens a chapter", () => {
    const s = demoTimeline(timeline([{ text: "hello there", ops: [] }, { title: "Two", text: "x", ops: [] }]));
    expect(s.chapters.map((c) => c.title)).toEqual(["hello there", "Two"]);
  });

  it("an empty demo has no chapters and only the tail", () => {
    const e = demoTimeline([]);
    expect(e.chapters).toEqual([]);
    expect(chapterAt(e, 0)).toBe(-1);
    expect(stateAt(e, 500).delivered).toBe(0);
    expect(prevChapterTime(e, 500)).toBe(0);
    expect(nextChapterTime(e, 500)).toBe(e.duration);
  });

  it("shortTitle cuts at a word and formatClock prints m:ss", () => {
    expect(shortTitle("a short one.")).toBe("a short one");
    expect(shortTitle("quiero explicar cómo funciona la ventana de contexto en Claude Code", 30)).toBe("quiero explicar cómo funciona…");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(83_999)).toBe("1:23");
    expect(formatClock(600_000)).toBe("10:00");
  });
});

describe("stateAt", () => {
  const tl = demoTimeline(demo);

  it("shows the words spoken so far and the chunks already said", () => {
    const c0 = tl.chunks[0];
    expect(stateAt(tl, 0).subtitle).toEqual({ spoken: [], current: "" });
    expect(stateAt(tl, c0.start).subtitle.current).toBe("one");
    expect(stateAt(tl, c0.start + MS_PER_WORD * 2 + 1).subtitle.current).toBe("one two three");
    expect(stateAt(tl, c0.speakEnd).subtitle).toEqual({ spoken: ["one two three"], current: "" });
    expect(stateAt(tl, tl.duration).subtitle.spoken).toHaveLength(3);
  });

  it("counts delivered chunks and names the chapter", () => {
    expect(stateAt(tl, tl.chunks[0].opsAt - 1).delivered).toBe(0);
    expect(stateAt(tl, tl.chunks[0].opsAt).delivered).toBe(1);
    expect(stateAt(tl, tl.duration).delivered).toBe(3);
    expect(stateAt(tl, 0).chapter).toBe(0);
    expect(stateAt(tl, demo[1].at_ms).chapter).toBe(1);
    expect(stateAt(tl, 1e9).t).toBe(tl.duration);
    expect(stateAt(tl, -5).t).toBe(0);
    expect(opsUpTo(tl, 2)).toEqual([zone, node("a"), node("b")]);
  });

  it("chapter steps: previous goes to this chapter's start first, next to the following one or the end", () => {
    const s1 = tl.chapters[1].start, s2 = tl.chapters[2].start;
    expect(prevChapterTime(tl, s2 + 2500)).toBe(s2);
    expect(prevChapterTime(tl, s1 + 500)).toBe(0);
    expect(prevChapterTime(tl, s2 + 500)).toBe(s1);
    expect(prevChapterTime(tl, 300)).toBe(0);
    expect(nextChapterTime(tl, 0)).toBe(s1);
    expect(nextChapterTime(tl, s1)).toBe(s2);
    expect(nextChapterTime(tl, s2 + 10)).toBe(tl.duration);
  });
});

describe("sketch strokes", () => {
  const tl = demoTimeline(sketchDemo);
  const c0 = tl.chunks[0];

  it("are drawn one after another while the chunk is spoken, in proportion to their length", () => {
    const [a, b] = c0.strokes;
    expect(a.from).toBe(c0.start);
    expect(b.to).toBeCloseTo(c0.speakEnd);
    expect(a.to).toBeLessThan(b.from);
    expect((b.to - b.from) / (a.to - a.from)).toBeCloseTo(2);
    expect(a.stroke).toMatchObject({ id: "demo0_0", by: "demo", color: "#2A2A2E" });
    expect(b.stroke.color).toBe("#C00");
  });

  it("grow point by point, then wait while they are read, then are taken when the ops land", () => {
    const [a, b] = c0.strokes;
    expect(stateAt(tl, c0.start - 1).sketch).toMatchObject({ strokes: [], draft: null });
    const mid = stateAt(tl, (b.from + b.to) / 2).sketch;
    expect(mid.strokes.map((s) => s.id)).toEqual(["demo0_0"]);
    expect(mid.draft?.id).toBe("demo0_1");
    expect(mid.draft!.pts.length).toBeGreaterThanOrEqual(2);
    expect(mid.draft!.pts.length).toBeLessThan(b.stroke.pts.length);
    expect(mid.draft!.pts.length % 2).toBe(0);
    expect(mid.reading).toEqual([]);
    expect(stateAt(tl, (a.to + b.from) / 2).sketch.draft).toBeNull();
    const read = stateAt(tl, c0.speakEnd + 10).sketch;
    expect(read.strokes).toHaveLength(2);
    expect(read.reading).toEqual(["demo0_0", "demo0_1"]);
    expect(stateAt(tl, c0.opsAt).sketch).toMatchObject({ strokes: [], draft: null, reading: [] });
  });
});

describe("Player", () => {
  it("plays subtitles word by word, ops in order, and ends once", () => {
    const { p, log } = record(demo);
    run(p, p.duration + 500);
    expect(log.filter((l) => l.startsWith("ops") || l === "end")).toEqual(["ops:0", "ops:1", "ops:2", "end"]);
    expect(log.slice(0, 4)).toEqual(["sub:0:one", "sub:0:one two", "sub:0:one two three", "sub:1:"]);
    expect(p.done).toBe(true);
    const clock = p.clock;
    p.tick(1000);
    expect(p.clock).toBe(clock);
  });

  it("a big tick delivers every chunk it crossed, in order", () => {
    const { p, log } = record(demo);
    p.tick(p.duration);
    expect(log.filter((l) => l.startsWith("ops"))).toEqual(["ops:0", "ops:1", "ops:2"]);
  });

  it("seeking forward hands over the ops that rebuild the board, not animated deliveries", () => {
    const { p, log, jumps } = record(demo);
    p.seek(p.timeline.chunks[1].opsAt + 5);
    expect(jumps).toEqual([{ ops: [zone, node("a"), node("b")], delivered: 2 }]);
    expect(log.some((l) => l.startsWith("ops"))).toBe(false);
    expect(p.delivered).toBe(2);
    run(p, p.duration);
    expect(log.filter((l) => l.startsWith("ops") || l === "end")).toEqual(["ops:2", "end"]);
  });

  it("seeking back rebuilds the earlier board and playback resumes from there", () => {
    const { p, log, jumps, subs } = record(demo);
    run(p, p.duration + 100);
    expect(p.done).toBe(true);
    p.seek(p.timeline.chapters[1].start);
    expect(p.done).toBe(false);
    expect(p.chapter).toBe(1);
    // the first chunk's ops land after the second chunk starts: at that moment the board is still empty
    expect(jumps.at(-1)).toEqual({ ops: [], delivered: 0 });
    expect(subs.at(-1)).toEqual({ spoken: ["one two three"], current: "four" });
    log.length = 0;
    run(p, p.duration);
    expect(log.filter((l) => l.startsWith("ops") || l === "end")).toEqual(["ops:0", "ops:1", "ops:2", "end"]);
  });

  it("a seek that leaves the board as it is does not rebuild it", () => {
    const { p, jumps, subs } = record(demo);
    p.seek(p.timeline.chunks[0].opsAt + 1);
    p.seek(p.timeline.chunks[0].opsAt + 300);
    expect(jumps).toHaveLength(1);
    expect(subs.length).toBeGreaterThanOrEqual(2);
  });

  it("is deterministic: the state after a seek is the state of playing up to that time", () => {
    const tl = demoTimeline(sketchDemo);
    for (const t of [0, 700, 1500, tl.chunks[0].speakEnd + 100, tl.chunks[1].opsAt, tl.chapters[1].start, tl.duration - 10]) {
      const played = record(sketchDemo);
      for (let k = 0; k < t; k += 10) played.p.tick(Math.min(10, t - k));
      const sought = record(sketchDemo);
      sought.p.tick(tl.duration / 2);
      sought.p.seek(tl.duration);
      sought.p.seek(t);
      expect(sought.p.clock).toBe(t);
      expect(sought.p.delivered).toBe(played.p.delivered);
      expect(sought.p.chapter).toBe(played.p.chapter);
      expect(sought.subs.at(-1)).toEqual(played.subs.at(-1) ?? { spoken: [], current: "" });
      const empty = { strokes: [], draft: null, reading: [] };
      expect(sought.frames.at(-1)).toMatchObject(played.frames.at(-1) ?? empty);
      expect(sought.jumps.at(-1)?.ops ?? []).toEqual(opsUpTo(tl, played.p.delivered));
    }
  });

  it("seeking to the end ends the demo; seeking is clamped", () => {
    const { p, log } = record(demo);
    p.seek(1e9);
    expect(p.clock).toBe(p.duration);
    expect(log.at(-1)).toBe("end");
    p.seek(-100);
    expect(p.clock).toBe(0);
    expect(p.done).toBe(false);
  });

  it("reports the sketch as it changes", () => {
    const { p, frames } = record(sketchDemo);
    run(p, p.timeline.chunks[0].opsAt + 50, 10);
    expect(frames.some((f) => f.draft)).toBe(true);
    expect(frames.some((f) => f.reading.length === 2)).toBe(true);
    expect(frames.at(-1)).toMatchObject({ strokes: [], draft: null });
  });
});

describe("BoardController.jump", () => {
  const sinkOf = () => {
    const drawn: { key: string; speed: number }[] = [];
    const noop = async () => {};
    const sink: Sink = { draw: async (key, speed) => { drawn.push({ key, speed }); }, update: noop, ink: noop, remove: noop, move: () => {}, setTarget: () => {} };
    return { sink, drawn };
  };
  const ops = demo.flatMap((c) => c.ops);

  it("shows the board at once and gives the same tree as submitting the ops one by one", async () => {
    const a = sinkOf(), b = sinkOf();
    const stepped = new BoardController(a.sink);
    await stepped.submit(ops);
    const jumped = new BoardController(b.sink);
    await jumped.submit([zone, node("old")]);
    b.drawn.length = 0;
    let cleared = 0;
    await jumped.jump(ops, undefined, () => cleared++);
    expect(cleared).toBe(1);
    expect(jumped.board).toEqual(stepped.board);
    expect(jumped.tree.items.map((i) => [i.key, i.sig, i.geom])).toEqual(stepped.tree.items.map((i) => [i.key, i.sig, i.geom]));
    expect(b.drawn.map((d) => d.key).sort()).toEqual(jumped.tree.items.map((i) => i.key).sort());
    expect(b.drawn.every((d) => d.speed === Infinity)).toBe(true);
    expect(jumped.queue.pending).toBe(0);
  });

  it("with no ops it empties the board and still clears the sink", async () => {
    const { sink } = sinkOf();
    const c = new BoardController(sink);
    await c.submit(ops);
    let cleared = 0;
    await c.jump([], undefined, () => cleared++);
    expect(cleared).toBe(1);
    expect(c.board.zones).toEqual([]);
    expect(c.tree.items).toEqual([]);
  });

  it("a later jump cancels one still laying out", async () => {
    const { sink, drawn } = sinkOf();
    const c = new BoardController(sink);
    const first = c.jump(ops);
    const second = c.jump([zone, node("only")]);
    await Promise.all([first, second]);
    expect(c.board.elements.map((e) => e.id)).toEqual(["only"]);
    expect(drawn.some((d) => d.key.includes("only"))).toBe(true);
    expect(c.tree.items.length).toBe(drawn.length);
  });
});
