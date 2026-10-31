import { describe, it, expect, vi } from "vitest";
import { createMicLock } from "./micLock";

// fake shared channel: what one tab posts reaches the others
function fakeBus() {
  const subs: any[] = [];
  return () => {
    const ch: any = { onmessage: null, close: vi.fn(), postMessage: (m: any) => subs.forEach((s) => s !== ch && s.onmessage?.({ data: m })) };
    subs.push(ch);
    return ch;
  };
}

describe("micLock", () => {
  it("the other tab releases the mic when this one claims it", () => {
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
  it("works without BroadcastChannel", () => {
    const l = createMicLock(() => {}, null);
    expect(() => { l.claim(); l.close(); }).not.toThrow();
  });
});
