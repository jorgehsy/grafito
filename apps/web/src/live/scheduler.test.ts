import { describe, it, expect } from "vitest";
import { createScheduler } from "./scheduler";

const defer = () => {
  let resolve!: () => void;
  const p = new Promise<void>((r) => (resolve = r));
  return { p, resolve };
};

describe("scheduler", () => {
  it("una sola petición en vuelo y junta lo acumulado", async () => {
    const calls: string[] = [];
    const gates = [defer(), defer()];
    let active = 0, maxActive = 0, i = 0;
    const s = createScheduler(async (t) => {
      calls.push(t);
      active++; maxActive = Math.max(maxActive, active);
      await gates[i++].p;
      active--;
    });
    s.onFinalText("uno");
    s.onFinalText("dos");
    s.onFinalText("tres");
    expect(calls).toEqual(["uno"]);
    expect(s.pending()).toBe("dos tres");
    gates[0].resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(["uno", "dos tres"]);
    gates[1].resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(maxActive).toBe(1);
    expect(s.isBusy()).toBe(false);
  });
  it("stop descarta lo pendiente", async () => {
    const g = defer();
    const calls: string[] = [];
    const s = createScheduler(async (t) => { calls.push(t); await g.p; });
    s.onFinalText("a"); s.onFinalText("b");
    s.stop();
    g.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(["a"]);
  });
});

describe("scheduler con tipos", () => {
  it("junta contenido, envía cada instrucción sola y en orden", async () => {
    const calls: [string, string][] = [];
    const gate = defer();
    const s = createScheduler(async (t, k) => { calls.push([t, k]); if (calls.length === 1) await gate.p; });
    s.onFinalText("uno");
    s.onFinalText("dos");
    s.onFinalText("separa", "instruction");
    s.onFinalText("tres", "instruction");
    s.onFinalText("cuatro");
    gate.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([["uno", "content"], ["dos", "content"], ["separa", "instruction"], ["tres", "instruction"], ["cuatro", "content"]]);
  });
});
