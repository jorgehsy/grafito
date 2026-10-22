import Anthropic from "@anthropic-ai/sdk";
import type { Request, Response } from "express";

export const MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"] as const;
const PLACEHOLDER = "pega-tu-clave-aqui";

// Herramientas semánticas (sin coordenadas). eager_input_streaming: los argumentos
// llegan a medida que se generan (GA, sin cabecera beta). Se validan en cliente abajo.
const str = (description: string) => ({ type: "string", description });
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[]) => ({
  name,
  description,
  eager_input_streaming: true,
  input_schema: { type: "object", properties, required, additionalProperties: false },
});

export const TOOLS = [
  tool("set_root", "Define o renombra el tema central del mapa.", { label: str("Tema central, 2-5 palabras") }, ["label"]),
  tool(
    "add_node",
    "Añade una idea clave como hijo de otro nodo.",
    { id: str("slug corto único, p. ej. 'precios'"), parent_id: str("id del padre; la raíz es 'root'"), label: str("2-5 palabras") },
    ["id", "parent_id", "label"],
  ),
  tool("update_node", "Cambia la etiqueta de un nodo existente.", { id: str("id existente"), label: str("nueva etiqueta") }, ["id", "label"]),
  tool("move_node", "Mueve un nodo (con su subárbol) bajo otro padre.", { id: str("id existente"), new_parent_id: str("id del nuevo padre") }, ["id", "new_parent_id"]),
  tool("delete_node", "Borra un nodo y todo su subárbol.", { id: str("id existente") }, ["id"]),
  tool("add_note", "Añade un detalle breve como nota adhesiva de un nodo.", { node_id: str("id existente"), text: str("detalle corto (cifras, ejemplos)") }, ["node_id", "text"]),
  tool(
    "add_link",
    "Enlace transversal entre dos nodos no padre-hijo.",
    { from_id: str("id origen"), to_id: str("id destino"), label: str("relación, 1-3 palabras (opcional)") },
    ["from_id", "to_id"],
  ),
  tool("update_summary", "Resumen acumulado de TODO lo dicho hasta ahora (1-3 frases). Llámala siempre al final.", { text: str("resumen") }, ["text"]),
];

const REQUIRED: Record<string, string[]> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t.input_schema.required as string[]]),
);

export const SYSTEM_PROMPT = `Eres un tomador de notas en vivo. Escuchas a una persona hablar (el texto llega por fragmentos, a veces con muletillas y repeticiones) y vas dibujando un MAPA MENTAL de lo que dice, mediante llamadas a herramientas.

Reglas:
- Todas las etiquetas y notas en español. Etiquetas de 2 a 5 palabras, sin puntuación final.
- Solo ideas clave en nodos. Cifras, ejemplos y detalles van como notas (add_note), breves.
- Estructura: un tema central (set_root), ramas de primer nivel por tema grande, sub-ideas debajo. Evita ramas con un solo hijo salvo que sea necesario y no pases de 4 niveles.
- Reutiliza los ids existentes. NUNCA dupliques un nodo que ya existe: si la idea ya está, usa update_node o add_note.
- Los ids son slugs cortos en minúsculas sin espacios (p. ej. "precios", "cafe-origen"). La raíz siempre tiene id "root". Si el mapa está vacío, empieza con set_root.
- Si el hablante se corrige ("no, mejor...", "en realidad...", "olvida lo de..."), reorganiza: update_node, move_node o delete_node en lugar de añadir contradicciones.
- Usa add_link solo para relaciones transversales claras entre ramas distintas.
- Haz todas las llamadas necesarias en una sola respuesta, en orden (los padres antes que los hijos). Si el fragmento no aporta ideas nuevas, no dibujes nada nuevo.
- Termina SIEMPRE con update_summary: resumen de 1 a 3 frases de todo lo dicho hasta ahora (anterior + nuevo).
- No escribas texto fuera de las llamadas a herramientas.`;

function validate(name: string, input: unknown): string | null {
  const req = REQUIRED[name];
  if (!req) return `herramienta desconocida "${name}"`;
  if (!input || typeof input !== "object") return "entrada no es un objeto";
  for (const k of req) {
    const v = (input as Record<string, unknown>)[k];
    if (typeof v !== "string" || !v.trim()) return `falta "${k}"`;
  }
  return null;
}

function sse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function drawHandler(req: Request, res: Response) {
  const key = process.env.ANTHROPIC_API_KEY;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  if (!key || key.trim() === "" || key.includes(PLACEHOLDER)) {
    sse(res, "error", { message: "Falta la API key en .env" });
    res.end();
    return;
  }

  const { delta, summary, map, model } = req.body ?? {};
  if (typeof delta !== "string" || !delta.trim()) {
    sse(res, "error", { message: "El texto está vacío" });
    return res.end();
  }
  const useModel = (MODELS as readonly string[]).includes(model) ? model : MODELS[0];

  const client = new Anthropic({ apiKey: key });
  const t0 = Date.now();
  let firstOp: number | null = null;
  let ops = 0;
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  const userText = `MAPA ACTUAL (JSON):\n${JSON.stringify(map ?? { rootId: null, nodes: {}, links: [] })}\n\nRESUMEN HASTA AHORA:\n${summary || "(vacío)"}\n\nNUEVO FRAGMENTO DICHO:\n${delta}`;

  try {
    // Prefijo estable (tools + system) con cache_control; lo variable va en el mensaje.
    const params: any = {
      model: useModel,
      max_tokens: 4096,
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      tool_choice: { type: "auto" },
      output_config: { effort: "low" },
      messages: [{ role: "user", content: userText }],
    };
    const stream = client.messages.stream(params, { signal: abort.signal });

    // 'contentBlock' se emite cuando cada bloque termina: una op por tool_use completo.
    stream.on("contentBlock", (block: any) => {
      if (block?.type !== "tool_use") return;
      const bad = validate(block.name, block.input);
      if (bad) {
        sse(res, "op", { invalid: true, name: block.name, warning: `${block.name}: ${bad}` });
        return;
      }
      if (firstOp === null) firstOp = Date.now() - t0;
      ops++;
      sse(res, "op", { name: block.name, input: block.input });
    });
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") sse(res, "error", { message: "El modelo rechazó la solicitud (refusal)" });
    else if (final.stop_reason === "max_tokens") sse(res, "error", { message: "Respuesta cortada por max_tokens" });
    const u: any = final.usage;
    sse(res, "done", {
      usage: {
        input_tokens: u.input_tokens,
        output_tokens: u.output_tokens,
        cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      },
      timings: { first_op_ms: firstOp, total_ms: Date.now() - t0 },
      ops,
      model: useModel,
    });
  } catch (e: any) {
    if (!abort.signal.aborted) {
      const status = e?.status ? ` (HTTP ${e.status})` : "";
      sse(res, "error", { message: `Error al llamar a Claude${status}: ${e?.message ?? e}` });
    }
  }
  res.end();
}
