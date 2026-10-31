import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGrouper, GROUP_WINDOW_MS, GROUP_MAX_CHARS, INSTRUCTION_WINDOW_MS } from "./grouper";
import { WebSpeechSource, MAX_RETRIES, BACKOFF_BASE_MS, START_TIMEOUT_MS, } from "./webSpeech";
import { setLang, t } from "../../i18n";
import type { SpeechSource, SpeechState } from "./types";

// Fake source: satisfies the interface and lets tests fire events by hand.
class FakeSource implements SpeechSource {
  onInterim = (_: string) => {}; onFinal = (_: string) => {}; onState = (_: SpeechState, __?: string) => {};
  started = false;
  start() { this.started = true; this.onState("listening"); }
  stop() { this.started = false; this.onState("idle"); }
}

describe("grouper", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("flushes after the window with no new results and joins what it received", () => {
    const out: [string, number][] = [];
    const g = createGrouper((t, at) => out.push([t, at]));
    const src = new FakeSource(); src.onFinal = g.push; src.start();
    src.onFinal("hello"); vi.advanceTimersByTime(500);
    src.onFinal("world");
    const lastAt = Date.now();
    vi.advanceTimersByTime(GROUP_WINDOW_MS - 1);
    expect(out).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(out).toEqual([["hello world", lastAt]]);
  });

  it("flushes at once when the buffer exceeds the maximum", () => {
    const out: string[] = [];
    const g = createGrouper((t) => out.push(t));
    g.push("a".repeat(GROUP_MAX_CHARS + 1));
    expect(out.length).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(out.length).toBe(1);
  });

  it("waits the longer window when the wake word is present", () => {
    const out: string[] = [];
    const g = createGrouper((t) => out.push(t));
    g.push("Grafito, split into two");
    vi.advanceTimersByTime(GROUP_WINDOW_MS + 100);
    g.push("diagrams the BFF option");
    vi.advanceTimersByTime(INSTRUCTION_WINDOW_MS - 1);
    expect(out).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(out).toEqual(["Grafito, split into two diagrams the BFF option"]);
  });

  it("does not flush on the character maximum when the wake word is present", () => {
    const out: string[] = [];
    const g = createGrouper((t) => out.push(t));
    g.push("grafito " + "a".repeat(GROUP_MAX_CHARS + 1));
    expect(out).toEqual([]);
    vi.advanceTimersByTime(INSTRUCTION_WINDOW_MS);
    expect(out.length).toBe(1);
  });

  it("cancel drops what is pending", () => {
    const out: string[] = [];
    const g = createGrouper((t) => out.push(t));
    g.push("x"); g.cancel(); vi.advanceTimersByTime(5000);
    expect(out).toEqual([]);
  });
});

class FakeRec {
  static instances: FakeRec[] = [];
  continuous = false; interimResults = false; lang = "";
  onstart: any; onresult: any; onerror: any; onend: any;
  constructor() { FakeRec.instances.push(this); }
  start() { this.onstart?.(); }
  stop() { this.onend?.(); }
}

describe("WebSpeechSource", () => {
  beforeEach(() => setLang("en-US"));
  beforeEach(() => { vi.useFakeTimers(); FakeRec.instances = []; });
  afterEach(() => { vi.useRealTimers(); });
  const mk = () => {
    const s = new WebSpeechSource("es-CL", FakeRec);
    const states: SpeechState[] = []; const details: (string | undefined)[] = [];
    s.onState = (st, d) => { states.push(st); details.push(d); };
    return { s, states, details };
  };

  it("sets continuous, interim results and language", () => {
    const { s } = mk(); s.lang = "es-MX"; s.start();
    const r = FakeRec.instances[0];
    expect([r.continuous, r.interimResults, r.lang]).toEqual([true, true, "es-MX"]);
  });

  it("onend with an active source restarts", () => {
    const { s, states } = mk(); s.start();
    FakeRec.instances[0].onend();
    expect(states).toContain("restarting");
    vi.advanceTimersByTime(BACKOFF_BASE_MS);
    expect(FakeRec.instances.length).toBe(2);
    expect(states[states.length - 1]).toBe("listening");
  });

  it("does not restart after stop", () => {
    const { s } = mk(); s.start(); s.stop();
    vi.advanceTimersByTime(60000);
    expect(FakeRec.instances.length).toBe(1);
  });

  it("stop during backoff cancels the restart", () => {
    const { s } = mk(); s.start();
    FakeRec.instances[0].onend(); s.stop();
    vi.advanceTimersByTime(60000);
    expect(FakeRec.instances.length).toBe(1);
  });

  it("caps retries and shows an error", () => {
    const { s, states, details } = mk(); s.start();
    for (let i = 0; i < MAX_RETRIES; i++) {
      const r = FakeRec.instances[FakeRec.instances.length - 1];
      r.onerror({ error: "network" }); r.onend();
      vi.advanceTimersByTime(60000);
    }
    expect(FakeRec.instances.length).toBe(MAX_RETRIES + 1);
    FakeRec.instances[FakeRec.instances.length - 1].onend();
    expect(states[states.length - 1]).toBe("error");
    expect(details[details.length - 1]).toMatch(/network/);
    vi.advanceTimersByTime(60000);
    expect(FakeRec.instances.length).toBe(MAX_RETRIES + 1);
  });

  it("no-speech restarts without spending retries", () => {
    const { s, states } = mk(); s.start();
    for (let i = 0; i < MAX_RETRIES * 3; i++) {
      const r = FakeRec.instances[FakeRec.instances.length - 1];
      r.onerror({ error: "no-speech" }); r.onend(); vi.advanceTimersByTime(BACKOFF_BASE_MS);
    }
    expect(states).not.toContain("error");
  });

  it("not-allowed is fatal and does not restart", () => {
    const { s, states, details } = mk(); s.start();
    const r = FakeRec.instances[0];
    r.onerror({ error: "not-allowed" }); r.onend();
    vi.advanceTimersByTime(60000);
    expect(FakeRec.instances.length).toBe(1);
    expect(states[states.length - 1]).toBe("error");
    expect(details[details.length - 1]).toMatch(/Microphone/);
  });

  it("a start() that throws is rescheduled and then reaches listening", () => {
    let n = 0;
    class ThrowOnce extends FakeRec { start() { if (n++ === 0) throw new Error("InvalidStateError"); super.start(); } }
    const s = new WebSpeechSource("es-CL", ThrowOnce);
    const states: SpeechState[] = []; s.onState = (st) => states.push(st);
    s.start();
    expect(states).toContain("restarting");
    vi.advanceTimersByTime(BACKOFF_BASE_MS);
    expect(FakeRec.instances.length).toBe(2);
    expect(states[states.length - 1]).toBe("listening");
  });

  it("an instance that never starts: the watchdog aborts it and an error follows when retries run out", () => {
    const aborted: any[] = [];
    class Silent extends FakeRec { start() {} abort() { aborted.push(this); } }
    const s = new WebSpeechSource("es-CL", Silent);
    const states: SpeechState[] = []; const details: (string | undefined)[] = [];
    s.onState = (st, d) => { states.push(st); details.push(d); };
    s.start();
    vi.advanceTimersByTime(START_TIMEOUT_MS);
    expect(aborted.length).toBe(1);
    expect(states[states.length - 1]).toBe("restarting");
    vi.advanceTimersByTime(60000);
    expect(FakeRec.instances.length).toBeGreaterThan(1);
    vi.advanceTimersByTime(10 * 60000);
    expect(FakeRec.instances.length).toBe(MAX_RETRIES + 1);
    expect(states[states.length - 1]).toBe("error");
    expect(details[details.length - 1]).toMatch(/press Talk again/);
  });

  it("a late onend from an old instance causes no extra spawn", () => {
    const { s } = mk(); s.start();
    const viejo = FakeRec.instances[0].onend;
    FakeRec.instances[0].onend();
    vi.advanceTimersByTime(BACKOFF_BASE_MS);
    expect(FakeRec.instances.length).toBe(2);
    viejo();
    vi.advanceTimersByTime(60000);
    expect(FakeRec.instances.length).toBe(2);
  });

  it("stop cancels watchdog and timers", () => {
    class Silent extends FakeRec { start() {} }
    const s = new WebSpeechSource("es-CL", Silent);
    s.start(); s.stop();
    vi.advanceTimersByTime(60000);
    expect(FakeRec.instances.length).toBe(1);
    const { s: s2 } = mk(); s2.start();
    FakeRec.instances[FakeRec.instances.length - 1].onend(); s2.stop();
    const n = FakeRec.instances.length;
    vi.advanceTimersByTime(60000);
    expect(FakeRec.instances.length).toBe(n);
  });

  it("separates interim and final results", () => {
    const { s } = mk(); const fin: string[] = [], int: string[] = [];
    s.onFinal = (t) => fin.push(t); s.onInterim = (t) => int.push(t); s.start();
    FakeRec.instances[0].onresult({ resultIndex: 0, results: [Object.assign([{ transcript: " hello " }], { isFinal: true }), Object.assign([{ transcript: "what" }], { isFinal: false })] });
    expect(fin).toEqual(["hello"]); expect(int).toEqual(["what"]);
  });

  it("API unavailable: reports an error and does not blow up", () => {
    const s = new WebSpeechSource("es-CL", null);
    let st = "", d = ""; s.onState = (a, b) => { st = a; d = b ?? ""; };
    expect(s.available).toBe(false);
    s.start();
    expect(st).toBe("error"); expect(d).toBe(t("speech.unavailable"));
  });
});
