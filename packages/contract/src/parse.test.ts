import { describe, expect, it } from "vitest";
import { AWS_SERVICES } from "@grafito/icons";
import { normalizeCatalogs, parseOp, toolDefs } from "./parse";

const IDS = AWS_SERVICES.map((s) => s.id);
const ok = (name: string, input: unknown, catalogs: readonly string[] = []) => parseOp({ name, input }, catalogs).ok;
const error = (name: string, input: unknown, catalogs: readonly string[] = []) => {
  const r = parseOp({ name, input }, catalogs);
  return r.ok ? null : r.error;
};

describe("toolDefs: what Claude sees", () => {
  // Any change to the tools Claude is sent shows up as a diff in these files.
  it("catalogs off", async () => {
    await expect(JSON.stringify(toolDefs([]), null, 2) + "\n").toMatchFileSnapshot("./__snapshots__/tools.off.json");
  });
  it("AWS catalog on", async () => {
    await expect(JSON.stringify(toolDefs(["aws"]), null, 2) + "\n").toMatchFileSnapshot("./__snapshots__/tools.aws.json");
  });

  it("21 tools with catalogs off; set_service added before update_summary with AWS on", () => {
    const off = toolDefs([]).map((t) => t.name);
    const on = toolDefs(["aws"]).map((t) => t.name);
    expect(off).toHaveLength(21);
    expect(off).not.toContain("set_service");
    expect(on).toEqual([...off.slice(0, -1), "set_service", "update_summary"]);
  });
  it("one cached set per catalog combination", () => {
    expect(toolDefs([])).toBe(toolDefs([]));
    expect(toolDefs(["aws", "aws"])).toBe(toolDefs(["aws"]));
    expect(normalizeCatalogs(["b", "a", "b"])).toEqual(["a", "b"]);
  });
  it("JSON Schema the way it has always been sent: no $schema, object description right after type", () => {
    const json = JSON.stringify(toolDefs(["aws"]));
    expect(json).not.toContain("$schema");
    const zone = toolDefs([]).find((t) => t.name === "create_zone")!;
    expect(Object.keys(zone)).toEqual(["name", "description", "input_schema", "eager_input_streaming"]);
    expect(Object.keys(zone.input_schema)).toEqual(["type", "properties", "required", "additionalProperties"]);
    expect(Object.keys(zone.input_schema.properties.place as object)).toEqual(["type", "description", "properties", "required", "additionalProperties"]);
    // a property called "type" is a property, not a schema keyword
    const comp = toolDefs([]).find((t) => t.name === "add_component")!;
    expect(comp.input_schema.properties.type).toEqual({ type: "string", enum: ["actor", "client", "service", "database", "queue", "storage", "external"] });
  });
  it("service is an enum of the catalog ids, only in add_step, add_decision and add_component", () => {
    expect(JSON.stringify(toolDefs([]))).not.toContain('service":{');
    for (const t of toolDefs(["aws"])) {
      const service = (t.input_schema.properties as Record<string, { enum?: string[] }>).service;
      if (["add_step", "add_decision", "add_component"].includes(t.name)) expect(service.enum).toEqual(IDS);
      else if (t.name === "set_service") expect(service.enum).toEqual([...IDS, ""]);
      else expect(service).toBeUndefined();
    }
  });
});

describe("parseOp: the shape of an op", () => {
  it("returns the typed op", () => {
    expect(parseOp({ name: "delete", input: { id: "a" } }, [])).toEqual({ ok: true, op: { name: "delete", input: { id: "a" } } });
  });
  it("rejects what is not an op, with the name first in the message", () => {
    expect(parseOp(null, [])).toEqual({ ok: false, error: "?: malformed operation" });
    expect(parseOp({ input: {} }, [])).toEqual({ ok: false, error: "?: malformed operation" });
    expect(error("nada", {})).toBe('nada: unknown tool "nada"');
    expect(error("delete", null)).toBe("delete: input is not an object");
    expect(error("delete", ["a"])).toBe("delete: input is not an object");
    expect(error("delete", {})).toMatch(/^delete: .*\(at \/id\)$/);
  });
  it("required fields, enums and extra keys", () => {
    expect(ok("delete", { id: "a" })).toBe(true);
    expect(ok("delete", {})).toBe(false);
    expect(ok("create_zone", { id: "a", kind: "raro", title: "t" })).toBe(false);
    expect(ok("create_zone", { id: "a", kind: "flow", title: "t", place: { relation: "above", of: "b" } })).toBe(false);
    expect(ok("add_component", { zone: "s", id: "c", label: "C", type: "robot" })).toBe(false);
    expect(ok("emphasize", { target: "a", style: "glow" })).toBe(false);
    expect(ok("update_text", { id: "a", field: "otro", value: "x" })).toBe(false);
    expect(ok("update_text", { id: "a", field: "note", value: 3 })).toBe(false);
    expect(ok("update_text", { id: "a", field: "note", value: "" })).toBe(true); // empty value removes the text
  });
  it("required text and ids must not be blank", () => {
    expect(error("create_zone", { id: "a", kind: "flow", title: " " })).toMatch(/blank/);
    expect(ok("create_zone", { id: "", kind: "flow", title: "t" })).toBe(false);
    expect(ok("create_zone", { id: "  ", kind: "flow", title: "t" })).toBe(false);
    expect(ok("add_stage", { zone: "c", id: "x", label: " " })).toBe(false);
    expect(ok("add_event", { zone: "t", id: "x", label: "" })).toBe(false);
    expect(ok("add_mark", { zone: "e", id: "x", at: 5, label: " " })).toBe(false);
    expect(ok("add_span", { zone: "t", id: "x", from: 0, to: 5, label: " " })).toBe(false);
    expect(ok("add_callout", { id: "n", target: "a", text: " " })).toBe(false);
    expect(ok("update_label", { id: "a", label: "" })).toBe(false);
    expect(ok("update_summary", { text: " " })).toBe(false);
    expect(ok("add_branch", { zone: "t", id: "x" })).toBe(false);
  });
  it("scale: add_mark and set_level", () => {
    expect(ok("create_zone", { id: "e", kind: "scale", title: "t", min_label: "0", max_label: "1M" })).toBe(true);
    expect(ok("add_mark", { zone: "e", id: "m", at: 20, label: "20%", note: "n", tone: "warn" })).toBe(true);
    expect(ok("add_mark", { zone: "e", id: "m", at: 0, label: "x" })).toBe(true);
    expect(ok("add_mark", { zone: "e", id: "m", at: 100, label: "x" })).toBe(true);
    for (const at of [101, -1, -0.5, NaN, Infinity, "20"]) expect(ok("add_mark", { zone: "e", id: "m", at, label: "x" })).toBe(false);
    expect(ok("add_mark", { zone: "e", id: "m", at: 20 })).toBe(false);
    expect(ok("add_mark", { zone: "e", id: "m", at: 20, label: "x", tone: "rojo" })).toBe(false);
    expect(ok("add_mark", { zone: "e", id: "m", at: 20, label: "x", extra: 1 })).toBe(false);
    expect(ok("set_level", { zone: "e", at: 60, label: "se llena" })).toBe(true);
    for (const at of [160, -1, NaN]) expect(ok("set_level", { zone: "e", at })).toBe(false);
    expect(ok("set_level", { at: 60 })).toBe(false);
  });
  it("cycle and timeline: add_stage, add_event, add_span, center_label", () => {
    expect(ok("create_zone", { id: "c", kind: "cycle", title: "t", center_label: "Window" })).toBe(true);
    expect(ok("create_zone", { id: "c", kind: "timeline", title: "t" })).toBe(true);
    expect(ok("add_stage", { zone: "c", id: "s", label: "x", note: "n", after: "a" })).toBe(true);
    expect(ok("add_stage", { zone: "c", id: "s" })).toBe(false);
    expect(ok("add_event", { zone: "t", id: "e", label: "x", when: "Before", note: "n", at: 0 })).toBe(true);
    expect(ok("add_event", { zone: "t", id: "e", label: "x", at: 100 })).toBe(true);
    for (const at of [101, -1, NaN, "5"]) expect(ok("add_event", { zone: "t", id: "e", label: "x", at })).toBe(false);
    expect(ok("add_event", { zone: "t", id: "e", label: "x", extra: 1 })).toBe(false);
    expect(ok("add_span", { zone: "t", id: "p", from: 0, to: 50, label: "x", tone: "warn" })).toBe(true);
    expect(ok("add_span", { zone: "t", id: "p", from: 0, to: 150, label: "x" })).toBe(false);
    expect(ok("add_span", { zone: "t", id: "p", from: -1, to: 50, label: "x" })).toBe(false);
    expect(ok("add_span", { zone: "t", id: "p", from: Infinity, to: 101, label: "x" })).toBe(false);
    expect(ok("add_span", { zone: "t", id: "p", from: 0, to: 50 })).toBe(false);
    expect(ok("add_span", { zone: "t", id: "p", from: 0, to: 50, label: "x", tone: "azul" })).toBe(false);
    expect(error("add_span", { zone: "t", id: "p", from: 50, to: 50, label: "x" })).toMatch(/from must be less than to/);
    expect(ok("add_span", { zone: "t", id: "p", from: 60, to: 50, label: "x" })).toBe(false);
  });
  it("tree: add_branch", () => {
    expect(ok("add_branch", { zone: "t", id: "x", label: "L", parent: "p", note: "n" })).toBe(true);
  });
  it("connect needs two different ends", () => {
    expect(ok("connect", { id: "c", from: "a", to: "b", style: "dashed", both_ways: true })).toBe(true);
    expect(error("connect", { id: "c", from: "a", to: "a" })).toMatch(/source and target are the same/);
  });
});

describe("parseOp: catalogs", () => {
  const step = { zone: "z", id: "a", label: "A" };
  it("off: service is an extra key and set_service does not exist", () => {
    expect(error("add_step", { ...step, service: "lambda" })).toMatch(/service/);
    expect(error("set_service", { id: "a", service: "lambda" })).toContain("unknown");
  });
  it("AWS on: a known service, or empty in set_service to remove it", () => {
    const on = ["aws"];
    expect(ok("add_step", { ...step, service: "lambda" }, on)).toBe(true);
    expect(ok("add_component", { zone: "s", id: "c", label: "C", type: "service", service: "s3" }, on)).toBe(true);
    expect(ok("add_step", { ...step, service: "made-up" }, on)).toBe(false);
    expect(ok("add_step", { ...step, service: "" }, on)).toBe(false);
    expect(ok("add_node", { zone: "m", id: "n", label: "N", service: "lambda" }, on)).toBe(false);
    expect(ok("set_service", { id: "a", service: "s3" }, on)).toBe(true);
    expect(ok("set_service", { id: "a", service: "" }, on)).toBe(true);
    expect(ok("set_service", { id: "a", service: "made-up" }, on)).toBe(false);
  });
});
