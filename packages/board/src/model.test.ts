import { describe, expect, it } from "vitest";
import { applyOp, applyOps, emptyBoard } from "./model";
import { op } from "@grafito/contract";

const base = () =>
  applyOps(emptyBoard(), [
    op.create_zone({ id: "f", kind: "flow", title: "Flow" }),
    op.create_zone({ id: "s", kind: "system", title: "System" }),
    op.create_zone({ id: "l", kind: "list", title: "List" }),
    op.add_step({ zone: "f", id: "a", label: "A" }),
    op.add_step({ zone: "f", id: "b", label: "B", after: "a" }),
    op.add_component({ zone: "s", id: "api", label: "API", type: "service" }),
    op.add_item({ zone: "l", id: "i1", text: "one" }),
  ]).board;

describe("model", () => {
  it("applies valid ops without warnings", () => {
    const r = applyOps(emptyBoard(), [op.create_zone({ id: "f", kind: "flow", title: "F" }), op.add_step({ zone: "f", id: "a", label: "A" })]);
    expect(r.warnings).toEqual([]);
    expect(r.board.elements).toHaveLength(1);
  });
  it("ignores invalid ops with a warning and leaves the board unchanged", () => {
    const b = base();
    for (const bad of [
      op.add_step({ zone: "nope", id: "x", label: "X" }),
      op.add_step({ zone: "s", id: "x", label: "X" }), // step in a system zone
      op.add_step({ zone: "f", id: "a", label: "dup" }), // duplicate id
      op.connect({ id: "c", from: "a", to: "zzz" }),
      op.emphasize({ target: "zzz", style: "circle" }),
      op.delete({ id: "zzz" }),
      op.move_to_zone({ id: "a", zone: "s" }), // step does not fit in system
      { name: "inventada", input: {} } as any,
      null as any,
    ]) {
      const r = applyOp(b, bad);
      expect(r.board).toBe(b);
      expect(r.warnings.length).toBe(1);
    }
  });
  it("a missing after is ignored with a warning but the element is created", () => {
    const r = applyOp(base(), op.add_step({ zone: "f", id: "c", label: "C", after: "fantasma" }));
    expect(r.warnings).toHaveLength(1);
    expect(r.board.elements.find((e) => e.id === "c")?.after).toBeUndefined();
  });
  it("deleting an element removes its connections and annotations", () => {
    let b = base();
    b = applyOps(b, [
      op.connect({ id: "c1", from: "a", to: "api" }),
      op.emphasize({ target: "a", style: "star" }),
      op.add_callout({ id: "n", target: "a", text: "look" }),
    ]).board;
    const r = applyOp(b, op.delete({ id: "a" }));
    expect(r.board.connections).toHaveLength(0);
    expect(r.board.emphasis).toHaveLength(0);
    expect(r.board.callouts).toHaveLength(0);
    expect(r.board.elements.find((e) => e.id === "b")?.after).toBeUndefined();
  });
  it("deleting a zone deletes its contents", () => {
    const b = applyOps(base(), [op.connect({ id: "c1", from: "a", to: "api" })]).board;
    const r = applyOp(b, op.delete({ id: "f" })).board;
    expect(r.zones.map((z) => z.id)).toEqual(["s", "l"]);
    expect(r.elements.map((e) => e.id)).toEqual(["api", "i1"]);
    expect(r.connections).toHaveLength(0);
  });
  it("update_label works for zone, element and connection", () => {
    let b = applyOps(base(), [op.connect({ id: "c1", from: "a", to: "api", label: "x" })]).board;
    b = applyOps(b, [op.update_label({ id: "f", label: "New" }), op.update_label({ id: "a", label: "AA" }), op.update_label({ id: "c1", label: "y" })]).board;
    expect(b.zones[0].title).toBe("New");
    expect(b.elements[0].label).toBe("AA");
    expect(b.connections[0].label).toBe("y");
  });
  it("move_to_zone moves to a compatible zone and cuts dependencies between zones", () => {
    let b = applyOps(base(), [op.create_zone({ id: "g", kind: "flow", title: "Other" })]).board;
    b = applyOp(b, op.move_to_zone({ id: "b", zone: "g" })).board;
    const element = b.elements.find((e) => e.id === "b")!;
    expect(element.zone).toBe("g");
    expect(element.after).toBeUndefined();
  });
  it("placement hints to nonexistent zones are ignored", () => {
    const r = applyOp(emptyBoard(), op.create_zone({ id: "z", kind: "list", title: "Z", place: { relation: "below", of: "no" } }));
    expect(r.warnings).toHaveLength(1);
    expect(r.board.zones[0].place).toBeUndefined();
  });
});

describe("scale", () => {
  const scale = () =>
    applyOps(base(), [op.create_zone({ id: "e", kind: "scale", title: "Window" })]).board;

  it("create_zone scale carries default labels or the given ones", () => {
    const z = scale().zones.find((x) => x.id === "e")!;
    expect(z.minLabel).toBe("0%");
    expect(z.maxLabel).toBe("100%");
    const z2 = applyOp(emptyBoard(), op.create_zone({ id: "e", kind: "scale", title: "T", min_label: "empty", max_label: "1 M" })).board.zones[0];
    expect([z2.minLabel, z2.maxLabel]).toEqual(["empty", "1 M"]);
  });
  it("add_mark creates a mark with a neutral tone by default", () => {
    const r = applyOps(scale(), [
      op.add_mark({ zone: "e", id: "m1", at: 20, label: "20%", note: "bad", tone: "warn" }),
      op.add_mark({ zone: "e", id: "m2", at: 0, label: "start" }),
      op.add_mark({ zone: "e", id: "m3", at: 100, label: "end" }),
    ]);
    expect(r.warnings).toEqual([]);
    const m = r.board.elements.filter((e) => e.type === "mark");
    expect(m.map((e) => [e.id, e.at, e.tone])).toEqual([["m1", 20, "warn"], ["m2", 0, "neutral"], ["m3", 100, "neutral"]]);
    expect(m[0].note).toBe("bad");
  });
  it("an invalid add_mark is ignored with a warning", () => {
    const b = applyOp(scale(), op.add_mark({ zone: "e", id: "m1", at: 20, label: "ok" })).board;
    for (const bad of [
      op.add_mark({ zone: "nope", id: "x", at: 5, label: "x" }),
      op.add_mark({ zone: "f", id: "x", at: 5, label: "x" }), // flow zone
      op.add_mark({ zone: "e", id: "m1", at: 5, label: "dup" }), // duplicate id
      op.add_mark({ zone: "e", id: "f", at: 5, label: "dup" }), // zone id
      op.add_mark({ zone: "e", id: "x", at: 101, label: "x" }),
      op.add_mark({ zone: "e", id: "x", at: -0.5, label: "x" }),
      op.add_mark({ zone: "e", id: "x", at: NaN, label: "x" }),
      op.add_mark({ zone: "e", id: "x", at: Infinity, label: "x" }),
      op.add_mark({ zone: "e", id: "x", at: "5" as any, label: "x" }),
      op.add_mark({ zone: "e", id: "x", at: 5, label: " " }),
      op.add_mark({ zone: "e", id: "x", at: 5, label: "x", tone: "azul" as any }),
      op.add_step({ zone: "e", id: "x", label: "step" }), // step in a scale zone
    ]) {
      const r = applyOp(b, bad);
      expect(r.board).toBe(b);
      expect(r.warnings).toHaveLength(1);
    }
  });
  it("set_level sets and moves the level", () => {
    let b = applyOp(scale(), op.set_level({ zone: "e", at: 60, label: "fills up" })).board;
    expect(b.zones.find((z) => z.id === "e")!.level).toEqual({ at: 60, label: "fills up" });
    b = applyOp(b, op.set_level({ zone: "e", at: 75 })).board;
    expect(b.zones.find((z) => z.id === "e")!.level).toEqual({ at: 75 });
  });
  it("an invalid set_level is ignored with a warning", () => {
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
  it("marks are targets of emphasize, callout, mark_question and connect", () => {
    const r = applyOps(scale(), [
      op.add_mark({ zone: "e", id: "m1", at: 20, label: "20%" }),
      op.emphasize({ target: "m1", style: "circle" }),
      op.mark_question({ target: "m1" }),
      op.add_callout({ id: "n", target: "m1", text: "look" }),
      op.connect({ id: "c1", from: "a", to: "m1" }),
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.board.connections).toHaveLength(1);
  });
  it("deleting a mark clears its references; deleting the zone takes the marks with it", () => {
    let b = applyOps(scale(), [
      op.add_mark({ zone: "e", id: "m1", at: 20, label: "20%" }),
      op.emphasize({ target: "m1", style: "star" }),
    ]).board;
    const r1 = applyOp(b, op.delete({ id: "m1" })).board;
    expect(r1.emphasis).toHaveLength(0);
    expect(r1.elements.some((e) => e.id === "m1")).toBe(false);
    b = applyOp(b, op.delete({ id: "e" })).board;
    expect(b.elements.some((e) => e.id === "m1")).toBe(false);
  });

  describe("update_text", () => {
    const tl = () =>
      applyOps(base(), [
        op.create_zone({ id: "t", kind: "timeline", title: "Time" }),
        op.add_event({ zone: "t", id: "e1", label: "Milestone", when: "Before", note: "Chewed idea" }),
        op.connect({ id: "c1", from: "a", to: "api", label: "x" }),
        op.add_callout({ id: "n1", target: "a", text: "Look" }),
      ]).board;
    const upd = (b: ReturnType<typeof tl>, id: string, field: any, value: string) => applyOp(b, op.update_text({ id, field, value }));
    it("changes and clears the note without deleting the element", () => {
      let r = upd(tl(), "e1", "note", "Otra");
      expect(r.warnings).toEqual([]);
      expect(r.board.elements.find((e) => e.id === "e1")?.note).toBe("Otra");
      r = upd(r.board, "e1", "note", "");
      expect(r.board.elements.find((e) => e.id === "e1")).toMatchObject({ label: "Milestone", when: "Before" });
      expect(r.board.elements.find((e) => e.id === "e1")?.note).toBeUndefined();
    });
    it("when, zone/element label, connection label (empty removes it) and note text", () => {
      let b = upd(tl(), "e1", "when", "").board;
      expect(b.elements.find((e) => e.id === "e1")?.when).toBeUndefined();
      b = upd(b, "t", "label", "T2").board;
      expect(b.zones.find((z) => z.id === "t")?.title).toBe("T2");
      b = upd(b, "a", "label", "AA").board;
      expect(b.elements.find((e) => e.id === "a")?.label).toBe("AA");
      b = upd(b, "c1", "label", "").board;
      expect(b.connections[0].label).toBeUndefined();
      b = upd(b, "n1", "text", "New").board;
      expect(b.callouts[0].text).toBe("New");
    });
    it("clear errors: missing field, empty required text, unknown id", () => {
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

describe("service (service icon)", () => {
  const svcBoard = () =>
    applyOps(emptyBoard(), [
      op.create_zone({ id: "f", kind: "flow", title: "Flow" }),
      op.create_zone({ id: "s", kind: "system", title: "System" }),
      op.create_zone({ id: "l", kind: "list", title: "List" }),
    ]).board;

  it("service on add_step, add_component and add_decision stores aws:<id>", () => {
    const r = applyOps(svcBoard(), [
      op.add_step({ zone: "f", id: "a", label: "A", service: "lambda" }),
      op.add_decision({ zone: "f", id: "d", question: "Ok?", service: "api-gateway" }),
      op.add_component({ zone: "s", id: "fn", label: "Fn", type: "service", service: "s3" }),
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.board.elements.map((e) => e.service)).toEqual(["aws:lambda", "aws:api-gateway", "aws:s3"]);
  });
  it("with a valid service the icon emoji is ignored; without service it is kept", () => {
    const r = applyOps(svcBoard(), [
      op.add_step({ zone: "f", id: "a", label: "A", icon: "⚡", service: "lambda" }),
      op.add_step({ zone: "f", id: "b", label: "B", icon: "⚡" }),
    ]).board;
    expect(r.elements[0]).toMatchObject({ service: "aws:lambda" });
    expect(r.elements[0].icon).toBeUndefined();
    expect(r.elements[1].icon).toBe("⚡");
  });
  it("an unknown id is ignored with a warning and the element is created normally", () => {
    for (const bad of ["made-up", "aws:made-up"]) {
      const r = applyOps(svcBoard(), [op.add_step({ zone: "f", id: "a", label: "A", icon: "⚡", service: bad })]);
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toMatch(/service/);
      expect(r.board.elements[0]).toMatchObject({ id: "a", icon: "⚡" });
      expect(r.board.elements[0].service).toBeUndefined();
    }
  });
  it("set_service sets, changes and removes on a box, diamond and step", () => {
    let b = applyOps(svcBoard(), [
      op.add_step({ zone: "f", id: "p", label: "P" }),
      op.add_decision({ zone: "f", id: "d", question: "?" }),
      op.add_component({ zone: "s", id: "c", label: "C", type: "database" }),
      op.add_item({ zone: "l", id: "it", text: "x" }),
    ]).board;
    for (const id of ["p", "d", "c", "it"]) {
      b = applyOp(b, op.set_service({ id, service: "lambda" })).board;
      expect(b.elements.find((e) => e.id === id)!.service).toBe("aws:lambda");
      b = applyOp(b, op.set_service({ id, service: "aws:dynamodb" })).board;
      expect(b.elements.find((e) => e.id === id)!.service).toBe("aws:dynamodb");
      b = applyOp(b, op.set_service({ id, service: "" })).board;
      expect(b.elements.find((e) => e.id === id)!.service).toBeUndefined();
    }
  });
  it("unknown set_service, missing id or zone: warning and no change; keeps the emoji", () => {
    const b = applyOps(svcBoard(), [op.add_step({ zone: "f", id: "p", label: "P", icon: "⚡", service: "s3" })]).board;
    for (const bad of [op.set_service({ id: "p", service: "made-up" }), op.set_service({ id: "zzz", service: "s3" }), op.set_service({ id: "f", service: "s3" })]) {
      const r = applyOp(b, bad);
      expect(r.warnings).toHaveLength(1);
      expect(r.board).toEqual(b);
    }
    const withIcon = applyOps(svcBoard(), [op.add_step({ zone: "f", id: "q", label: "Q", icon: "⚡" }), op.set_service({ id: "q", service: "lambda" })]).board;
    expect(withIcon.elements[0]).toMatchObject({ icon: "⚡", service: "aws:lambda" });
  });
});
