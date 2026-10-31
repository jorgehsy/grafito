import Ajv from "ajv";
import { toolsFor } from "./ops";

// Single source of truth: the tools are OP_TOOLS (src/ops.ts); with a catalog turned on,
// toolsFor(catalogs) adds `service` and set_service to them. One cached validator per set.
const ajv = new (Ajv as any)({ strict: false, allErrors: false });
const toolSets = new Map<string, { tools: any[]; validators: Map<string, any> }>();

export function toolSetFor(catalogs: readonly string[]) {
  const key = normalizeCatalogs(catalogs).join(",");
  let set = toolSets.get(key);
  if (!set) {
    const defs = toolsFor(catalogs);
    set = {
      tools: defs.map((t) => ({ ...t, eager_input_streaming: true })),
      validators: new Map<string, any>(defs.map((t) => [t.name, ajv.compile(t.input_schema)])),
    };
    toolSets.set(key, set);
  }
  return set;
}

/** Sorted and deduplicated, so ["aws"] and ["aws","aws"] share a cache entry. */
export function normalizeCatalogs(catalogs: readonly string[]): string[] {
  return [...new Set(catalogs)].sort();
}

export function validateOp(name: string, input: unknown, catalogs: readonly string[] = []): string | null {
  const v = toolSetFor(catalogs).validators.get(name);
  if (!v) return `unknown tool "${name}"`;
  if (!input || typeof input !== "object") return "input is not an object";
  if (!v(input)) {
    const e = v.errors?.[0];
    return `${e?.instancePath || "input"} ${e?.message ?? "invalid"}`;
  }
  return null;
}
