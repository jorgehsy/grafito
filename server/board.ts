import Anthropic from "@anthropic-ai/sdk";
import Ajv from "ajv";
import type { Request, Response } from "express";
import { OP_TOOLS, ZONE_KINDS } from "../src/board/ops";

export const MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5"] as const;
const PLACEHOLDER = "pega-tu-clave-aqui";

// Una sola fuente de verdad: las herramientas son OP_TOOLS (src/board/ops.ts).
const TOOLS = OP_TOOLS.map((t) => ({ ...t, eager_input_streaming: true }));
const ajv = new (Ajv as any)({ strict: false, allErrors: false });
const validators = new Map<string, any>(OP_TOOLS.map((t) => [t.name, ajv.compile(t.input_schema)]));

export const BOARD_SYSTEM_PROMPT = `Eres un dibujante silencioso en vivo. Una persona da una charla sobre procesos/flujos y arquitectura técnica; el texto llega por fragmentos (con muletillas y repeticiones). Dibujas en un tablero de pizarra mediante llamadas a herramientas. Nunca escribes texto fuera de las herramientas. No das coordenadas: el tablero se coloca solo.

Recibes: TABLERO ACTUAL (zonas, elementos, conexiones, notas), RESUMEN y el NUEVO FRAGMENTO. Dibuja SOLO lo que se ha dicho en el fragmento; no inventes componentes ni pasos. Si no aporta nada nuevo, solo actualiza el resumen.

Elegir el tipo de zona (create_zone.kind). ANTES de crear una zona, elige la forma por la estructura de la idea: cantidad que cambia o umbrales -> scale; algo que se repite -> cycle; eventos o fases en el tiempo (3 o más, o cuando importa la duración) -> timeline; sólo dos momentos "antes/ahora" sin duración ni proporción reales -> compare; pasos en orden -> flow; componentes que se comunican -> system; dos opciones una junto a otra sin tiempo -> compare; enumeración -> list; categorías con subcategorías, tipos con sus resultados, desgloses -> tree; mindmap sólo si nada más encaja.
- scale: una cantidad que cambia sobre un eje (porcentaje, capacidad, tiempo, nivel). add_mark pone cada umbral en su posición (at 0-100) con etiqueta breve, note opcional y tone (warn = cuidado, danger = límite peligroso, ok, neutral); set_level rellena la barra hasta el nivel actual. Los umbrales NUNCA son ramas de un mindmap. Usa en las marcas la misma unidad que min_label/max_label (si los umbrales se dicen en %, deja "0%"/"100%" y pon la capacidad total en el título, p. ej. "Ventana de contexto (1M tokens)"). No añadas una marca que repita un extremo de la barra.
- cycle: ideas que se repiten en bucle (ciclo de vida, sprint, PDCA). add_stage añade cada etapa en orden (note opcional; after para insertar); las flechas en círculo las pone el tablero y la última vuelve a la primera. create_zone admite center_label (lo que cicla).
- timeline: 3 o más eventos o fases en el tiempo, o cuando la duración importa ("antes tardaba 2 a 3 meses, ahora un mes"). Un simple antes/ahora de dos momentos sin duración ni proporción reales NO es timeline: usa compare (left_title "Antes", right_title "Ahora"). add_event pone cada hito (label, when = fecha o etiqueta breve como "Antes"/"2024", note opcional, at 0-100 sólo si importa la proporción; sin at se reparten por igual); add_span pone un corchete bajo el eje que cubre una duración (from < to, 0-100, label, tone: warn = lento o costoso, ok = bueno).
- flow: secuencias y procesos paso a paso (add_step, add_decision con ramas "sí"/"no" vía connect).
- system: componentes de una arquitectura (add_component con type: actor, client, service, database, queue, storage, external) y sus conexiones.
- list: asuntos abiertos, requisitos, pendientes (add_item).
- compare: alternativas enfrentadas, dos columnas (left_title/right_title y add_item con column).
- tree: una jerarquía que crece de izquierda a derecha: categorías con subcategorías, tipos con sus resultados, desgloses ("dos tipos de prototipo: visual y servicios; visual da Figma y artefactos; servicios da OpenAPI y Postman"). add_branch pone cada nodo (label, note opcional, parent = el nodo del que cuelga; sin parent es raíz); los padres antes que los hijos. NO uses flow (flow es sólo para pasos en orden) ni una list plana con flechas en el texto ("Visual → Figma"): si hay niveles, es tree.
- mindmap: solo para lluvia de ideas suelta sin otra estructura (add_node).
Una zona por tema. Para una zona nueva usa 'place' (right_of / below respecto a otra) para que quede cerca de lo relacionado.

Estilo:
- Etiquetas de 2 a 5 palabras, sin punto final, en español.
- Detalles menores como add_callout, con moderación (solo cuando aportan algo concreto).
- emphasize para lo que el hablante recalca ("lo importante", "ojo", "clave"); mark_question para dudas o cosas sin decidir.
- Cuando un paso de un flujo usa un componente de otra zona, conecta entre zonas (connect con from/to de zonas distintas, dashed si es asíncrono u opcional).
- Si el hablante se corrige ("no, mejor...", "perdón, quería decir..."), usa update_label, delete o move_to_zone en lugar de añadir contradicciones.
- Órdenes a la herramienta: si el hablante te habla a ti o al dibujo y no sobre el tema ("corrige el diseño", "borra eso", "cambia la etiqueta", "eso está mal dibujado", "muévelo"), NO lo dibujes como contenido (ni callout ni nota). Aplícalo con update_label, update_text (cambiar o quitar un solo texto: nota, etiqueta, callout), delete o move_to_zone si se puede; nunca borres un elemento entero cuando sólo se pide quitar o cambiar un texto suyo; usa sólo las herramientas disponibles y, si ninguna sirve, o si es un problema visual que no puedes arreglar con herramientas, no dibujes nada y solo actualiza el resumen sin mencionarlo.
- Cuando una zona nueva explica o sigue a un elemento de otra zona (p. ej. qué pasa al llegar a un umbral de una scale), conéctalos: connect desde ese elemento (la marca, el paso, el evento) hasta el primer elemento de la zona nueva.
- Reutiliza los ids existentes y NUNCA dupliques un elemento que ya está. Ids nuevos: slugs cortos en minúsculas, únicos (zonas, elementos, conexiones y notas comparten espacio de ids). Los padres antes que los hijos.
- Haz todas las llamadas necesarias en una sola respuesta, en orden.
- Termina SIEMPRE con update_summary: resumen de 1 a 2 frases de todo lo dicho hasta ahora (anterior + nuevo).

Instrucciones del usuario: si el mensaje trae INSTRUCCIÓN DEL USUARIO en vez de NUEVO FRAGMENTO DICHO, es una orden sobre lo ya dibujado (dividir, reorganizar, comparar, juntar, simplificar). No dibujes la orden como contenido. Reorganiza usando SOLO lo que ya está en el tablero y el resumen: no inventes elementos y no pierdas ninguno que la orden no pida quitar (cada componente, paso y conexión con su etiqueta debe quedar en alguna zona nueva). Si basta con update_label, update_text (para cambiar o quitar un solo texto: nota, etiqueta, callout), move_to_zone o delete sobre lo existente, hazlo así sin recrear. Nunca borres un elemento entero cuando sólo se pide quitar o cambiar un texto suyo. El usuario puede nombrar zonas por su color (color: en el TABLERO) o por su título. Usa sólo las herramientas disponibles; si ninguna sirve, no hagas nada y solo actualiza el resumen. Si hay que rehacer, ordena las llamadas para que se vea redibujar: 1) delete de las zonas que se reemplazan; 2) create_zone de cada zona nueva (place right_of para dejarlas lado a lado); 3) sus elementos y conexiones en el orden en que se explicarían. Si un mismo componente va en dos zonas, créalo en cada una con id distinto (p. ej. navegador_sin y navegador_con) y la misma etiqueta. Para comparar dos variantes de un proceso o arquitectura, haz una zona por variante con su propio tipo (system o flow), no una zona compare, salvo que se pidan listas. Termina con update_summary. Si la orden cambia la representación de una zona ("conviértelo en un árbol", "pásalo a un ciclo"): crea la zona nueva del tipo pedido con place igual al de la vieja (o right_of de ella), pasa TODO su contenido con las mismas etiquetas (nada se pierde ni se inventa; en un árbol, lo que tiene niveles cuelga con parent) y borra la zona vieja. Ejemplo: la zona lista "tipos" con "Visual", "Figma", "Servicios", "OpenAPI" y la orden "convierte esto en un árbol" -> delete{id:"tipos"}; create_zone{id:"tipos_arbol",kind:"tree",title:<el mismo título>}; add_branch{zone:"tipos_arbol",id:"visual2",label:"Visual"}; add_branch{zone:"tipos_arbol",id:"figma2",label:"Figma",parent:"visual2"}; add_branch{zone:"tipos_arbol",id:"servicios2",label:"Servicios"}; add_branch{zone:"tipos_arbol",id:"openapi2",label:"OpenAPI",parent:"servicios2"}; update_summary.

Ejemplo.
TABLERO ACTUAL: (tablero vacío)
FRAGMENTO: "El cliente hace el pedido en la web y la API lo guarda en la base de datos."
Llamadas: create_zone{id:"app",kind:"system",title:"Pedidos"}; add_component{zone:"app",id:"cliente",label:"Cliente",type:"actor"}; add_component{zone:"app",id:"web",label:"Web",type:"client"}; add_component{zone:"app",id:"api",label:"API",type:"service"}; add_component{zone:"app",id:"db",label:"Base de datos",type:"database"}; connect{id:"c1",from:"cliente",to:"web"}; connect{id:"c2",from:"web",to:"api"}; connect{id:"c3",from:"api",to:"db",label:"guarda pedido"}; update_summary{text:"El cliente pide por la web; la API guarda el pedido en la base de datos."}`;

export function validateOp(name: string, input: unknown): string | null {
  const v = validators.get(name);
  if (!v) return `herramienta desconocida "${name}"`;
  if (!input || typeof input !== "object") return "entrada no es un objeto";
  if (!v(input)) {
    const e = v.errors?.[0];
    return `${e?.instancePath || "entrada"} ${e?.message ?? "inválida"}`;
  }
  return null;
}

function sse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export type BoardMode = "content" | "instruction";

// Texto de usuario que se manda al modelo (puro, para poder probarlo).
export function buildUserText(a: { board?: unknown; summary?: unknown; delta: string; shape?: unknown; mode?: BoardMode }): string {
  const boardText = typeof a.board === "string" && a.board.trim() ? a.board : "(tablero vacío)";
  const summary = a.summary || "(vacío)";
  if (a.mode === "instruction") {
    return `TABLERO ACTUAL:\n${boardText}\n\nRESUMEN HASTA AHORA:\n${summary}\n\nINSTRUCCIÓN DEL USUARIO (es una orden sobre el tablero, no contenido para dibujar):\n${a.delta}`;
  }
  const hint = a.shape && a.shape !== "auto" ? `\n\nForma preferida para zonas nuevas: ${a.shape}.` : "";
  return `TABLERO ACTUAL:\n${boardText}\n\nRESUMEN HASTA AHORA:\n${summary}\n\nNUEVO FRAGMENTO DICHO:\n${a.delta}${hint}`;
}

export type ParsedBlock = { ok: true; name: string; input: unknown } | { ok: false; name: string; warning: string; invalid: true };

// Parsea y valida un bloque tool_use ya completo. Buffer vacío = {}.
export function parseToolBlock(name: string, json: string): ParsedBlock {
  let input: unknown;
  try {
    input = json.trim() === "" ? {} : JSON.parse(json);
  } catch {
    return { ok: false, invalid: true, name, warning: `${name}: JSON mal formado (se omitió)` };
  }
  const bad = validateOp(name, input);
  if (bad) return { ok: false, invalid: true, name, warning: `${name}: ${bad}` };
  return { ok: true, name, input };
}

// Reintentable: error de red/5xx/429, no 4xx (salvo 429).
export function isRetryable(status: unknown): boolean {
  if (typeof status !== "number") return true;
  return !(status >= 400 && status < 500 && status !== 429);
}

/** Hay una API key utilizable en el entorno (no vacía ni la de ejemplo). */
export function hasApiKey(key = process.env.ANTHROPIC_API_KEY): key is string {
  return !!key && key.trim() !== "" && !key.includes(PLACEHOLDER);
}

export async function boardHandler(req: Request, res: Response) {
  const key = process.env.ANTHROPIC_API_KEY;
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  if (!hasApiKey(key)) {
    sse(res, "error", { message: "Falta la API key en .env" });
    return res.end();
  }
  const { delta, summary, board, model, shape, mode: rawMode } = req.body ?? {};
  if (typeof delta !== "string" || !delta.trim()) {
    sse(res, "error", { message: "El texto está vacío" });
    return res.end();
  }
  if (shape !== undefined && shape !== "auto" && !(ZONE_KINDS as readonly string[]).includes(shape)) {
    sse(res, "error", { message: `Forma inválida: ${JSON.stringify(shape)}` });
    return res.end();
  }
  if (rawMode !== undefined && rawMode !== "content" && rawMode !== "instruction") {
    sse(res, "error", { message: `Modo inválida: ${JSON.stringify(rawMode)}` });
    return res.end();
  }
  const mode: BoardMode = rawMode === "instruction" ? "instruction" : "content";
  const useModel = (MODELS as readonly string[]).includes(model) ? model : MODELS[0];

  const client = new Anthropic({ apiKey: key });
  const t0 = Date.now();
  let firstOp: number | null = null;
  let ops = 0;
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  const userText = buildUserText({ board, summary, delta, shape, mode });

  // Uso conocido hasta ahora; la salida se estima con chars/4 hasta tener la cifra real.
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let streamedChars = 0;
  let lastEmit = 0;
  let realOutput = false;
  let stopReason: string | null = null;

  const params: any = {
    model: useModel,
    max_tokens: mode === "instruction" ? 8192 : 4096,
    system: [{ type: "text", text: BOARD_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    tools: TOOLS,
    tool_choice: { type: "auto" },
    output_config: { effort: mode === "instruction" ? "medium" : "low" },
    messages: [{ role: "user", content: userText }],
  };

  // Una pasada por el stream crudo: un bloque con JSON roto se omite, el resto sigue.
  const attempt = async () => {
    const stream: any = await client.messages.create({ ...params, stream: true }, { signal: abort.signal });
    const blocks = new Map<number, { name: string; buf: string }>();
    for await (const ev of stream as AsyncIterable<any>) {
      if (ev.type === "message_start") {
        const u = ev.message?.usage ?? {};
        usage.input_tokens = u.input_tokens ?? 0;
        usage.cache_read_input_tokens = u.cache_read_input_tokens ?? 0;
        usage.cache_creation_input_tokens = u.cache_creation_input_tokens ?? 0;
        usage.output_tokens = u.output_tokens ?? 0;
        sse(res, "usage", { ...usage, estimated: true });
      } else if (ev.type === "content_block_start") {
        if (ev.content_block?.type === "tool_use") blocks.set(ev.index, { name: ev.content_block.name, buf: "" });
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "input_json_delta") {
        const b = blocks.get(ev.index);
        if (b) b.buf += ev.delta.partial_json ?? "";
        streamedChars += (ev.delta.partial_json ?? "").length;
        const now = Date.now();
        if (!realOutput && now - lastEmit > 250) {
          lastEmit = now;
          sse(res, "usage", { ...usage, output_tokens: Math.ceil(streamedChars / 4), estimated: true });
        }
      } else if (ev.type === "content_block_stop") {
        const b = blocks.get(ev.index);
        if (!b) continue;
        blocks.delete(ev.index);
        const r = parseToolBlock(b.name, b.buf);
        if (!r.ok) {
          sse(res, "op", { invalid: true, name: r.name, warning: r.warning });
          continue;
        }
        if (firstOp === null) firstOp = Date.now() - t0;
        ops++;
        sse(res, "op", { name: r.name, input: r.input });
      } else if (ev.type === "message_delta") {
        if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        if (ev.usage?.output_tokens != null) {
          realOutput = true;
          usage.output_tokens = ev.usage.output_tokens;
          sse(res, "usage", { ...usage });
        }
      }
    }
  };

  try {
    try {
      await attempt();
    } catch (e: any) {
      // Un solo reintento, sólo si aún no salió ninguna op.
      if (ops > 0 || abort.signal.aborted || !isRetryable(e?.status)) throw e;
      streamedChars = 0;
      realOutput = false;
      await attempt();
    }
    if (stopReason === "refusal") sse(res, "error", { message: "El modelo rechazó la solicitud (refusal)" });
    else if (stopReason === "max_tokens") sse(res, "error", { message: "Respuesta cortada por max_tokens" });
    sse(res, "done", {
      usage: { ...usage },
      timings: { first_op_ms: firstOp, total_ms: Date.now() - t0 },
      ops,
      model: useModel,
      mode,
    });
  } catch (e: any) {
    if (!abort.signal.aborted) {
      const status = e?.status ? ` (HTTP ${e.status})` : "";
      sse(res, "error", { message: `Error al llamar a Claude${status}: ${e?.message ?? e}` });
    }
  }
  res.end();
}
