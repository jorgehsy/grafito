// The two borders of an op: what Claude is shown (toolDefs) and what is accepted back (parseOp).
// Both come from the same schemas in ops.ts, one cached set per catalog combination.
import { z } from "zod";
import { catalogServiceIds } from "@grafito/icons";
import { inputSchemas, type Op, type OpName } from "./ops";

/** Sorted and deduplicated, so ["a"] and ["a","a"] share a cache entry. */
export function normalizeCatalogs(catalogs: readonly string[]): string[] {
  return [...new Set(catalogs)].sort();
}

/** An Anthropic tool definition, as sent to the API. */
export interface ToolDef {
  name: OpName;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
  eager_input_streaming: true;
}

export type ParsedOp = { ok: true; op: Op } | { ok: false; error: string };

interface CatalogSet {
  tools: ToolDef[];
  schemas: Map<string, z.ZodType>;
}
const sets = new Map<string, CatalogSet>();

function setFor(catalogs: readonly string[]): CatalogSet {
  const key = normalizeCatalogs(catalogs).join(",");
  let set = sets.get(key);
  if (!set) {
    const serviceIds = catalogServiceIds(catalogs);
    const defs = inputSchemas(serviceIds);
    set = {
      tools: defs.map((d) => ({
        name: d.name,
        description: d.description,
        input_schema: toToolSchema(d.schema) as ToolDef["input_schema"],
        eager_input_streaming: true,
      })),
      schemas: new Map(defs.map((d) => [d.name, d.schema])),
    };
    sets.set(key, set);
  }
  return set;
}

/**
 * JSON Schema for one input, in the exact bytes Claude has always been sent:
 * no `$schema`, and in object schemas `description` right after `type`.
 * (Zod puts an object's description last; every other key order already matches.)
 */
function toToolSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
  return tidy(json) as Record<string, unknown>;
}

function tidy(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(tidy);
  if (!node || typeof node !== "object") return node;
  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const objectWithDescription = src.type === "object" && "description" in src;
  for (const [k, v] of Object.entries(src)) {
    if (objectWithDescription && k === "description") continue;
    out[k] = k === "properties" ? Object.fromEntries(Object.entries(v as object).map(([p, s]) => [p, tidy(s)])) : tidy(v);
    if (objectWithDescription && k === "type") out.description = src.description;
  }
  return out;
}

/** The tools Claude is offered for these catalogs (catalogs off = `[]`). */
export function toolDefs(catalogs: readonly string[]): ToolDef[] {
  return setFor(catalogs).tools;
}

/**
 * Checks that `x` is a valid op for these catalogs: `{name, input}` with a known name and an input
 * matching that tool's schema. The error starts with the op name, ready to show as a warning.
 */
export function parseOp(x: unknown, catalogs: readonly string[]): ParsedOp {
  if (!x || typeof x !== "object") return { ok: false, error: "?: malformed operation" };
  const { name, input } = x as { name?: unknown; input?: unknown };
  if (typeof name !== "string") return { ok: false, error: "?: malformed operation" };
  const schema = setFor(catalogs).schemas.get(name);
  if (!schema) return { ok: false, error: `${name}: unknown tool "${name}"` };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: `${name}: input is not an object` };
  const r = schema.safeParse(input);
  if (!r.success) {
    const issue = r.error.issues[0];
    const path = issue.path.length ? ` (at /${issue.path.join("/")})` : "";
    return { ok: false, error: `${name}: ${issue.message}${path}` };
  }
  // The schema registered under `name` just accepted `input`, so the pair is that op.
  return { ok: true, op: checked<Op>({ name, input: r.data }) };
}

const checked = <T>(v: unknown): T => v as T;
