import { describe, it, expect } from "vitest";
import { stampCenter, prefixedIconBody, stampScale, phaseStarts, entrancePlan, stampMarkup, STAMP_MS } from "./stamp";
import { AWS_SERVICES } from "@grafito/icons";

describe("entrancePlan", () => {
  it("when drawing, the stamp enters after the stroke and fill, and before the text", () => {
    expect(entrancePlan("draw", true).map((f) => f.phase)).toEqual(["stroke", "fill", "stamp", "text"]);
    const starts = phaseStarts(entrancePlan("draw", true), { stroke: 900, fill: 240, text: 500 });
    expect(starts.stamp).toBe(900 + 240);
    expect(starts.text).toBe(900 + 240 + STAMP_MS);
  });
  it("without a service there is no stamp phase", () => {
    expect(entrancePlan("draw", false).map((f) => f.phase)).toEqual(["stroke", "fill", "text"]);
  });
  it("set_service on something already drawn: only the stamp, no stroke or text, starting immediately", () => {
    const plan = entrancePlan("set_service", true);
    expect(plan.map((f) => f.phase)).toEqual(["stamp"]);
    expect(phaseStarts(plan, {}).stamp).toBe(0);
    expect(entrancePlan("set_service", false)).toEqual([]);
  });
  it("the duration shrinks with speed", () => {
    expect(entrancePlan("set_service", true, 2)[0].dur).toBe(STAMP_MS / 2);
  });
});

describe("stamp pop", () => {
  it("grows to ~118 % and settles at 100 %", () => {
    expect(stampScale(0)).toBe(0);
    expect(stampScale(0.7)).toBeCloseTo(1.18);
    expect(stampScale(1)).toBeCloseTo(1);
  });
  it("same corner for boxes; the diamond sits on its top-left side", () => {
    expect(stampCenter("step", 200, 80)).toEqual(stampCenter("component:actor", 90, 120));
    expect(stampCenter("decision", 200, 120)).toEqual({ x: 200 / 2 - 34 + 4, y: 120 / 4 - 6 + 4 });
  });
});

describe("inlined SVG", () => {
  const ids = (s: string) => [...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

  it("inlines the official SVG, with no <image> or <title>", () => {
    const m = stampMarkup("aws:lambda", { x: 4, y: 4 }, "stamp1-")!;
    expect(m).toContain("<path");
    expect(m).not.toContain("<image");
    expect(m).not.toContain("<title");
    expect(m).toContain('data-rot="-7"');
    expect(m).toContain("scale(0.375)");
  });
  it("two elements of the same service do not repeat ids", () => {
    const both = stampMarkup("aws:lambda", { x: 4, y: 4 }, "stamp1-")! + stampMarkup("aws:lambda", { x: 4, y: 4 }, "stamp2-")!;
    const all = ids(both);
    expect(all.length).toBeGreaterThan(2);
    expect(new Set(all).size).toBe(all.length);
  });
  it("unknown service: null", () => {
    expect(stampMarkup("aws:made-up", { x: 0, y: 0 }, "p-")).toBeNull();
  });
  it("also prefixes the references to ids", () => {
    const out = prefixedIconBody(
      `<svg viewBox="0 0 80 80"><title>t</title><defs><clipPath id="a/b"><rect/></clipPath></defs><g clip-path="url(#a/b)"><use xlink:href="#a/b"/></g></svg>`,
      "p-",
    );
    expect(out).toContain('id="p-a/b"');
    expect(out).toContain("url(#p-a/b)");
    expect(out).toContain('xlink:href="#p-a/b"');
  });
  it("every service has markup and no id is left unprefixed", () => {
    for (const s of AWS_SERVICES) {
      const m = stampMarkup(`aws:${s.id}`, { x: 0, y: 0 }, "z-")!;
      expect(m, s.id).toBeTruthy();
      for (const id of ids(m)) if (!id.startsWith("z-")) throw new Error(`${s.id}: ${id}`);
    }
  });
});
