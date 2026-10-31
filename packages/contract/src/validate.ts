import Ajv from "ajv";
import { toolsFor } from "./ops";

// Una sola fuente de verdad: las herramientas son OP_TOOLS (src/board/ops.ts); con un catálogo
// prendido, toolsFor(catalogs) les suma `service` y set_service. Una versión cacheada por conjunto.
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

/** Ordenados y sin repetir, para que {["aws"]} y {["aws","aws"]} compartan caché. */
export function normalizeCatalogs(catalogs: readonly string[]): string[] {
  return [...new Set(catalogs)].sort();
}

export function validateOp(name: string, input: unknown, catalogs: readonly string[] = []): string | null {
  const v = toolSetFor(catalogs).validators.get(name);
  if (!v) return `herramienta desconocida "${name}"`;
  if (!input || typeof input !== "object") return "entrada no es un objeto";
  if (!v(input)) {
    const e = v.errors?.[0];
    return `${e?.instancePath || "entrada"} ${e?.message ?? "inválida"}`;
  }
  return null;
}
