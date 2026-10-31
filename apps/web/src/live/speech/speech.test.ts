import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGrouper, GROUP_WINDOW_MS, GROUP_MAX_CHARS, INSTRUCTION_WINDOW_MS } from "./grouper";
import { WebSpeechSource, MAX_RETRIES, BACKOFF_BASE_MS, START_TIMEOUT_MS, UNAVAILABLE_MESSAGE } from "./webSpeech";
import type { SpeechSource, SpeechState } from "./types";

// Fuente falsa: cumple la interfaz y deja disparar eventos a mano.
class FakeSource implements SpeechSource {
  onInterim = (_: string) => {}; onFinal = (_: string) => {}; onState = (_: SpeechState, __?: string) => {};
  started = false;
  start() { this.started = true; this.onState("listening"); }
  stop() { this.started = false; this.onState("idle"); }
}

describe("grouper", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("vacía tras la ventana sin finales nuevos y junta lo recibido", () => {
    const out: [string, number][] = [];
    const g = createGrouper((t, at) => out.push([t, at]));
    const src = new FakeSource(); src.onFinal = g.push; src.start();
    src.onFinal("hola"); vi.advanceTimersByTime(500);
    src.onFinal("mundo");
    const lastAt = Date.now();
    vi.advanceTimersByTime(GROUP_WINDOW_MS - 1);
    expect(out).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(out).toEqual([["hola mundo", lastAt]]);
  });

  it("vacía de inmediato si el búfer supera el máximo", () => {
    const out: string[] = [];
    const g = createGrouper((t) => out.push(t));
    g.push("a".repeat(GROUP_MAX_CHARS + 1));
    expect(out.length).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(out.length).toBe(1);
  });

  it("con palabra de activación espera la ventana larga", () => {
    const out: string[] = [];
    const g = createGrouper((t) => out.push(t));
    g.push("Grafito, separa en dos");
    vi.advanceTimersByTime(GROUP_WINDOW_MS + 100);
    g.push("diagramas la opción con BFF");
    vi.advanceTimersByTime(INSTRUCTION_WINDOW_MS - 1);
    expect(out).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(out).toEqual(["Grafito, separa en dos diagramas la opción con BFF"]);
  });

  it("con palabra de activación no vacía por máximo de caracteres", () => {
    const out: string[] = [];
    const g = createGrouper((t) => out.push(t));
    g.push("grafito " + "a".repeat(GROUP_MAX_CHARS + 1));
    expect(out).toEqual([]);
    vi.advanceTimersByTime(INSTRUCTION_WINDOW_MS);
    expect(out.length).toBe(1);
  });

  it("cancel descarta lo pendiente", () => {
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
  beforeEach(() => { vi.useFakeTimers(); FakeRec.instances = []; });
  afterEach(() => { vi.useRealTimers(); });
  const mk = () => {
    const s = new WebSpeechSource("es-CL", FakeRec);
    const states: SpeechState[] = []; const details: (string | undefined)[] = [];
    s.onState = (st, d) => { states.push(st); details.push(d); };
    return { s, states, details };
  };

  it("configura continuo, parciales e idioma", () => {
    const { s } = mk(); s.lang = "es-MX"; s.start();
    const r = FakeRec.instances[0];
    expect([r.continuous, r.interimResults, r.lang]).toEqual([true, true, "es-MX"]);
  });

  it("onend con la fuente activa reinicia", () => {
    const { s, states } = mk(); s.start();
    FakeRec.instances[0].onend();
    expect(states).toContain("restarting");
    vi.advanceTimersByTime(BACKOFF_BASE_MS);
    expect(FakeRec.instances.length).toBe(2);
    expect(states[states.length - 1]).toBe("listening");
  });

  it("tras stop no reinicia", () => {
    const { s } = mk(); s.start(); s.stop();
    vi.advanceTimersByTime(60000);
    expect(FakeRec.instances.length).toBe(1);
  });

  it("stop durante el backoff cancela el reinicio", () => {
    const { s } = mk(); s.start();
    FakeRec.instances[0].onend(); s.stop();
    vi.advanceTimersByTime(60000);
    expect(FakeRec.instances.length).toBe(1);
  });

  it("limita los reintentos y muestra error", () => {
    const { s, states, details } = mk(); s.start();
    for (let i = 0; i < MAX_RETRIES; i++) {
      const r = FakeRec.instances[FakeRec.instances.length - 1];
      r.onerror({ error: "network" }); r.onend();
      vi.advanceTimersByTime(60000);
    }
    expect(FakeRec.instances.length).toBe(MAX_RETRIES + 1);
    FakeRec.instances[FakeRec.instances.length - 1].onend();
    expect(states[states.length - 1]).toBe("error");
    expect(details[details.length - 1]).toMatch(/red/);
    vi.advanceTimersByTime(60000);
    expect(FakeRec.instances.length).toBe(MAX_RETRIES + 1);
  });

  it("no-speech reinicia sin gastar reintentos", () => {
    const { s, states } = mk(); s.start();
    for (let i = 0; i < MAX_RETRIES * 3; i++) {
      const r = FakeRec.instances[FakeRec.instances.length - 1];
      r.onerror({ error: "no-speech" }); r.onend(); vi.advanceTimersByTime(BACKOFF_BASE_MS);
    }
    expect(states).not.toContain("error");
  });

  it("not-allowed es fatal y no reinicia", () => {
    const { s, states, details } = mk(); s.start();
    const r = FakeRec.instances[0];
    r.onerror({ error: "not-allowed" }); r.onend();
    vi.advanceTimersByTime(60000);
    expect(FakeRec.instances.length).toBe(1);
    expect(states[states.length - 1]).toBe("error");
    expect(details[details.length - 1]).toMatch(/micrófono/);
  });

  it("start() que lanza se reprograma y luego llega a listening", () => {
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

  it("instancia que nunca arranca: el watchdog la aborta y al agotar reintentos da error", () => {
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
    expect(details[details.length - 1]).toMatch(/pulsa Hablar otra vez/);
  });

  it("onend tardío de una instancia vieja no provoca spawn extra", () => {
    const { s } = mk(); s.start();
    const viejo = FakeRec.instances[0].onend;
    FakeRec.instances[0].onend();
    vi.advanceTimersByTime(BACKOFF_BASE_MS);
    expect(FakeRec.instances.length).toBe(2);
    viejo();
    vi.advanceTimersByTime(60000);
    expect(FakeRec.instances.length).toBe(2);
  });

  it("stop cancela watchdog y timers", () => {
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

  it("separa parciales y finales", () => {
    const { s } = mk(); const fin: string[] = [], int: string[] = [];
    s.onFinal = (t) => fin.push(t); s.onInterim = (t) => int.push(t); s.start();
    FakeRec.instances[0].onresult({ resultIndex: 0, results: [Object.assign([{ transcript: " hola " }], { isFinal: true }), Object.assign([{ transcript: "que" }], { isFinal: false })] });
    expect(fin).toEqual(["hola"]); expect(int).toEqual(["que"]);
  });

  it("API no disponible: error en español y no revienta", () => {
    const s = new WebSpeechSource("es-CL", null);
    let st = "", d = ""; s.onState = (a, b) => { st = a; d = b ?? ""; };
    expect(s.available).toBe(false);
    s.start();
    expect(st).toBe("error"); expect(d).toBe(UNAVAILABLE_MESSAGE);
  });
});
