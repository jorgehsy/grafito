import { describe, it, expect } from "vitest";
import { createScheduler } from "./scheduler";

const defer = () => {
  let resolve!: () => void;
  const p = new Promise<void>((r) => (resolve = r));
  return { p, resolve };
};

describe("scheduler", () => {
  it("keeps one request in flight and batches what accumulates", async () => {
    const calls: string[] = [];
    const gates = [defer(), defer()];
    let active = 0, maxActive = 0, i = 0;
    const s = createScheduler(async (t) => {
      calls.push(t);
      active++; maxActive = Math.max(maxActive, active);
      await gates[i++].p;
      active--;
    });
    s.onFragment("one");
    s.onFragment("two");
    s.onFragment("three");
    expect(calls).toEqual(["one"]);
    expect(s.pending()).toBe("two three");
    gates[0].resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(["one", "two three"]);
    gates[1].resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(maxActive).toBe(1);
    expect(s.isBusy()).toBe(false);
  });
  it("stop drops what is pending", async () => {
    const g = defer();
    const calls: string[] = [];
    const s = createScheduler(async (t) => { calls.push(t); await g.p; });
    s.onFragment("a"); s.onFragment("b");
    s.stop();
    g.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(["a"]);
  });
});

describe("scheduler modes", () => {
  it("joins content, sends each instruction alone and in order", async () => {
    const calls: [string, string][] = [];
    const gate = defer();
    const s = createScheduler(async (t, m) => { calls.push([t, m]); if (calls.length === 1) await gate.p; });
    s.onFragment("one");
    s.onFragment("two");
    s.onFragment("split", "instruction");
    s.onFragment("three", "instruction");
    s.onFragment("four");
    gate.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([["one", "content"], ["two", "content"], ["split", "instruction"], ["three", "instruction"], ["four", "content"]]);
  });
});
