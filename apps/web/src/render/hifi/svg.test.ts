import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { applyOps, buildTree, computeLayout, emptyBoard } from "@grafito/board";
import type { Board, RenderTree } from "@grafito/board";
import type { Op } from "@grafito/contract";
import { ZONE_KINDS } from "@grafito/contract";
import { DEMOS } from "../../demos";
import { catalogIcon, hifiFromBoard, renderHifi, titleFrom } from "./index";
import { fitSize, textWidth, wrapToWidth } from "./text";
import { ARCHITECT, FIXTURES } from "./fixtures";

/** HIFI_OUT=<dir> writes every SVG made here to that folder, to look at them. */
const OUT = process.env.HIFI_OUT;
const dump = (name: string, svg: string) => {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}.svg`, svg);
};

async function boardOf(ops: Op[]): Promise<{ board: Board; tree: RenderTree; warnings: string[] }> {
  const r = applyOps(emptyBoard(), ops);
  const layout = await computeLayout(r.board);
  return { board: r.board, tree: buildTree(r.board, layout), warnings: r.warnings };
}

/** Well-formed XML: every tag closes in order, attributes are quoted, no stray `<` or `&` in text. Returns the text nodes. */
function parseXml(xml: string): { texts: string[]; tags: string[] } {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, "");
  const stack: string[] = [], texts: string[] = [], tags: string[] = [];
  const re = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g;
  let last = 0, m: RegExpExecArray | null;
  const textBetween = (s: string) => {
    if (/[<>]/.test(s)) throw new Error(`stray markup in text: ${s.slice(0, 60)}`);
    if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(s)) throw new Error(`bare & in text: ${s.slice(0, 60)}`);
    if (s.trim()) texts.push(s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"'));
  };
  while ((m = re.exec(body))) {
    textBetween(body.slice(last, m.index));
    last = re.lastIndex;
    const [, close, tag, , selfClose] = m;
    if (close) {
      const open = stack.pop();
      if (open !== tag) throw new Error(`</${tag}> closes <${open}>`);
    } else {
      tags.push(tag);
      if (!selfClose) stack.push(tag);
    }
  }
  textBetween(body.slice(last));
  if (stack.length) throw new Error(`unclosed: ${stack.join(", ")}`);
  if (tags[0] !== "svg") throw new Error("root is not <svg>");
  return { texts, tags };
}

/** Every label of the board that must be readable in the export. */
function labelsOf(board: Board): string[] {
  return [
    ...board.zones.flatMap((z) => [z.title, z.centerLabel ?? ""]),
    ...board.elements.flatMap((e) => [e.label, e.note ?? "", e.when ?? "", ...(e.fields ?? []).flatMap((f) => [f.name, f.type ?? ""])]),
    ...board.groups.map((g) => g.label),
    ...board.connections.map((c) => c.label ?? ""),
    ...board.callouts.map((c) => c.text),
    ...board.questions.map((q) => q.text ?? ""),
  ].filter(Boolean);
}
const squash = (s: string) => s.replace(/\s+/g, "");

function check(svg: string, board: Board) {
  const { texts } = parseXml(svg);
  expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  // wrapped labels are split over several <text> nodes: compare without spaces
  const all = squash(texts.join(""));
  for (const l of labelsOf(board)) expect(all, `label "${l}"`).toContain(squash(l));
  // nothing of the sketchy look: no handwriting font, no outside resources
  expect(svg).not.toMatch(/Patrick Hand|Kalam|cursive/);
  expect(svg).not.toMatch(/<image|href="http|url\(http|@import|<script/);
  return texts;
}

describe("hi-fi export: every zone kind", () => {
  it("there is a fixture for each kind the contract knows", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...ZONE_KINDS].sort());
  });

  it.each(Object.entries(FIXTURES))("%s: well-formed, labelled, no NaN", async (kind, ops) => {
    const { board, tree, warnings } = await boardOf(ops);
    expect(warnings).toEqual([]);
    const r = hifiFromBoard(board, await computeLayout(board), { date: "11 November 2026" });
    dump(kind, r.svg);
    check(r.svg, board);
    expect(r.width).toBeGreaterThan(300);
    expect(r.height).toBeGreaterThan(150);
    expect(r.svg).toContain(`width="${r.width}" height="${r.height}"`);
    // one drawn thing per element of the tree
    expect(tree.items.length).toBeGreaterThan(1);
    const dark = renderHifi(tree, { theme: "dark" });
    dump(`${kind}.dark`, dark.svg);
    check(dark.svg, board);
    expect(dark.svg).toContain("#0B1220");
  });

  it.each(DEMOS.map((d) => [d.id, d.demo] as const))("demo %s exports", async (id, demo) => {
    const { board } = await boardOf(demo.flatMap((c) => c.ops));
    const r = hifiFromBoard(board, await computeLayout(board), { date: "11 November 2026" });
    dump(`demo-${id}`, r.svg);
    check(r.svg, board);
  });
});

describe("hi-fi export: architect mode", () => {
  it("icons are inlined in colour, with ids that never repeat", async () => {
    const { board, tree } = await boardOf(ARCHITECT);
    const r = renderHifi(tree, { icon: catalogIcon, ...titleFrom(board.summary, board.zones.map((z) => z.title)), date: "11 November 2026" });
    dump("architect", r.svg);
    check(r.svg, board);
    for (const s of ["cloudfront", "s3", "api-gateway", "lambda", "dynamodb", "sqs"]) expect(r.svg).toContain(`data-icon="aws:${s}"`);
    const ids = [...r.svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.svg).toMatch(/fill="#ED7100"/); // Lambda's orange
  });

  it("an open proposal is dashed, with a legend; `exclude` leaves it out", async () => {
    const { tree } = await boardOf(ARCHITECT);
    const shown = renderHifi(tree, { icon: catalogIcon });
    expect(shown.svg).toContain("Order events");
    expect(shown.svg).toContain("Proposed, not yet accepted");
    expect(shown.svg).toContain('stroke-dasharray="5 4"');
    const without = renderHifi(tree, { icon: catalogIcon, proposals: "exclude" });
    dump("architect.accepted-only", without.svg);
    parseXml(without.svg);
    expect(without.svg).not.toContain("Order events");
    expect(without.svg).not.toContain("publish");
    expect(without.svg).not.toContain("Proposed");
    expect(without.svg).toContain("Orders table");
  });

  it("no legend when there is nothing to explain", async () => {
    const { tree } = await boardOf(FIXTURES.flow);
    expect(renderHifi(tree).svg).not.toContain("Proposed");
    const data = renderHifi((await boardOf(FIXTURES.data)).tree);
    expect(data.svg).toContain("primary key");
    expect(data.svg).toContain("many");
  });

  it("legend and mark take the caller's words", async () => {
    const { tree } = await boardOf(ARCHITECT);
    const r = renderHifi(tree, { labels: { proposed: "Propuesto", madeWith: "Hecho con grafito" } });
    expect(r.svg).toContain("Propuesto");
    expect(r.svg).toContain("Hecho con grafito");
  });
});

describe("hi-fi export: robustness", () => {
  it("an empty board still gives a valid file", () => {
    const r = renderHifi({ items: [], map: new Map() }, { title: "Empty" });
    parseXml(r.svg);
    expect(r.svg).not.toMatch(/NaN|Infinity/);
  });

  it("an item kind or variant it does not know falls back to a plain box, bad numbers never reach the file", () => {
    const items: RenderTree["items"] = [
      { key: "x", kind: "widget" as never, sig: "", hue: 0, geom: { x: 0, y: 0, w: 120, h: 50 }, data: { lines: ["New thing"] } },
      { key: "y", kind: "element", sig: "", hue: 0, geom: { x: 200, y: 0, w: 120, h: 50 }, data: { variant: "hologram", lines: ["Other <thing> & co"] } },
      { key: "z", kind: "connection", sig: "", hue: -1, geom: { x: 0, y: 0, w: 0, h: 0, pts: [{ x: NaN, y: 0 }, { x: 10, y: 10 }] }, data: {} },
      { key: "w", kind: "element", sig: "", hue: 0, geom: { x: NaN, y: 0, w: 100, h: 40 }, data: { variant: "step", lines: ["Broken"] } },
    ];
    const r = renderHifi({ items, map: new Map(items.map((i) => [i.key, i])) });
    const { texts } = parseXml(r.svg);
    expect(texts).toContain("New thing");
    expect(texts).toContain("Other <thing> & co");
    expect(r.svg).not.toMatch(/NaN|Infinity/);
  });

  it("a small board has a stable output", async () => {
    const { board } = await boardOf([
      FIXTURES.flow[0],
      { name: "add_step", input: { zone: "z", id: "a", label: "Receive order" } } as unknown as Op,
      { name: "add_step", input: { zone: "z", id: "b", label: "Ship it" } } as unknown as Op,
    ]);
    const r = hifiFromBoard(board, await computeLayout(board), { title: "Order process", subtitle: "From the cart to the delivery.", date: "11 November 2026" });
    expect(r.svg).toMatchSnapshot();
  });
});

describe("hi-fi text", () => {
  it("a label too wide for its box is shrunk until it fits", () => {
    const size = fitSize(["A rather long label for a small box"], 180, 14.5, 500);
    expect(size).toBeLessThan(14.5);
    expect(textWidth("A rather long label for a small box", size, 500)).toBeLessThanOrEqual(180.5);
    expect(fitSize(["ok"], 120, 14.5)).toBe(14.5);
  });
  it("the width estimate is on the wide side of a system sans", () => {
    // Arial at 100 px: "Hello world" is about 490 wide, "MMMM" about 333
    expect(textWidth("Hello world", 100)).toBeGreaterThan(490);
    expect(textWidth("MMMM", 100)).toBeGreaterThan(333);
  });
  it("wraps by width and cuts with an ellipsis", () => {
    const lines = wrapToWidth("one two three four five six seven eight nine ten eleven twelve", 120, 12, 400, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    for (const l of lines) expect(textWidth(l, 12)).toBeLessThanOrEqual(121);
  });
  it("the title block comes from the summary", () => {
    expect(titleFrom("Order app architecture: web, API and a queue.", ["A", "B"])).toEqual({ title: "Order app architecture", subtitle: "Web, API and a queue." });
    expect(titleFrom("", ["Only zone"])).toEqual({ title: "Only zone", subtitle: undefined });
    expect(titleFrom("", [])).toEqual({});
    expect(titleFrom("Clear order flow; pending: real stock, returns and tracking, and whether to ship ourselves.", ["A", "B"]).title).toBeUndefined();
    expect(titleFrom("Two zones, one idea", ["A", "B"])).toEqual({ title: "Two zones, one idea" });
  });
});
