import { describe, expect, it } from "vitest";
import { applyOp, applyOps, emptyBoard } from "./model";
import { op } from "@grafito/contract";

const base = () =>
  applyOps(emptyBoard(), [
    op.create_zone({ id: "f", kind: "flow", title: "Flujo" }),
    op.create_zone({ id: "s", kind: "system", title: "Sistema" }),
    op.create_zone({ id: "l", kind: "list", title: "Lista" }),
    op.add_step({ zone: "f", id: "a", label: "A" }),
    op.add_step({ zone: "f", id: "b", label: "B", after: "a" }),
    op.add_component({ zone: "s", id: "api", label: "API", type: "service" }),
    op.add_item({ zone: "l", id: "i1", text: "uno" }),
  ]).board;

describe("model", () => {
  it("aplica ops válidas sin avisos", () => {
    const r = applyOps(emptyBoard(), [op.create_zone({ id: "f", kind: "flow", title: "F" }), op.add_step({ zone: "f", id: "a", label: "A" })]);
    expect(r.warnings).toEqual([]);
    expect(r.board.els).toHaveLength(1);
  });
  it("ignora ops inválidas con aviso y no cambia el tablero", () => {
    const b = base();
    for (const bad of [
      op.add_step({ zone: "nope", id: "x", label: "X" }),
      op.add_step({ zone: "s", id: "x", label: "X" }), // paso en zona system
      op.add_step({ zone: "f", id: "a", label: "dup" }), // id repetido
      op.connect({ id: "c", from: "a", to: "zzz" }),
      op.emphasize({ target: "zzz", style: "circle" }),
      op.delete({ id: "zzz" }),
      op.move_to_zone({ id: "a", zone: "s" }), // paso no cabe en system
      { name: "inventada", input: {} } as any,
      null as any,
    ]) {
      const r = applyOp(b, bad);
      expect(r.board).toBe(b);
      expect(r.warnings.length).toBe(1);
    }
  });
  it("after inexistente se ignora con aviso pero crea el elemento", () => {
    const r = applyOp(base(), op.add_step({ zone: "f", id: "c", label: "C", after: "fantasma" }));
    expect(r.warnings).toHaveLength(1);
    expect(r.board.els.find((e) => e.id === "c")?.after).toBeUndefined();
  });
  it("borrar un elemento quita sus conexiones y anotaciones", () => {
    let b = base();
    b = applyOps(b, [
      op.connect({ id: "c1", from: "a", to: "api" }),
      op.emphasize({ target: "a", style: "star" }),
      op.add_callout({ id: "n", target: "a", text: "ojo" }),
    ]).board;
    const r = applyOp(b, op.delete({ id: "a" }));
    expect(r.board.conns).toHaveLength(0);
    expect(r.board.emph).toHaveLength(0);
    expect(r.board.callouts).toHaveLength(0);
    expect(r.board.els.find((e) => e.id === "b")?.after).toBeUndefined();
  });
  it("borrar una zona borra su contenido", () => {
    const b = applyOps(base(), [op.connect({ id: "c1", from: "a", to: "api" })]).board;
    const r = applyOp(b, op.delete({ id: "f" })).board;
    expect(r.zones.map((z) => z.id)).toEqual(["s", "l"]);
    expect(r.els.map((e) => e.id)).toEqual(["api", "i1"]);
    expect(r.conns).toHaveLength(0);
  });
  it("update_label sirve para zona, elemento y conexión", () => {
    let b = applyOps(base(), [op.connect({ id: "c1", from: "a", to: "api", label: "x" })]).board;
    b = applyOps(b, [op.update_label({ id: "f", label: "Nuevo" }), op.update_label({ id: "a", label: "AA" }), op.update_label({ id: "c1", label: "y" })]).board;
    expect(b.zones[0].title).toBe("Nuevo");
    expect(b.els[0].label).toBe("AA");
    expect(b.conns[0].label).toBe("y");
  });
  it("move_to_zone cambia de zona compatible y corta las dependencias entre zonas", () => {
    let b = applyOps(base(), [op.create_zone({ id: "g", kind: "flow", title: "Otro" })]).board;
    b = applyOp(b, op.move_to_zone({ id: "b", zone: "g" })).board;
    const el = b.els.find((e) => e.id === "b")!;
    expect(el.zone).toBe("g");
    expect(el.after).toBeUndefined();
  });
  it("las pistas de colocación a zonas inexistentes se ignoran", () => {
    const r = applyOp(emptyBoard(), op.create_zone({ id: "z", kind: "list", title: "Z", place: { relation: "below", of: "no" } }));
    expect(r.warnings).toHaveLength(1);
    expect(r.board.zones[0].place).toBeUndefined();
  });
});

describe("scale", () => {
  const scale = () =>
    applyOps(base(), [op.create_zone({ id: "e", kind: "scale", title: "Ventana" })]).board;

  it("create_zone scale lleva etiquetas por defecto o las dadas", () => {
    const z = scale().zones.find((x) => x.id === "e")!;
    expect(z.minLabel).toBe("0%");
    expect(z.maxLabel).toBe("100%");
    const z2 = applyOp(emptyBoard(), op.create_zone({ id: "e", kind: "scale", title: "T", min_label: "vacío", max_label: "1 M" })).board.zones[0];
    expect([z2.minLabel, z2.maxLabel]).toEqual(["vacío", "1 M"]);
  });
  it("add_mark crea una marca con tono neutral por omisión", () => {
    const r = applyOps(scale(), [
      op.add_mark({ zone: "e", id: "m1", at: 20, label: "20%", note: "mal", tone: "warn" }),
      op.add_mark({ zone: "e", id: "m2", at: 0, label: "inicio" }),
      op.add_mark({ zone: "e", id: "m3", at: 100, label: "fin" }),
    ]);
    expect(r.warnings).toEqual([]);
    const m = r.board.els.filter((e) => e.type === "mark");
    expect(m.map((e) => [e.id, e.at, e.tone])).toEqual([["m1", 20, "warn"], ["m2", 0, "neutral"], ["m3", 100, "neutral"]]);
    expect(m[0].note).toBe("mal");
  });
  it("add_mark inválido se ignora con aviso", () => {
    const b = applyOp(scale(), op.add_mark({ zone: "e", id: "m1", at: 20, label: "ok" })).board;
    for (const bad of [
      op.add_mark({ zone: "nope", id: "x", at: 5, label: "x" }),
      op.add_mark({ zone: "f", id: "x", at: 5, label: "x" }), // zona flow
      op.add_mark({ zone: "e", id: "m1", at: 5, label: "dup" }), // id repetido
      op.add_mark({ zone: "e", id: "f", at: 5, label: "dup" }), // id de zona
      op.add_mark({ zone: "e", id: "x", at: 101, label: "x" }),
      op.add_mark({ zone: "e", id: "x", at: -0.5, label: "x" }),
      op.add_mark({ zone: "e", id: "x", at: NaN, label: "x" }),
      op.add_mark({ zone: "e", id: "x", at: Infinity, label: "x" }),
      op.add_mark({ zone: "e", id: "x", at: "5" as any, label: "x" }),
      op.add_mark({ zone: "e", id: "x", at: 5, label: " " }),
      op.add_mark({ zone: "e", id: "x", at: 5, label: "x", tone: "azul" as any }),
      op.add_step({ zone: "e", id: "x", label: "paso" }), // paso en zona scale
    ]) {
      const r = applyOp(b, bad);
      expect(r.board).toBe(b);
      expect(r.warnings).toHaveLength(1);
    }
  });
  it("set_level fija y mueve el nivel", () => {
    let b = applyOp(scale(), op.set_level({ zone: "e", at: 60, label: "se llena" })).board;
    expect(b.zones.find((z) => z.id === "e")!.level).toEqual({ at: 60, label: "se llena" });
    b = applyOp(b, op.set_level({ zone: "e", at: 75 })).board;
    expect(b.zones.find((z) => z.id === "e")!.level).toEqual({ at: 75 });
  });
  it("set_level inválido se ignora con aviso", () => {
    const b = scale();
    for (const bad of [
      op.set_level({ zone: "nope", at: 5 }),
      op.set_level({ zone: "f", at: 5 }),
      op.set_level({ zone: "e", at: 101 }),
      op.set_level({ zone: "e", at: -1 }),
      op.set_level({ zone: "e", at: NaN }),
    ]) {
      const r = applyOp(b, bad);
      expect(r.board).toBe(b);
      expect(r.warnings).toHaveLength(1);
    }
  });
  it("las marcas son objetivos de emphasize, callout, mark_question y connect", () => {
    const r = applyOps(scale(), [
      op.add_mark({ zone: "e", id: "m1", at: 20, label: "20%" }),
      op.emphasize({ target: "m1", style: "circle" }),
      op.mark_question({ target: "m1" }),
      op.add_callout({ id: "n", target: "m1", text: "ojo" }),
      op.connect({ id: "c1", from: "a", to: "m1" }),
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.board.conns).toHaveLength(1);
  });
  it("borrar una marca limpia sus referencias; borrar la zona se lleva las marcas", () => {
    let b = applyOps(scale(), [
      op.add_mark({ zone: "e", id: "m1", at: 20, label: "20%" }),
      op.emphasize({ target: "m1", style: "star" }),
    ]).board;
    const r1 = applyOp(b, op.delete({ id: "m1" })).board;
    expect(r1.emph).toHaveLength(0);
    expect(r1.els.some((e) => e.id === "m1")).toBe(false);
    b = applyOp(b, op.delete({ id: "e" })).board;
    expect(b.els.some((e) => e.id === "m1")).toBe(false);
  });

  describe("update_text", () => {
    const tl = () =>
      applyOps(base(), [
        op.create_zone({ id: "t", kind: "timeline", title: "Tiempo" }),
        op.add_event({ zone: "t", id: "e1", label: "Hito", when: "Antes", note: "Idea masticada" }),
        op.connect({ id: "c1", from: "a", to: "api", label: "x" }),
        op.add_callout({ id: "n1", target: "a", text: "Ojo" }),
      ]).board;
    const upd = (b: ReturnType<typeof tl>, id: string, field: any, value: string) => applyOp(b, op.update_text({ id, field, value }));
    it("cambia y borra la nota sin borrar el elemento", () => {
      let r = upd(tl(), "e1", "note", "Otra");
      expect(r.warnings).toEqual([]);
      expect(r.board.els.find((e) => e.id === "e1")?.note).toBe("Otra");
      r = upd(r.board, "e1", "note", "");
      expect(r.board.els.find((e) => e.id === "e1")).toMatchObject({ label: "Hito", when: "Antes" });
      expect(r.board.els.find((e) => e.id === "e1")?.note).toBeUndefined();
    });
    it("when, label de zona/elemento, label de conexión (vacío la quita) y text de nota", () => {
      let b = upd(tl(), "e1", "when", "").board;
      expect(b.els.find((e) => e.id === "e1")?.when).toBeUndefined();
      b = upd(b, "t", "label", "T2").board;
      expect(b.zones.find((z) => z.id === "t")?.title).toBe("T2");
      b = upd(b, "a", "label", "AA").board;
      expect(b.els.find((e) => e.id === "a")?.label).toBe("AA");
      b = upd(b, "c1", "label", "").board;
      expect(b.conns[0].label).toBeUndefined();
      b = upd(b, "n1", "text", "Nuevo").board;
      expect(b.callouts[0].text).toBe("Nuevo");
    });
    it("errores claros: campo inexistente, vacío en texto obligatorio, id desconocido", () => {
      const b = tl();
      for (const [id, f, v] of [["a", "note", "x"], ["a", "when", "x"], ["e1", "text", "x"], ["n1", "label", "x"], ["a", "label", ""], ["n1", "text", ""], ["nope", "note", "x"], ["a", "otro", "x"]] as const) {
        const r = upd(b, id, f, v);
        expect(r.board).toBe(b);
        expect(r.warnings).toHaveLength(1);
        expect(r.warnings[0]).toContain("update_text");
      }
    });
  });
});

describe("service (icono de servicio)", () => {
  const svcBoard = () =>
    applyOps(emptyBoard(), [
      op.create_zone({ id: "f", kind: "flow", title: "Flujo" }),
      op.create_zone({ id: "s", kind: "system", title: "Sistema" }),
      op.create_zone({ id: "l", kind: "list", title: "Lista" }),
    ]).board;

  it("service en add_step, add_component y add_decision guarda aws:<id>", () => {
    const r = applyOps(svcBoard(), [
      op.add_step({ zone: "f", id: "a", label: "A", service: "lambda" }),
      op.add_decision({ zone: "f", id: "d", question: "¿Ok?", service: "api-gateway" }),
      op.add_component({ zone: "s", id: "fn", label: "Fn", type: "service", service: "s3" }),
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.board.els.map((e) => e.service)).toEqual(["aws:lambda", "aws:api-gateway", "aws:s3"]);
  });
  it("con service válido el emoji icon se ignora; sin service se conserva", () => {
    const r = applyOps(svcBoard(), [
      op.add_step({ zone: "f", id: "a", label: "A", icon: "⚡", service: "lambda" }),
      op.add_step({ zone: "f", id: "b", label: "B", icon: "⚡" }),
    ]).board;
    expect(r.els[0]).toMatchObject({ service: "aws:lambda" });
    expect(r.els[0].icon).toBeUndefined();
    expect(r.els[1].icon).toBe("⚡");
  });
  it("id desconocido se ignora con aviso y el elemento se crea normal", () => {
    for (const bad of ["inventado", "aws:inventado"]) {
      const r = applyOps(svcBoard(), [op.add_step({ zone: "f", id: "a", label: "A", icon: "⚡", service: bad })]);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toMatch(/service/);
      expect(r.board.els[0]).toMatchObject({ id: "a", icon: "⚡" });
      expect(r.board.els[0].service).toBeUndefined();
    }
  });
  it("set_service pone, cambia y quita en caja, rombo y paso", () => {
    let b = applyOps(svcBoard(), [
      op.add_step({ zone: "f", id: "p", label: "P" }),
      op.add_decision({ zone: "f", id: "d", question: "¿?" }),
      op.add_component({ zone: "s", id: "c", label: "C", type: "database" }),
      op.add_item({ zone: "l", id: "it", text: "x" }),
    ]).board;
    for (const id of ["p", "d", "c", "it"]) {
      b = applyOp(b, op.set_service({ id, service: "lambda" })).board;
      expect(b.els.find((e) => e.id === id)!.service).toBe("aws:lambda");
      b = applyOp(b, op.set_service({ id, service: "aws:dynamodb" })).board;
      expect(b.els.find((e) => e.id === id)!.service).toBe("aws:dynamodb");
      b = applyOp(b, op.set_service({ id, service: "" })).board;
      expect(b.els.find((e) => e.id === id)!.service).toBeUndefined();
    }
  });
  it("set_service desconocido, id inexistente o zona: aviso y sin cambios; conserva el emoji", () => {
    const b = applyOps(svcBoard(), [op.add_step({ zone: "f", id: "p", label: "P", icon: "⚡", service: "s3" })]).board;
    for (const bad of [op.set_service({ id: "p", service: "inventado" }), op.set_service({ id: "zzz", service: "s3" }), op.set_service({ id: "f", service: "s3" })]) {
      const r = applyOp(b, bad);
      expect(r.warnings).toHaveLength(1);
      expect(r.board).toEqual(b);
    }
    const withIcon = applyOps(svcBoard(), [op.add_step({ zone: "f", id: "q", label: "Q", icon: "⚡" }), op.set_service({ id: "q", service: "lambda" })]).board;
    expect(withIcon.els[0]).toMatchObject({ icon: "⚡", service: "aws:lambda" });
  });
});
