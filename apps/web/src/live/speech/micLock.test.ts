import { describe, it, expect, vi } from "vitest";
import { createMicLock } from "./micLock";

// canal falso compartido: lo que una pestaña publica llega a las demás
function fakeBus() {
  const subs: any[] = [];
  return () => {
    const ch: any = { onmessage: null, close: vi.fn(), postMessage: (m: any) => subs.forEach((s) => s !== ch && s.onmessage?.({ data: m })) };
    subs.push(ch);
    return ch;
  };
}

describe("micLock", () => {
  it("la otra pestaña suelta el mic cuando ésta lo reclama", () => {
    const open = fakeBus();
    const takenA = vi.fn(); const takenB = vi.fn();
    const a = createMicLock(takenA, open());
    const b = createMicLock(takenB, open());
    a.claim();
    expect(takenB).toHaveBeenCalledTimes(1);
    expect(takenA).not.toHaveBeenCalled();
    b.claim();
    expect(takenA).toHaveBeenCalledTimes(1);
  });
  it("sin BroadcastChannel no rompe", () => {
    const l = createMicLock(() => {}, null);
    expect(() => { l.claim(); l.close(); }).not.toThrow();
  });
});
