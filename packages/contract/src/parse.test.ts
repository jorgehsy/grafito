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

describe("toolDefs: the architect op set", () => {
  it("architect, catalogs off", async () => {
    await expect(JSON.stringify(toolDefs([], "architect"), null, 2) + "\n").toMatchFileSnapshot("./__snapshots__/tools.architect.off.json");
  });
  it("architect, AWS catalog on", async () => {
    await expect(JSON.stringify(toolDefs(["aws"], "architect"), null, 2) + "\n").toMatchFileSnapshot("./__snapshots__/tools.architect.aws.json");
  });
  it("keeps the component, connection, label, delete and summary ops, adds say, the group and proposal ops, and drops every zone op", () => {
    const own = ["say", "add_group", "set_parent", "propose", "accept", "reject"];
    expect(toolDefs([], "architect").map((t) => t.name)).toEqual(["add_component", "connect", "update_label", "delete", ...own, "update_summary"]);
    expect(toolDefs(["aws"], "architect").map((t) => t.name)).toEqual(["add_component", "connect", "update_label", "delete", ...own, "set_service", "update_summary"]);
  });
  it("kept ops have the board set's inputs; add_component also takes a parent group, the drawing ops a proposal", () => {
    const board = new Map(toolDefs(["aws"]).map((t) => [t.name, t]));
    const proposal = { type: "string", minLength: 1, description: expect.stringContaining("pencil") };
    for (const t of toolDefs(["aws"], "architect")) {
      const b = board.get(t.name);
      if (!b) continue;
      if (t.name === "add_component") {
        const { parent, proposal: p, ...rest } = t.input_schema.properties;
        expect(parent).toEqual({ type: "string", minLength: 1, description: expect.stringContaining("group") });
        expect(p).toEqual(proposal);
        expect({ ...t.input_schema, properties: rest }).toEqual(b.input_schema);
      } else if (t.name === "connect") {
        const { proposal: p, ...rest } = t.input_schema.properties;
        expect(p).toEqual(proposal);
        expect({ ...t.input_schema, properties: rest }).toEqual(b.input_schema);
      } else expect(t.input_schema).toEqual(b.input_schema);
    }
    expect(board.get("add_component")!.input_schema.properties).not.toHaveProperty("parent");
    expect(board.get("connect")!.input_schema.properties).not.toHaveProperty("proposal");
  });
  it("proposals only add: only add_component, add_group and connect take a proposal", () => {
    const withProposal = toolDefs(["aws"], "architect").filter((t) => "proposal" in t.input_schema.properties).map((t) => t.name);
    expect(withProposal).toEqual(["add_component", "connect", "add_group", "accept", "reject"]);
    for (const name of ["accept", "reject"]) expect(toolDefs(["aws"], "architect").find((t) => t.name === name)!.input_schema.required).toEqual(["proposal"]);
  });
  it("the board set never shows architect ops and stays the default", () => {
    for (const name of ["say", "add_group", "set_parent", "propose", "accept", "reject"]) expect(toolDefs(["aws"]).map((t) => t.name)).not.toContain(name);
    expect(toolDefs([], "board")).toBe(toolDefs([]));
    expect(toolDefs([], "architect")).toBe(toolDefs([], "architect"));
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

describe("parseOp: op sets", () => {
  const arch = (name: string, input: unknown, catalogs: readonly string[] = []) => parseOp({ name, input }, catalogs, "architect");
  it("say: text required, target optional, nothing else", () => {
    expect(arch("say", { text: "How do users sign in?" })).toEqual({ ok: true, op: { name: "say", input: { text: "How do users sign in?" } } });
    expect(arch("say", { text: "Done.", target: "bucket" }).ok).toBe(true);
    expect(arch("say", { text: " " }).ok).toBe(false);
    expect(arch("say", {}).ok).toBe(false);
    expect(arch("say", { text: "x", target: "" }).ok).toBe(false);
    expect(arch("say", { text: "x", tone: "loud" }).ok).toBe(false);
  });
  it("say is unknown in live mode; zone ops are unknown in architect mode", () => {
    expect(error("say", { text: "hi" })).toBe('say: unknown tool "say"');
    for (const name of ["create_zone", "add_step", "move_to_zone", "add_callout", "mark_question"]) {
      const r = arch(name, {});
      expect(r.ok ? null : r.error).toBe(`${name}: unknown tool "${name}"`);
    }
  });
  it("add_group: id, a known kind and a label; parent optional", () => {
    expect(arch("add_group", { id: "vpc", kind: "vpc", label: "VPC" })).toEqual({ ok: true, op: { name: "add_group", input: { id: "vpc", kind: "vpc", label: "VPC" } } });
    for (const kind of ["aws_cloud", "region", "vpc", "availability_zone", "public_subnet", "private_subnet", "generic"])
      expect(arch("add_group", { id: "g", kind, label: "G", parent: "vpc" }).ok).toBe(true);
    expect(error("add_group", { id: "g", kind: "vpc", label: "G" })).toBe('add_group: unknown tool "add_group"');
    const r = arch("add_group", { id: "g", kind: "security_group", label: "SG" });
    expect(r.ok ? null : r.error).toMatch(/^add_group: .*\(at \/kind\)$/);
    expect(arch("add_group", { id: "g", kind: "vpc", label: " " }).ok).toBe(false);
    expect(arch("add_group", { id: "g", kind: "vpc", label: "G", parent: "" }).ok).toBe(false);
    expect(arch("add_group", { id: "g", kind: "vpc", label: "G", zone: "system" }).ok).toBe(false);
  });
  it("set_parent: a group id or null, never missing or blank", () => {
    expect(arch("set_parent", { id: "db", parent: "az1" }).ok).toBe(true);
    expect(arch("set_parent", { id: "db", parent: null })).toEqual({ ok: true, op: { name: "set_parent", input: { id: "db", parent: null } } });
    expect(arch("set_parent", { id: "db" }).ok).toBe(false);
    expect(arch("set_parent", { id: "db", parent: " " }).ok).toBe(false);
    expect(arch("set_parent", { id: "", parent: null }).ok).toBe(false);
    expect(error("set_parent", { id: "db", parent: null })).toBe('set_parent: unknown tool "set_parent"');
  });
  it("add_component takes a parent group only in architect mode", () => {
    expect(arch("add_component", { zone: "system", id: "db", label: "DB", type: "database", parent: "az1" }).ok).toBe(true);
    expect(arch("add_component", { zone: "system", id: "db", label: "DB", type: "database", parent: "" }).ok).toBe(false);
    expect(ok("add_component", { zone: "system", id: "db", label: "DB", type: "database", parent: "az1" })).toBe(false);
  });
  it("propose: id and label, alternative_to optional", () => {
    expect(arch("propose", { id: "P1", label: "Static site" })).toEqual({ ok: true, op: { name: "propose", input: { id: "P1", label: "Static site" } } });
    expect(arch("propose", { id: "P2", label: "DynamoDB", alternative_to: "P1" }).ok).toBe(true);
    expect(arch("propose", { id: "P1" }).ok).toBe(false);
    expect(arch("propose", { id: "P1", label: " " }).ok).toBe(false);
    expect(arch("propose", { id: "P2", label: "X", alternative_to: "" }).ok).toBe(false);
    expect(error("propose", { id: "P1", label: "Static site" })).toBe('propose: unknown tool "propose"');
  });
  it("accept and reject name one proposal", () => {
    for (const name of ["accept", "reject"]) {
      expect(arch(name, { proposal: "P1" })).toEqual({ ok: true, op: { name, input: { proposal: "P1" } } });
      expect(arch(name, {}).ok).toBe(false);
      expect(arch(name, { proposal: "" }).ok).toBe(false);
      expect(arch(name, { proposal: "P1", id: "x" }).ok).toBe(false);
      expect(error(name, { proposal: "P1" })).toBe(`${name}: unknown tool "${name}"`);
    }
  });
  it("the drawing ops take a proposal only in architect mode; changes and deletes never do", () => {
    const comp = { zone: "system", id: "cdn", label: "CDN", type: "service", proposal: "P1" };
    expect(arch("add_component", comp).ok).toBe(true);
    expect(arch("add_group", { id: "vpc", kind: "vpc", label: "VPC", proposal: "P1" }).ok).toBe(true);
    expect(arch("connect", { id: "c1", from: "a", to: "b", proposal: "P1" }).ok).toBe(true);
    expect(arch("connect", { id: "c1", from: "a", to: "a", proposal: "P1" }).ok).toBe(false);
    expect(arch("connect", { id: "c1", from: "a", to: "b", proposal: "" }).ok).toBe(false);
    expect(ok("add_component", comp)).toBe(false);
    expect(ok("connect", { id: "c1", from: "a", to: "b", proposal: "P1" })).toBe(false);
    for (const [name, input] of [["delete", { id: "a" }], ["update_label", { id: "a", label: "A" }], ["set_parent", { id: "a", parent: null }]] as const)
      expect(arch(name, { ...input, proposal: "P1" }).ok).toBe(false);
    expect(arch("set_service", { id: "a", service: "s3", proposal: "P1" }, ["aws"]).ok).toBe(false);
  });
  it("kept ops validate as in live mode; set_service only with a catalog on", () => {
    expect(arch("add_component", { zone: "system", id: "b", label: "Bucket", type: "storage", service: "s3" }, ["aws"]).ok).toBe(true);
    expect(arch("add_component", { zone: "system", id: "b", label: "Bucket", type: "storage", service: "s3" }).ok).toBe(false);
    expect(arch("set_service", { id: "b", service: "s3" }, ["aws"]).ok).toBe(true);
    expect(arch("set_service", { id: "b", service: "s3" }).ok).toBe(false);
    expect(arch("update_summary", { text: "An S3 bucket." }).ok).toBe(true);
  });
});
