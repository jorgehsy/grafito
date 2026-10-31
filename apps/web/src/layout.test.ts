import { describe, expect, it } from "vitest";
import { applyOps, emptyBoard } from "@grafito/board";
import { op } from "@grafito/contract";
import { bezierAt, clearLayoutCache, computeLayout, labelLines, labelRect, overlaps } from "@grafito/board";
import type { ConnectionGeom, Pt } from "@grafito/board";
import type { Rect } from "@grafito/board";
import { DEMOS } from "./demos";
import { buildTree } from "@grafito/board";
import { diffTrees } from "@grafito/board";

const finalBoard = (ops: Parameters<typeof applyOps>[1]) => applyOps(emptyBoard(), ops).board;

describe.each(DEMOS)("layout of demo $id", ({ demo }) => {
  const board = finalBoard(demo.flatMap((c) => c.ops));

  it("zones do not overlap", async () => {
    const lay = await computeLayout(board);
    const zs = Object.entries(lay.zones);
    expect(zs.length).toBe(board.zones.length);
    for (let i = 0; i < zs.length; i++)
      for (let j = i + 1; j < zs.length; j++) expect(overlaps(zs[i][1], zs[j][1]), `${zs[i][0]} vs ${zs[j][0]}`).toBe(false);
  });

  it("elements of a zone do not overlap and stay inside it", async () => {
    const lay = await computeLayout(board);
    for (const z of board.zones) {
      const zr = lay.zones[z.id];
      const elements = board.elements.filter((e) => e.zone === z.id).map((e) => [e.id, lay.elements[e.id]] as [string, Rect]);
      for (const [id, r] of elements) {
        expect(r.x, id).toBeGreaterThanOrEqual(zr.x);
        expect(r.y, id).toBeGreaterThanOrEqual(zr.y);
        expect(r.x + r.w, id).toBeLessThanOrEqual(zr.x + zr.w);
        expect(r.y + r.h, id).toBeLessThanOrEqual(zr.y + zr.h);
      }
      for (let i = 0; i < elements.length; i++)
        for (let j = i + 1; j < elements.length; j++) expect(overlaps(elements[i][1], elements[j][1]), `${elements[i][0]} vs ${elements[j][0]}`).toBe(false);
    }
  });

  it("es determinista", async () => {
    clearLayoutCache();
    const a = await computeLayout(board);
    clearLayoutCache();
    const b = await computeLayout(board);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("las conexiones entre zonas no cruzan otros elementos y las etiquetas no pisan cajas", async () => {
    const lay = await computeLayout(board);
    const zoneOf = new Map(board.elements.map((e) => [e.id, e.zone]));
    const sample = (g: ConnectionGeom): Pt[] => {
      if (g.kind === "curve") return Array.from({ length: 41 }, (_, i) => bezierAt(g.pts, i / 40));
      const out: Pt[] = [];
      for (let i = 1; i < g.pts.length; i++)
        for (let k = 0; k <= 20; k++) out.push({ x: g.pts[i - 1].x + ((g.pts[i].x - g.pts[i - 1].x) * k) / 20, y: g.pts[i - 1].y + ((g.pts[i].y - g.pts[i - 1].y) * k) / 20 });
      return out;
    };
    let cross = 0;
    for (const c of board.connections) {
      if (zoneOf.get(c.from) === zoneOf.get(c.to)) continue;
      cross++;
      const g = lay.connections[c.id];
      expect(g.cross, c.id).toBe(true);
      for (const e of board.elements) {
        if (e.id === c.from || e.id === c.to) continue;
        const r = lay.elements[e.id];
        const bad = sample(g).find((p) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h);
        expect(bad, `${c.id} cruza ${e.id}`).toBeUndefined();
      }
    }
    expect(cross).toBeGreaterThanOrEqual(0);
    for (const c of [...board.connections]) {
      const g = lay.connections[c.id];
      if (!g?.label) continue;
      const lr = labelRect(g.label);
      for (const e of board.elements) expect(overlaps(lr, lay.elements[e.id]), `etiqueta ${c.id} sobre ${e.id}`).toBe(false);
    }
    for (const c of board.connections) for (const d of board.connections) {
      if (c.id >= d.id || !lay.connections[c.id]?.label || !lay.connections[d.id]?.label) continue;
      expect(overlaps(labelRect(lay.connections[c.id].label!), labelRect(lay.connections[d.id].label!)), `${c.id}/${d.id}`).toBe(false);
    }
  });

  it("all connections and callouts have geometry", async () => {
    const lay = await computeLayout(board);
    for (const c of board.connections) expect(lay.connections[c.id], c.id).toBeDefined();
    for (const c of board.callouts) expect(lay.callouts[c.id], c.id).toBeDefined();
    const tree = buildTree(board, lay);
    expect(tree.items.length).toBeGreaterThan(board.elements.length);
  });
});

describe("stability", () => {
  it("adding a step at the end of a flow barely moves the existing ones", async () => {
    const chunks = DEMOS[1].demo;
    const ops = chunks.slice(0, 2).flatMap((c) => c.ops);
    const b0 = finalBoard(ops);
    const before = await computeLayout(b0);
    const after = await computeLayout(finalBoard([...ops, ...chunks[2].ops]));
    for (const e of b0.elements) {
      expect(Math.abs(before.elements[e.id].x - after.elements[e.id].x), e.id).toBeLessThan(30);
      expect(Math.abs(before.elements[e.id].y - after.elements[e.id].y), e.id).toBeLessThan(30);
    }
    // el orden de las zonas se conserva
    expect(Object.keys(after.zones)).toEqual(Object.keys(before.zones));
  });
});

describe("scale", () => {
  const withMarks = (ats: number[], extra: Parameters<typeof applyOps>[1] = []) =>
    finalBoard([
      op.create_zone({ id: "e", kind: "scale", title: "Ventana de contexto (1 M tokens)" }),
      op.set_level({ zone: "e", at: 60, label: "se va llenando" }),
      ...ats.map((at, i) => op.add_mark({ zone: "e", id: `m${i}`, at, label: `${at}%: empeoran`, note: "respuestas malas o alucinaciones", tone: i % 2 ? "danger" : "warn" })),
      ...extra,
    ]);

  it("las marcas cercanas (18, 20, 22, 90) no se solapan y caben en la zona", async () => {
    const board = withMarks([18, 20, 22, 90]);
    const lay = await computeLayout(board);
    const zr = lay.zones.e;
    const marks = board.elements.filter((e) => e.type === "mark");
    expect(marks).toHaveLength(4);
    for (const m of marks) {
      const r = lay.elements[m.id];
      expect(r.x, m.id).toBeGreaterThanOrEqual(zr.x);
      expect(r.y, m.id).toBeGreaterThanOrEqual(zr.y);
      expect(r.x + r.w, m.id).toBeLessThanOrEqual(zr.x + zr.w);
      expect(r.y + r.h, m.id).toBeLessThanOrEqual(zr.y + zr.h);
    }
    for (let i = 0; i < marks.length; i++)
      for (let j = i + 1; j < marks.length; j++)
        expect(overlaps(lay.elements[marks[i].id], lay.elements[marks[j].id]), `${marks[i].id} vs ${marks[j].id}`).toBe(false);
    // ni cubren la barra
    const bar = lay.scales.e.bar;
    for (const m of marks) expect(overlaps(lay.elements[m.id], bar), m.id).toBe(false);
  });

  it("los tallos no cruzan las cajas de otras marcas", async () => {
    const board = withMarks([18, 19, 20, 21, 22, 24, 26, 90]);
    const lay = await computeLayout(board);
    const marks = board.elements.filter((e) => e.type === "mark");
    for (const m of marks) {
      const [, near, hook] = lay.marks[m.id].stem;
      for (const o of marks) {
        if (o.id === m.id) continue;
        const q = lay.elements[o.id];
        for (let k = 0; k <= 20; k++) {
          const x = near.x + ((hook.x - near.x) * k) / 20, y = near.y + ((hook.y - near.y) * k) / 20;
          expect(x > q.x && x < q.x + q.w && y > q.y && y < q.y + q.h, `tallo de ${m.id} cruza ${o.id}`).toBe(false);
        }
      }
    }
  });

  it("marcas muy cercanas se reparten entre arriba y abajo", async () => {
    const lay = await computeLayout(withMarks([18, 20, 22, 90]));
    const sides = new Set(["m0", "m1", "m2"].map((id) => lay.marks[id].side));
    expect(sides.size).toBe(2);
  });

  it("marcas en 0 y 100 caben dentro de la zona", async () => {
    const board = withMarks([0, 100]);
    const lay = await computeLayout(board);
    const zr = lay.zones.e;
    for (const id of ["m0", "m1"]) {
      const r = lay.elements[id];
      expect(r.x).toBeGreaterThanOrEqual(zr.x);
      expect(r.x + r.w).toBeLessThanOrEqual(zr.x + zr.w);
    }
  });

  it("the bar, level and marks appear in the render tree, and emphasize/callout point at a mark", async () => {
    const board = withMarks([20, 90], [
      op.emphasize({ target: "m0", style: "circle" }),
      op.add_callout({ id: "n", target: "m1", text: "look" }),
    ]);
    const lay = await computeLayout(board);
    expect(lay.callouts.n).toBeDefined();
    const tree = buildTree(board, lay);
    for (const k of ["bar:e", "level:e", "m0", "m1", "stem:m0", "stem:m1", "emphasis:m0", "n"]) expect(tree.map.has(k), k).toBe(true);
    const lvl = tree.map.get("level:e")!;
    expect(lvl.geom.w).toBeCloseTo(0.6 * lay.scales.e.w, 5);
    // without a level there is no fill
    const noLevel = buildTree(finalBoard([op.create_zone({ id: "e", kind: "scale", title: "T" })]), await computeLayout(finalBoard([op.create_zone({ id: "e", kind: "scale", title: "T" })])));
    expect(noLevel.map.has("bar:e")).toBe(true);
    expect(noLevel.map.has("level:e")).toBe(false);
  });

  it("changing the level moves the fill without touching the rest", async () => {
    const a = buildTree(withMarks([20]), await computeLayout(withMarks([20])));
    const b2 = withMarks([20], [op.set_level({ zone: "e", at: 80 })]);
    const b = buildTree(b2, await computeLayout(b2));
    expect(b.map.get("level:e")!.geom.w).toBeGreaterThan(a.map.get("level:e")!.geom.w);
    expect(b.map.get("m0")!.sig).toBe(a.map.get("m0")!.sig);
  });
});

describe("connection labels in flows with long texts", () => {
  // Real session (auth with a BFF): the labels were wider than the gap between layers and fell on top of the boxes.
  const board = finalBoard([
  op.create_zone({"id":"auth_bff","kind":"system","title":"BFF authentication"}),
  op.add_component({"zone":"auth_bff","id":"bff","label":"BFF (Backend for Frontend)","type":"service"}),
  op.add_component({"zone":"auth_bff","id":"user","label":"User","type":"actor"}),
  op.add_component({"zone":"auth_bff","id":"site","label":"Public site","type":"client"}),
  op.connect({"id":"c_user_site","from":"user","to":"site","label":"click on login"}),
  op.add_component({"zone":"auth_bff","id":"cognito","label":"Cognito","type":"external"}),
  op.connect({"id":"c_site_cognito","from":"site","to":"cognito","label":"login request"}),
  op.connect({"id":"c_user_cognito","from":"user","to":"cognito","label":"enters credentials"}),
  op.connect({"id":"c_cognito_site","from":"cognito","to":"site","label":"returns with code"}),
  op.connect({"id":"c_site_bff","from":"site","to":"bff","label":"sends token to swap it for cookies"}),
  ]);

  it("no label covers a box or another label", async () => {
    const lay = await computeLayout(board);
    const labels = Object.entries(lay.connections).flatMap(([id, g]) => (g.label ? [[id, labelRect(g.label)] as [string, Rect]] : []));
    expect(labels.length).toBe(5);
    for (const [id, l] of labels) {
      for (const [eid, r] of Object.entries(lay.elements)) expect(overlaps(l, r), `${id} over ${eid}`).toBe(false);
      for (const [oid, o] of labels) if (oid !== id) expect(overlaps(l, o), `${id} over ${oid}`).toBe(false);
    }
  });
});

describe("labelLines", () => {
  it("keeps short labels on one line", () => {
    expect(labelLines("click on login")).toEqual(["click on login"]);
  });
  it("splits long ones into two even lines", () => {
    expect(labelLines("sends token to swap it for cookies")).toEqual(["sends token to swap", "it for cookies"]);
  });
  it("does not split a single long word", () => {
    expect(labelLines("federatedauthenticationwithcognito")).toEqual(["federatedauthenticationwithcognito"]);
  });
});

describe("service does not change the render signature", () => {
  it("set_service on an already drawn element generates no update (nor moves the box) and leaves service in data", async () => {
    const before = finalBoard([
      op.create_zone({ id: "s", kind: "system", title: "S" }),
      op.add_component({ zone: "s", id: "fn", label: "Fn", type: "service", icon: "⚡" }),
    ]);
    const after = applyOps(before, [op.set_service({ id: "fn", service: "lambda" })]).board;
    const t0 = buildTree(before, await computeLayout(before));
    const t1 = buildTree(after, await computeLayout(after));
    expect(t1.map.get("fn")!.sig).toBe(t0.map.get("fn")!.sig);
    expect(t1.map.get("fn")!.geom).toEqual(t0.map.get("fn")!.geom);
    expect(t1.map.get("fn")!.data.lines![0]).toContain("⚡");
    expect(t1.map.get("fn")!.data.service).toBe("aws:lambda");
    expect(diffTrees(t0, t1)).toEqual({ sequential: [], moves: [] });
  });
});
