import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyOps, architectZoneOp, emptyBoard } from "@grafito/board";
import { op } from "@grafito/contract";
import type { Op } from "@grafito/contract";
import { parseScenario, resolveClick, stepText } from "./scenario";

describe("parseScenario", () => {
  it("reads a bare list of steps with the defaults: English, AWS icons, the file name", () => {
    const r = parseScenario([{ say: "a web app", expect: ["pencil"] }, { accept: "all" }, { reject: "newest" }, { choose: 2 }], "web-app");
    expect(r).toEqual({
      ok: true,
      scenario: {
        name: "web-app", lang: "en-US", catalogs: ["aws"],
        steps: [{ say: "a web app", expect: ["pencil"] }, { accept: "all" }, { reject: "newest" }, { choose: 2 }],
      },
    });
  });

  it("reads the object form with a name, language and catalogs", () => {
    const r = parseScenario({ name: "1-es", lang: "es-CL", catalogs: [], steps: [{ say: "una app web" }] }, "file");
    expect(r).toEqual({ ok: true, scenario: { name: "1-es", lang: "es-CL", catalogs: [], steps: [{ say: "una app web" }] } });
  });

  it.each([
    [[], "no steps"],
    [{ steps: [] }, "no steps"],
    ["hello", "expected object, received string"],
    [{ lang: "fr-FR", steps: [{ say: "x" }] }, "lang: unknown language tag"],
    [{ catalogs: ["gcp"], steps: [{ say: "x" }] }, "catalogs.0: unknown catalog"],
    [{ steps: [{ say: "x" }], extra: 1 }, 'Unrecognized key: "extra"'],
    [[{ accept: "all" }], "step 1: the first step must be a say"],
    [[{ say: "x" }, { click: "all" }], 'step 2: expected {"say": "..."}'],
    [[{ say: "  " }], "step 1 (say): say: must not be blank"],
    [[{ say: "x", expect: ["inked"] }], "step 1 (say): expect.0: Invalid option"],
    [[{ say: "x", expect: ["ink", "pencil"] }], "step 1 (say): expect: ink and pencil exclude each other"],
    [[{ say: "x", expect: ["bubbleOnly", "ink"] }], "step 1 (say): expect: bubbleOnly excludes ink and pencil"],
    [[{ say: "x" }, { accept: "first" }], "step 2 (accept): accept: Invalid option"],
    [[{ say: "x" }, { choose: 3 }], "step 2 (choose): choose: Invalid input"],
    [[{ say: "x" }, { choose: 1, accept: "all" }], 'step 2 (accept): Unrecognized key: "choose"'],
    [[{ say: "x", asked: ["sqs"] }], "step 1 (say): asked: asked needs expect ink"],
    [[{ say: "x", expect: ["ink"], asked: ["sqs", "azure-blob"] }], "step 1 (say): asked: not a service of aws: azure-blob"],
    [{ catalogs: [], steps: [{ say: "x", expect: ["ink"], asked: ["sqs"] }] }, "asked: not a service of no catalog: sqs"],
    [{ start: { say: "x", ops: [{ name: "draw_cat", input: {} }] }, steps: [{ say: "y" }] }, "start.ops.0:"],
    [{ start: { say: "x", ops: [{ name: "connect", input: { id: "c1", from: "a", to: "b" } }] }, steps: [{ say: "y" }] }, "start:"],
    [{ start: { say: "x", ops: [] }, steps: [{ say: "y" }] }, "start.ops"],
  ])("rejects %j with a clear error", (x, error) => {
    const r = parseScenario(x, "f");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(error);
  });

  it("reads a scripted start, after which a click may come first", () => {
    const ops = [{ name: "propose", input: { id: "P1", label: "Core" } }, { name: "say", input: { text: "Core?" } }];
    const r = parseScenario({ start: { say: "a web app", ops }, steps: [{ accept: "all" }, { say: "and a queue", expect: ["ink"], asked: ["sqs"] }] }, "f");
    expect(r).toMatchObject({
      ok: true,
      scenario: { start: { say: "a web app", ops: [{ name: "propose", input: { id: "P1", label: "Core" } }, { name: "say", input: { text: "Core?" } }] }, steps: [{ accept: "all" }, { asked: ["sqs"] }] },
    });
  });

  it("parses every committed scenario", () => {
    const dir = fileURLToPath(new URL("./scenarios/", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    expect(files).toHaveLength(7);
    for (const f of files) {
      const r = parseScenario(JSON.parse(readFileSync(dir + f, "utf8")), f.replace(/\.json$/, ""));
      expect(r, f).toMatchObject({ ok: true });
    }
  });
});

describe("stepText", () => {
  it("names the step as the table shows it", () => {
    expect([{ say: "hi" }, { accept: "all" }, { reject: "newest" }, { choose: 1 }, { choose: 2 }].map((s) => stepText(s as never))).toEqual([
      "hi", "accept all", "reject newest", "choose A", "choose B",
    ]);
  });
});

describe("resolveClick", () => {
  const propose = (id: string, alternative_to?: string): Op => op.propose({ id, label: id, ...(alternative_to ? { alternative_to } : {}) });
  const board = (ops: Op[]) => applyOps(emptyBoard(), [architectZoneOp("Architecture"), ...ops]).board;
  const withPair = board([propose("P1"), propose("P2"), propose("P3", "P2"), propose("P4")]);

  it("accept all keeps every proposal that has no alternative", () => {
    expect(resolveClick(withPair, { accept: "all" })).toEqual({ ok: true, actions: [{ type: "accept", proposal: "P1" }, { type: "accept", proposal: "P4" }] });
  });

  it("reject all turns down every open proposal", () => {
    expect(resolveClick(withPair, { reject: "all" })).toEqual({ ok: true, actions: ["P1", "P2", "P3", "P4"].map((proposal) => ({ type: "reject", proposal })) });
  });

  it("newest is the last proposal opened", () => {
    expect(resolveClick(withPair, { reject: "newest" })).toEqual({ ok: true, actions: [{ type: "reject", proposal: "P4" }] });
    expect(resolveClick(withPair, { accept: "newest" })).toEqual({ ok: true, actions: [{ type: "accept", proposal: "P4" }] });
  });

  it("choose N accepts alternative A or B of the newest pair", () => {
    expect(resolveClick(withPair, { choose: 1 })).toEqual({ ok: true, actions: [{ type: "accept", proposal: "P2" }] });
    expect(resolveClick(withPair, { choose: 2 })).toEqual({ ok: true, actions: [{ type: "accept", proposal: "P3" }] });
  });

  it("says why a click cannot be made", () => {
    expect(resolveClick(board([]), { accept: "all" })).toEqual({ ok: false, error: "no open proposal" });
    expect(resolveClick(board([propose("P1")]), { choose: 1 })).toEqual({ ok: false, error: "no two alternatives are open" });
    expect(resolveClick(board([propose("P1"), propose("P2", "P1")]), { accept: "all" })).toEqual({ ok: false, error: "only alternatives are open: use choose" });
  });
});
