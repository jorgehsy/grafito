import { describe, expect, it } from "vitest";
import { applyOp, applyOps, emptyBoard } from "./model";
import { op } from "./ops";
import type { Op } from "./ops";
import { computeLayout, overlaps } from "./layout";
import type { Rect } from "./layout";
import { buildTree } from "./tree";
import { serializeBoard } from "./live/serialize";
import { validateOp } from "../../server/board";

const finalBoard = (ops: Op[]) => applyOps(emptyBoard(), ops).board;
const inside = (r: Rect, z: Rect) => r.x >= z.x && r.y >= z.y && r.x + r.w <= z.x + z.w && r.y + r.h <= z.y + z.h;
const noOverlap = (rs: [string, Rect][]) => {
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) expect(overlaps(rs[i][1], rs[j][1]), `${rs[i][0]} vs ${rs[j][0]}`).toBe(false);
};

describe("validación con esquema", () => {
  it("add_stage, add_event, add_span y center_label", () => {
    expect(validateOp("create_zone", { id: "c", kind: "cycle", title: "t", center_label: "Ventana" })).toBeNull();
    expect(validateOp("create_zone", { id: "c", kind: "timeline", title: "t" })).toBeNull();
    expect(validateOp("add_stage", { zone: "c", id: "s", label: "x", note: "n", after: "a" })).toBeNull();
    expect(validateOp("add_stage", { zone: "c", id: "s" })).not.toBeNull();
    expect(validateOp("add_event", { zone: "t", id: "e", label: "x", when: "Antes", note: "n", at: 0 })).toBeNull();
    expect(validateOp("add_event", { zone: "t", id: "e", label: "x", at: 100 })).toBeNull();
    expect(validateOp("add_event", { zone: "t", id: "e", label: "x", at: 101 })).not.toBeNull();
    expect(validateOp("add_event", { zone: "t", id: "e", label: "x", at: "5" })).not.toBeNull();
    expect(validateOp("add_event", { zone: "t", id: "e", label: "x", extra: 1 })).not.toBeNull();
    expect(validateOp("add_span", { zone: "t", id: "p", from: 0, to: 50, label: "x", tone: "warn" })).toBeNull();
    expect(validateOp("add_span", { zone: "t", id: "p", from: 0, to: 150, label: "x" })).not.toBeNull();
    expect(validateOp("add_span", { zone: "t", id: "p", from: -1, to: 50, label: "x" })).not.toBeNull();
    expect(validateOp("add_span", { zone: "t", id: "p", from: 0, to: 50 })).not.toBeNull();
    expect(validateOp("add_span", { zone: "t", id: "p", from: 0, to: 50, label: "x", tone: "azul" })).not.toBeNull();
  });
});

describe("modelo cycle", () => {
  const cyc = () => applyOps(emptyBoard(), [op.create_zone({ id: "c", kind: "cycle", title: "Ciclo", center_label: "Ventana" }), op.create_zone({ id: "f", kind: "flow", title: "F" })]).board;
  it("guarda center_label y las etapas", () => {
    const r = applyOps(cyc(), [op.add_stage({ zone: "c", id: "a", label: "A", note: "n" }), op.add_stage({ zone: "c", id: "b", label: "B", after: "a" })]);
    expect(r.warnings).toEqual([]);
    expect(r.board.zones[0].centerLabel).toBe("Ventana");
    expect(r.board.els.map((e) => [e.id, e.type, e.note, e.after])).toEqual([["a", "stage", "n", undefined], ["b", "stage", undefined, "a"]]);
  });
  it("add_stage inválido se ignora con aviso", () => {
    const b = applyOp(cyc(), op.add_stage({ zone: "c", id: "a", label: "A" })).board;
    for (const bad of [
      op.add_stage({ zone: "nope", id: "x", label: "x" }),
      op.add_stage({ zone: "f", id: "x", label: "x" }),
      op.add_stage({ zone: "c", id: "a", label: "dup" }),
      op.add_stage({ zone: "c", id: "x", label: " " }),
      op.add_step({ zone: "c", id: "x", label: "paso" }),
    ]) {
      const r = applyOp(b, bad);
      expect(r.board).toBe(b);
      expect(r.warnings).toHaveLength(1);
    }
    expect(applyOp(b, op.add_stage({ zone: "c", id: "x", label: "x", after: "zzz" })).warnings).toHaveLength(1);
  });
  it("las etapas no generan flechas implícitas; emphasize, connect, callout y update_label funcionan", () => {
    let b = applyOps(cyc(), [
      op.add_stage({ zone: "c", id: "a", label: "A" }), op.add_stage({ zone: "c", id: "b", label: "B", after: "a" }),
      op.add_step({ zone: "f", id: "p", label: "P" }),
    ]).board;
    const r = applyOps(b, [
      op.emphasize({ target: "a", style: "star" }), op.mark_question({ target: "b" }), op.add_callout({ id: "n", target: "a", text: "ojo" }),
      op.connect({ id: "k", from: "a", to: "p" }), op.update_label({ id: "b", label: "Nueva" }),
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.board.els.find((e) => e.id === "b")!.label).toBe("Nueva");
    b = r.board;
    expect(applyOp(b, op.delete({ id: "a" })).board.conns).toHaveLength(0);
  });
});

describe("modelo timeline", () => {
  const tl = () => applyOps(emptyBoard(), [op.create_zone({ id: "t", kind: "timeline", title: "T" }), op.create_zone({ id: "c", kind: "cycle", title: "C" })]).board;
  it("add_event y add_span crean elementos", () => {
    const r = applyOps(tl(), [
      op.add_event({ zone: "t", id: "e", label: "E", when: "Antes", note: "n", at: 10 }),
      op.add_event({ zone: "t", id: "e2", label: "E2" }),
      op.add_span({ zone: "t", id: "p", from: 0, to: 40, label: "2 meses", tone: "warn" }),
      op.add_span({ zone: "t", id: "p2", from: 50, to: 60, label: "x" }),
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.board.els.map((e) => [e.id, e.type, e.at, e.to, e.when])).toEqual([
      ["e", "event", 10, undefined, "Antes"], ["e2", "event", undefined, undefined, undefined],
      ["p", "span", 0, 40, undefined], ["p2", "span", 50, 60, undefined],
    ]);
    expect(r.board.els[3].tone).toBe("neutral");
  });
  it("entradas inválidas se ignoran con aviso", () => {
    const b = applyOps(tl(), [op.add_event({ zone: "t", id: "e", label: "E" }), op.add_span({ zone: "t", id: "p", from: 0, to: 10, label: "x" })]).board;
    for (const bad of [
      op.add_event({ zone: "c", id: "x", label: "x" }), // zona cycle
      op.add_event({ zone: "nope", id: "x", label: "x" }),
      op.add_event({ zone: "t", id: "e", label: "dup" }),
      op.add_event({ zone: "t", id: "p", label: "dup" }),
      op.add_event({ zone: "t", id: "x", label: "" }),
      op.add_event({ zone: "t", id: "x", label: "x", at: 101 }),
      op.add_event({ zone: "t", id: "x", label: "x", at: NaN }),
      op.add_event({ zone: "t", id: "x", label: "x", at: -1 }),
      op.add_span({ zone: "c", id: "x", from: 0, to: 5, label: "x" }),
      op.add_span({ zone: "t", id: "x", from: 50, to: 50, label: "x" }),
      op.add_span({ zone: "t", id: "x", from: 60, to: 50, label: "x" }),
      op.add_span({ zone: "t", id: "x", from: 0, to: 101, label: "x" }),
      op.add_span({ zone: "t", id: "x", from: Infinity, to: 101, label: "x" }),
      op.add_span({ zone: "t", id: "x", from: 0, to: 5, label: " " }),
      op.add_span({ zone: "t", id: "x", from: 0, to: 5, label: "x", tone: "azul" as any }),
      op.add_span({ zone: "t", id: "e", from: 0, to: 5, label: "dup" }),
    ]) {
      const r = applyOp(b, bad);
      expect(r.board).toBe(b);
      expect(r.warnings).toHaveLength(1);
    }
  });
  it("emphasize, question, callout, connect y update_label valen para eventos y tramos", () => {
    const r = applyOps(tl(), [
      op.add_event({ zone: "t", id: "e", label: "E" }), op.add_span({ zone: "t", id: "p", from: 0, to: 10, label: "x" }),
      op.emphasize({ target: "p", style: "underline" }), op.mark_question({ target: "e" }),
      op.add_callout({ id: "n", target: "p", text: "ojo" }), op.connect({ id: "k", from: "e", to: "p" }),
      op.update_label({ id: "p", label: "3 meses" }),
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.board.els.find((e) => e.id === "p")!.label).toBe("3 meses");
  });
});

describe("serialización", () => {
  it("el modelo ve ciclos, eventos y tramos", () => {
    const t = serializeBoard(finalBoard([
      op.create_zone({ id: "c", kind: "cycle", title: "Ciclo", center_label: "Ventana" }),
      op.add_stage({ zone: "c", id: "a", label: "Conversar", note: "pides" }),
      op.create_zone({ id: "t", kind: "timeline", title: "Tiempo" }),
      op.add_event({ zone: "t", id: "e", label: "Idea", when: "Antes", at: 5 }),
      op.add_span({ zone: "t", id: "p", from: 0, to: 40, label: "2 meses", tone: "warn" }),
    ]));
    expect(t).toContain('[cycle] "Ciclo" centro:"Ventana"');
    expect(t).toContain('a (stage) "Conversar" @c nota:"pides"');
    expect(t).toContain('e (event) "Idea" @t at:5 when:"Antes"');
    expect(t).toContain('p (span) "2 meses" @t from:0 to:40 tone:warn');
  });
});

describe("layout cycle", () => {
  const cycleBoard = (n: number, center = "Ventana de contexto") =>
    finalBoard([
      op.create_zone({ id: "c", kind: "cycle", title: "Ciclo", center_label: center }),
      ...Array.from({ length: n }, (_, i) => op.add_stage({ zone: "c", id: `s${i}`, label: `Etapa número ${i + 1}`, note: i % 2 ? "una nota algo más larga" : undefined })),
    ]);

  it.each([2, 3, 5, 8])("%i etapas: sin solapes, dentro de la zona y con anillo cerrado", async (n) => {
    const board = cycleBoard(n);
    const lay = await computeLayout(board);
    const zr = lay.zones.c;
    const rects: [string, Rect][] = board.els.map((e) => [e.id, lay.els[e.id]]);
    rects.push(["centro", lay.labels["center:c"]]);
    noOverlap(rects);
    for (const [id, r] of rects) expect(inside(r, zr), id).toBe(true);
    const rings = Object.keys(lay.edges).filter((k) => k.startsWith("ring:"));
    expect(rings).toHaveLength(n);
    // las flechas no pisan las cajas ni el centro, salvo en sus extremos
    for (const k of rings) {
      const g = lay.edges[k];
      for (const p of g.pts) expect(p.x >= zr.x && p.x <= zr.x + zr.w && p.y >= zr.y && p.y <= zr.y + zr.h, k).toBe(true);
    }
    // la última cierra con la primera
    expect(lay.edges[`ring:s${n - 1}`]).toBeDefined();
  });

  it("el árbol de render trae anillo, centro y etapas; sin flechas auto", async () => {
    const board = cycleBoard(3);
    const tree = buildTree(board, await computeLayout(board));
    for (const k of ["c", "center:c", "s0", "s1", "s2", "ring:s0", "ring:s1", "ring:s2"]) expect(tree.map.has(k), k).toBe(true);
    expect([...tree.map.keys()].some((k) => k.startsWith("auto:"))).toBe(false);
  });

  it("el radio crece con el número de etapas", async () => {
    const a = (await computeLayout(cycleBoard(2))).zones.c, b = (await computeLayout(cycleBoard(8))).zones.c;
    expect(b.w).toBeGreaterThan(a.w);
    expect(b.h).toBeGreaterThan(a.h);
  });

  it("after inserta la etapa en el anillo; sin etapas ni centro no rompe", async () => {
    const b = finalBoard([
      op.create_zone({ id: "c", kind: "cycle", title: "Ciclo" }),
      op.add_stage({ zone: "c", id: "a", label: "A" }), op.add_stage({ zone: "c", id: "b", label: "B" }),
      op.add_stage({ zone: "c", id: "x", label: "X", after: "a" }),
    ]);
    const lay = await computeLayout(b);
    // a arriba, x a la derecha (siguiente horario), b abajo-izquierda
    expect(lay.els.x.x).toBeGreaterThan(lay.els.a.x);
    expect(Object.keys(lay.edges).filter((k) => k.startsWith("ring:"))).toHaveLength(3);
    const empty = finalBoard([op.create_zone({ id: "c", kind: "cycle", title: "Ciclo" })]);
    expect(Object.keys((await computeLayout(empty)).els)).toHaveLength(0);
    const one = await computeLayout(finalBoard([op.create_zone({ id: "c", kind: "cycle", title: "C" }), op.add_stage({ zone: "c", id: "a", label: "A" })]));
    expect(inside(one.els.a, one.zones.c)).toBe(true);
  });
});

describe("layout timeline", () => {
  const tlBoard = (extra: Op[]) => finalBoard([op.create_zone({ id: "t", kind: "timeline", title: "Antes y ahora" }), ...extra]);
  const check = async (board: ReturnType<typeof tlBoard>) => {
    const lay = await computeLayout(board);
    const zr = lay.zones.t;
    const rects: [string, Rect][] = board.els.map((e) => [e.id, lay.els[e.id]]);
    for (const [k, r] of Object.entries(lay.labels)) rects.push([k, r]);
    noOverlap(rects);
    for (const [id, r] of rects) expect(inside(r, zr), id).toBe(true);
    return lay;
  };

  it("eventos con at muy cercanos (10, 12, 14, 90) no se solapan y caben", async () => {
    const lay = await check(tlBoard([
      op.add_event({ zone: "t", id: "a", label: "Primer evento largo", when: "Mes 1", note: "una nota", at: 10 }),
      op.add_event({ zone: "t", id: "b", label: "Segundo evento", when: "Mes 2", at: 12 }),
      op.add_event({ zone: "t", id: "c", label: "Tercer evento", when: "Mes 3", at: 14 }),
      op.add_event({ zone: "t", id: "d", label: "Cuarto", when: "2024", at: 90 }),
    ]));
    expect(new Set(["a", "b", "c"].map((i) => lay.marks[i].side)).size).toBe(2);
    // las cajas respetan el orden por posición dentro de cada lado
    expect(lay.marks.a.stem[1].x).toBeLessThan(lay.marks.d.stem[1].x);
  });

  it("sin at se reparten por igual en orden de inserción", async () => {
    const board = tlBoard(["a", "b", "c", "d", "e"].map((id) => op.add_event({ zone: "t", id, label: id.toUpperCase() })));
    const lay = await check(board);
    const xs = ["a", "b", "c", "d", "e"].map((id) => lay.marks[id].stem[1].x);
    const d = xs.map((x, i) => (i ? x - xs[i - 1] : 0)).slice(1);
    for (const v of d) expect(v).toBeCloseTo(d[0], 5);
    expect(d[0]).toBeGreaterThan(0);
  });

  it("with at, la posición es proporcional aunque se añadan desordenados", async () => {
    const lay = await check(tlBoard([
      op.add_event({ zone: "t", id: "b", label: "B", at: 80 }), op.add_event({ zone: "t", id: "a", label: "A", at: 20 }),
    ]));
    expect(lay.marks.a.stem[1].x).toBeLessThan(lay.marks.b.stem[1].x);
    const ax = lay.edges["axis:t"].pts;
    expect(ax[1].x).toBeGreaterThan(lay.marks.b.stem[1].x);
  });

  it("tramos: llevan carriles separados y caben bajo el eje", async () => {
    const lay = await check(tlBoard([
      op.add_event({ zone: "t", id: "a", label: "Idea", when: "Antes", at: 0 }),
      op.add_event({ zone: "t", id: "b", label: "Software", at: 48 }),
      op.add_event({ zone: "t", id: "c", label: "Prototipo", when: "Ahora", at: 66 }),
      op.add_span({ zone: "t", id: "p1", from: 0, to: 48, label: "2 a 3 meses", tone: "warn" }),
      op.add_span({ zone: "t", id: "p2", from: 66, to: 100, label: "1 mes", tone: "ok" }),
      op.add_span({ zone: "t", id: "p3", from: 10, to: 12, label: "tramo estrecho con etiqueta larga" }),
    ]));
    const axisY = lay.edges["axis:t"].pts[0].y;
    for (const id of ["p1", "p2", "p3"]) expect(lay.els[id].y).toBeGreaterThan(axisY);
    expect(lay.spans.p1.x1).toBeGreaterThan(lay.spans.p1.x0);
    // cajas de eventos de abajo no pisan los tramos (comprobado por noOverlap)
  });

  it("árbol de render: eje, marcas, fechas, tramos y anotaciones", async () => {
    const board = tlBoard([
      op.add_event({ zone: "t", id: "a", label: "Idea", when: "Antes", at: 0 }),
      op.add_event({ zone: "t", id: "b", label: "Sin fecha", at: 50 }),
      op.add_span({ zone: "t", id: "p", from: 0, to: 50, label: "2 meses", tone: "warn" }),
      op.emphasize({ target: "p", style: "underline" }), op.add_callout({ id: "n", target: "a", text: "ojo" }),
      op.emphasize({ target: "b", style: "circle" }),
    ]);
    const tree = buildTree(board, await computeLayout(board));
    for (const k of ["t", "axis:t", "a", "b", "stem:a", "stem:b", "when:a", "p", "emph:p", "emph:b", "n"]) expect(tree.map.has(k), k).toBe(true);
    expect(tree.map.has("when:b")).toBe(false);
    expect(tree.map.get("p")!.data.tone).toBe("warn");
  });

  it("zona vacía y sólo tramos no rompen", async () => {
    await computeLayout(tlBoard([]));
    await check(tlBoard([op.add_span({ zone: "t", id: "p", from: 0, to: 50, label: "x" })]));
  });
});
