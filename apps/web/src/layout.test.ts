import { describe, expect, it } from "vitest";
import { applyOps, emptyBoard } from "@grafito/board";
import { op } from "@grafito/contract";
import { bezierAt, clearLayoutCache, computeLayout, labelLines, labelRect, overlaps } from "@grafito/board";
import type { ConnectionGeom, Pt } from "@grafito/board";
import type { Rect } from "@grafito/board";
import { SCRIPTS } from "./scripts";
import { buildTree } from "@grafito/board";
import { diffTrees } from "@grafito/board";

const finalBoard = (ops: Parameters<typeof applyOps>[1]) => applyOps(emptyBoard(), ops).board;

describe.each(SCRIPTS)("layout del guion $id", ({ script }) => {
  const board = finalBoard(script.flatMap((c) => c.ops));

  it("las zonas no se solapan", async () => {
    const lay = await computeLayout(board);
    const zs = Object.entries(lay.zones);
    expect(zs.length).toBe(board.zones.length);
    for (let i = 0; i < zs.length; i++)
      for (let j = i + 1; j < zs.length; j++) expect(overlaps(zs[i][1], zs[j][1]), `${zs[i][0]} vs ${zs[j][0]}`).toBe(false);
  });

  it("los elementos de una zona no se solapan y quedan dentro de ella", async () => {
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

  it("todas las conexiones y notas tienen geometría", async () => {
    const lay = await computeLayout(board);
    for (const c of board.connections) expect(lay.connections[c.id], c.id).toBeDefined();
    for (const c of board.callouts) expect(lay.callouts[c.id], c.id).toBeDefined();
    const tree = buildTree(board, lay);
    expect(tree.items.length).toBeGreaterThan(board.elements.length);
  });
});

describe("estabilidad", () => {
  it("añadir un paso al final de un flujo apenas mueve los existentes", async () => {
    const chunks = SCRIPTS[1].script;
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

  it("la barra, el nivel y las marcas salen en el árbol de render, y emphasize/callout apuntan a una marca", async () => {
    const board = withMarks([20, 90], [
      op.emphasize({ target: "m0", style: "circle" }),
      op.add_callout({ id: "n", target: "m1", text: "ojo" }),
    ]);
    const lay = await computeLayout(board);
    expect(lay.callouts.n).toBeDefined();
    const tree = buildTree(board, lay);
    for (const k of ["bar:e", "level:e", "m0", "m1", "stem:m0", "stem:m1", "emphasis:m0", "n"]) expect(tree.map.has(k), k).toBe(true);
    const lvl = tree.map.get("level:e")!;
    expect(lvl.geom.w).toBeCloseTo(0.6 * lay.scales.e.w, 5);
    // sin nivel no hay relleno
    const noLevel = buildTree(finalBoard([op.create_zone({ id: "e", kind: "scale", title: "T" })]), await computeLayout(finalBoard([op.create_zone({ id: "e", kind: "scale", title: "T" })])));
    expect(noLevel.map.has("bar:e")).toBe(true);
    expect(noLevel.map.has("level:e")).toBe(false);
  });

  it("cambiar el nivel mueve el relleno sin tocar el resto", async () => {
    const a = buildTree(withMarks([20]), await computeLayout(withMarks([20])));
    const b2 = withMarks([20], [op.set_level({ zone: "e", at: 80 })]);
    const b = buildTree(b2, await computeLayout(b2));
    expect(b.map.get("level:e")!.geom.w).toBeGreaterThan(a.map.get("level:e")!.geom.w);
    expect(b.map.get("m0")!.sig).toBe(a.map.get("m0")!.sig);
  });
});

describe("etiquetas de arista en flujos con textos largos", () => {
  // Sesión real (auth con BFF): las etiquetas eran más anchas que el hueco entre capas y caían sobre las cajas.
  const board = finalBoard([
  op.create_zone({"id":"auth_bff","kind":"system","title":"Autenticación con BFF"}),
  op.add_component({"zone":"auth_bff","id":"bff","label":"BFF (Backend for Frontend)","type":"service"}),
  op.add_component({"zone":"auth_bff","id":"usuario","label":"Usuario","type":"actor"}),
  op.add_component({"zone":"auth_bff","id":"sitio","label":"Sitio público","type":"client"}),
  op.connect({"id":"c_usuario_sitio","from":"usuario","to":"sitio","label":"click en login"}),
  op.add_component({"zone":"auth_bff","id":"cognito","label":"Cognito","type":"external"}),
  op.connect({"id":"c_sitio_cognito","from":"sitio","to":"cognito","label":"petición de login"}),
  op.connect({"id":"c_usuario_cognito","from":"usuario","to":"cognito","label":"ingresa credenciales"}),
  op.connect({"id":"c_cognito_sitio","from":"cognito","to":"sitio","label":"retorna con código"}),
  op.connect({"id":"c_sitio_bff","from":"sitio","to":"bff","label":"envía token para cambiarlo por cookies"}),
  ]);

  it("ninguna etiqueta pisa una caja ni otra etiqueta", async () => {
    const lay = await computeLayout(board);
    const labels = Object.entries(lay.connections).flatMap(([id, g]) => (g.label ? [[id, labelRect(g.label)] as [string, Rect]] : []));
    expect(labels.length).toBe(5);
    for (const [id, l] of labels) {
      for (const [eid, r] of Object.entries(lay.elements)) expect(overlaps(l, r), `${id} sobre ${eid}`).toBe(false);
      for (const [oid, o] of labels) if (oid !== id) expect(overlaps(l, o), `${id} sobre ${oid}`).toBe(false);
    }
  });
});

describe("labelLines", () => {
  it("deja las etiquetas cortas en una línea", () => {
    expect(labelLines("click en login")).toEqual(["click en login"]);
  });
  it("parte las largas en dos líneas parejas", () => {
    expect(labelLines("envía token para cambiarlo por cookies")).toEqual(["envía token para", "cambiarlo por cookies"]);
  });
  it("no parte una sola palabra larga", () => {
    expect(labelLines("autenticaciónfederadaconcognito")).toEqual(["autenticaciónfederadaconcognito"]);
  });
});

describe("service no cambia la firma de render", () => {
  it("set_service sobre un elemento ya dibujado no genera update (ni mueve la caja) y deja service en data", async () => {
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
