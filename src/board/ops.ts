// Vocabulario de operaciones: fuente única de verdad.
// Tipos TS + un JSON Schema por operación, con forma de herramienta de Anthropic
// ({name, description, input_schema}) para reutilizarlas tal cual en el servidor.
// Ninguna operación lleva coordenadas.
import { AWS_PREFIJO_CATALOGO, SERVICIOS_AWS } from "../iconos/aws/servicios";

export type ZoneKind = "flow" | "system" | "list" | "compare" | "mindmap" | "scale" | "cycle" | "timeline" | "tree";
export type MarkTone = "neutral" | "warn" | "danger" | "ok";
export type ComponentType = "actor" | "client" | "service" | "database" | "queue" | "storage" | "external";
export type EmphasisStyle = "circle" | "underline" | "star";

export interface OpInputs {
  create_zone: {
    id: string;
    kind: ZoneKind;
    title: string;
    left_title?: string;
    right_title?: string;
    min_label?: string;
    max_label?: string;
    center_label?: string;
    place?: { relation: "right_of" | "below"; of: string };
  };
  add_step: { zone: string; id: string; label: string; icon?: string; service?: string; after?: string };
  add_decision: { zone: string; id: string; question: string; service?: string; after?: string };
  add_component: { zone: string; id: string; label: string; type: ComponentType; icon?: string; service?: string };
  add_node: { zone: string; id: string; label: string; parent?: string };
  add_item: { zone: string; id: string; text: string; column?: "left" | "right" };
  add_branch: { zone: string; id: string; label: string; parent?: string; note?: string };
  add_mark: { zone: string; id: string; at: number; label: string; note?: string; tone?: MarkTone };
  add_stage: { zone: string; id: string; label: string; note?: string; after?: string };
  add_event: { zone: string; id: string; label: string; when?: string; note?: string; at?: number };
  add_span: { zone: string; id: string; from: number; to: number; label: string; tone?: MarkTone };
  set_level: { zone: string; at: number; label?: string };
  connect: { id: string; from: string; to: string; label?: string; style?: "solid" | "dashed"; both_ways?: boolean };
  emphasize: { target: string; style: EmphasisStyle };
  mark_question: { target: string; text?: string };
  add_callout: { id: string; target: string; text: string };
  update_label: { id: string; label: string };
  update_text: { id: string; field: TextField; value: string };
  delete: { id: string };
  move_to_zone: { id: string; zone: string };
  /** Icono de servicio de cualquier elemento; `service` vacío lo quita. */
  set_service: { id: string; service: string };
  update_summary: { text: string };
}

export type TextField = "label" | "note" | "text" | "when";
export type OpName = keyof OpInputs;
export type Op = { [K in OpName]: { name: K; input: OpInputs[K] } }[OpName];

type OpBuilders = { [K in OpName]: (input: OpInputs[K]) => { name: K; input: OpInputs[K] } };
/** Constructores tipados: op.add_step({...}) -> {name:"add_step", input:{...}} */
export const op = new Proxy({} as OpBuilders, {
  get: (_t, name: string) => (input: unknown) => ({ name, input }),
});

export interface ToolDef {
  name: OpName;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties: false };
}

const str = (description: string) => ({ type: "string", description });
const id = (description: string) => ({ type: "string", minLength: 1, description });

function tool(name: OpName, description: string, properties: Record<string, unknown>, required: string[]): ToolDef {
  return { name, description, input_schema: { type: "object", properties, required, additionalProperties: false } };
}

export const TEXT_FIELDS: TextField[] = ["label", "note", "text", "when"];
export const ZONE_KINDS: ZoneKind[] = ["flow", "system", "list", "compare", "mindmap", "scale", "cycle", "timeline", "tree"];
export const MARK_TONES: MarkTone[] = ["neutral", "warn", "danger", "ok"];
const COMP_TYPES: ComponentType[] = ["actor", "client", "service", "database", "queue", "storage", "external"];

export const OP_TOOLS: ToolDef[] = [
  tool(
    "create_zone",
    "Crea una zona (un recuadro temático) en el tablero. Úsala cuando el hablante empieza un tema nuevo. kind: flow = proceso paso a paso; system = arquitectura de componentes; list = lista de puntos; compare = dos columnas comparadas; mindmap = ideas ramificadas; scale = una cantidad que cambia sobre un eje (barra con umbrales: porcentaje, capacidad, tiempo, nivel); cycle = algo que se repite en bucle; timeline = eventos o fases en el tiempo, antes/ahora; tree = una jerarquía o clasificación que crece de izquierda a derecha (categorías con subcategorías, tipos con sus resultados, desgloses). No se dan coordenadas: el tablero coloca la zona. 'place' sólo para pedir vecindad.",
    {
      id: id("Identificador único y estable, p. ej. 'proceso_pedido'."),
      kind: { type: "string", enum: ZONE_KINDS },
      title: str("Título corto de la zona."),
      left_title: str("Sólo compare: título de la columna izquierda."),
      right_title: str("Sólo compare: título de la columna derecha."),
      min_label: str("Sólo scale: etiqueta del extremo izquierdo de la barra (por defecto '0%')."),
      max_label: str("Sólo scale: etiqueta del extremo derecho de la barra (por defecto '100%')."),
      center_label: str("Sólo cycle: texto del centro del ciclo, lo que cicla (p. ej. 'Ventana de contexto')."),
      place: {
        type: "object",
        description: "Pista opcional de colocación respecto a otra zona.",
        properties: { relation: { type: "string", enum: ["right_of", "below"] }, of: id("Id de la zona de referencia.") },
        required: ["relation", "of"],
        additionalProperties: false,
      },
    },
    ["id", "kind", "title"],
  ),
  tool(
    "add_step",
    "Añade un paso (rectángulo) a una zona flow. 'after' conecta automáticamente con el paso anterior.",
    {
      zone: id("Id de una zona flow."),
      id: id("Identificador único."),
      label: str("Texto breve del paso (2 a 6 palabras)."),
      icon: str("Emoji opcional."),
      after: id("Id del elemento previo al que sigue (dibuja la flecha)."),
    },
    ["zone", "id", "label"],
  ),
  tool(
    "add_decision",
    "Añade una decisión (rombo) a una zona flow. Las ramas se conectan después con connect y una etiqueta ('sí', 'no').",
    {
      zone: id("Id de una zona flow."),
      id: id("Identificador único."),
      question: str("Pregunta breve, p. ej. '¿Hay stock?'."),
      after: id("Id del elemento previo."),
    },
    ["zone", "id", "question"],
  ),
  tool(
    "add_component",
    "Añade un componente a una zona system. type: actor = persona (muñeco); client = navegador o móvil; service = caja de servicio; database = cilindro; queue = cola o tubería; storage = bucket o carpeta; external = nube punteada de un tercero.",
    {
      zone: id("Id de una zona system."),
      id: id("Identificador único."),
      label: str("Nombre breve."),
      type: { type: "string", enum: COMP_TYPES },
      icon: str("Emoji opcional."),
    },
    ["zone", "id", "label", "type"],
  ),
  tool(
    "add_node",
    "Añade una idea a una zona mindmap. Sin 'parent' es la idea central (o cuelga de ella).",
    { zone: id("Id de una zona mindmap."), id: id("Identificador único."), label: str("Idea breve."), parent: id("Id del nodo padre.") },
    ["zone", "id", "label"],
  ),
  tool(
    "add_item",
    "Añade un punto a una zona list o compare. En compare, 'column' elige la columna.",
    {
      zone: id("Id de una zona list o compare."),
      id: id("Identificador único."),
      text: str("Texto del punto."),
      column: { type: "string", enum: ["left", "right"] },
    },
    ["zone", "id", "text"],
  ),
  tool(
    "add_branch",
    "Añade un nodo a una zona tree: una caja en la jerarquía. Sin 'parent' es una raíz (varias raíces se apilan); con 'parent' cuelga de ese nodo, en una columna a su derecha. Los hermanos se apilan en el orden en que se añaden y el tablero dibuja los conectores. Los padres antes que los hijos.",
    {
      zone: id("Id de una zona tree."),
      id: id("Identificador único."),
      label: str("Nombre breve del nodo (1 a 4 palabras)."),
      parent: id("Id del nodo padre (opcional; sin él es raíz)."),
      note: str("Explicación corta debajo de la etiqueta (opcional)."),
    },
    ["zone", "id", "label"],
  ),
  tool(
    "add_mark",
    "Añade una marca (umbral) a una zona scale: una muesca en la barra con su etiqueta y, debajo, una explicación corta. 'at' es la posición en la barra, de 0 a 100. El tablero evita que las etiquetas se pisen.",
    {
      zone: id("Id de una zona scale."),
      id: id("Identificador único."),
      at: { type: "number", minimum: 0, maximum: 100, description: "Posición en la barra, de 0 a 100." },
      label: str("Etiqueta breve de la marca, p. ej. '20%: empeoran'."),
      note: str("Explicación corta que se escribe debajo (opcional)."),
      tone: { type: "string", enum: MARK_TONES, description: "neutral = tinta; warn = ámbar (cuidado); danger = rojo (límite peligroso); ok = verde." },
    },
    ["zone", "id", "at", "label"],
  ),
  tool(
    "add_stage",
    "Añade una etapa a una zona cycle. Las etapas se colocan en círculo en el orden en que se añaden (o tras 'after'), con flechas en sentido horario y la última vuelve a la primera.",
    {
      zone: id("Id de una zona cycle."),
      id: id("Identificador único."),
      label: str("Nombre breve de la etapa (2 a 5 palabras)."),
      note: str("Explicación corta debajo (opcional)."),
      after: id("Id de la etapa tras la que se inserta (opcional; por defecto al final)."),
    },
    ["zone", "id", "label"],
  ),
  tool(
    "add_event",
    "Añade un evento o fase a una zona timeline: una marca sobre el eje del tiempo con 'when' junto a la marca y su etiqueta en una caja arriba o abajo. Sin 'at' los eventos se reparten por igual en el orden en que se añaden; con 'at' (0 a 100) se colocan proporcionalmente.",
    {
      zone: id("Id de una zona timeline."),
      id: id("Identificador único."),
      label: str("Texto breve del evento."),
      when: str("Fecha o etiqueta breve junto a la marca: 'Antes', '2024', 'Mes 1' (opcional)."),
      note: str("Explicación corta debajo de la etiqueta (opcional)."),
      at: { type: "number", minimum: 0, maximum: 100, description: "Posición en el eje, de 0 a 100 (opcional)." },
    },
    ["zone", "id", "label"],
  ),
  tool(
    "add_span",
    "Añade a una zona timeline un tramo (llave bajo el eje) que cubre una duración, p. ej. '2 a 3 meses'. 'from' y 'to' son posiciones del eje de 0 a 100, con from < to.",
    {
      zone: id("Id de una zona timeline."),
      id: id("Identificador único."),
      from: { type: "number", minimum: 0, maximum: 100, description: "Inicio del tramo, de 0 a 100." },
      to: { type: "number", minimum: 0, maximum: 100, description: "Final del tramo, de 0 a 100 (mayor que from)." },
      label: str("Texto breve del tramo, p. ej. '2 a 3 meses'."),
      tone: { type: "string", enum: MARK_TONES, description: "neutral = tinta; warn = ámbar (lento o costoso); danger = rojo; ok = verde (bueno)." },
    },
    ["zone", "id", "from", "to", "label"],
  ),
  tool(
    "set_level",
    "Rellena la barra de una zona scale hasta 'at' (0 a 100): el nivel actual, p. ej. 'se va llenando'. Volver a llamarla mueve el nivel.",
    {
      zone: id("Id de una zona scale."),
      at: { type: "number", minimum: 0, maximum: 100, description: "Hasta dónde llega el relleno, de 0 a 100." },
      label: str("Texto breve sobre el relleno (opcional), p. ej. 'se va llenando'."),
    },
    ["zone", "at"],
  ),
  tool(
    "connect",
    "Dibuja una flecha entre dos elementos, dentro de una zona o entre zonas distintas (p. ej. de un paso de un flujo a un componente de una arquitectura).",
    {
      id: id("Identificador único de la conexión."),
      from: id("Id del elemento origen."),
      to: id("Id del elemento destino."),
      label: str("Texto breve sobre la flecha."),
      style: { type: "string", enum: ["solid", "dashed"], description: "dashed = relación opcional, asíncrona o débil." },
      both_ways: { type: "boolean", description: "Flecha con punta en ambos extremos." },
    },
    ["id", "from", "to"],
  ),
  tool(
    "emphasize",
    "Resalta un elemento o zona a mano: círculo, subrayado o estrella. Para lo que el hablante marca como importante.",
    { target: id("Id del elemento o zona."), style: { type: "string", enum: ["circle", "underline", "star"] } },
    ["target", "style"],
  ),
  tool(
    "mark_question",
    "Marca un elemento con un signo de interrogación dibujado a mano: duda, punto sin resolver.",
    { target: id("Id del elemento o zona."), text: str("Duda en pocas palabras (opcional).") },
    ["target"],
  ),
  tool(
    "add_callout",
    "Añade una nota manuscrita corta con una flecha curva que apunta al elemento.",
    { id: id("Identificador único."), target: id("Id del elemento o zona señalado."), text: str("Texto muy corto.") },
    ["id", "target", "text"],
  ),
  tool(
    "update_label",
    "Cambia el texto de un elemento, zona, conexión o nota (cuando el hablante se corrige).",
    { id: id("Id a modificar."), label: str("Texto nuevo.") },
    ["id", "label"],
  ),
  tool(
    "update_text",
    "Cambia o BORRA un texto dentro de un elemento sin borrar el elemento. field: label = título de zona, etiqueta de elemento o de conexión; note = nota de una marca, etapa, evento o nodo de árbol; text = texto de una nota manuscrita (callout); when = fecha de un evento. Un value vacío quita el texto opcional (note, when, label de conexión). Úsala en lugar de delete cuando sólo se pide quitar o cambiar un texto.",
    {
      id: id("Id del elemento, zona, conexión o nota."),
      field: { type: "string", enum: TEXT_FIELDS },
      value: { type: "string", description: "Texto nuevo; vacío para quitarlo." },
    },
    ["id", "field", "value"],
  ),
  tool(
    "delete",
    "Borra un elemento, conexión, nota o zona. Borrar una zona borra todo su contenido; borrar un elemento quita sus conexiones.",
    { id: id("Id a borrar.") },
    ["id"],
  ),
  tool(
    "move_to_zone",
    "Mueve un elemento a otra zona (de un tipo compatible).",
    { id: id("Id del elemento."), zone: id("Id de la zona destino.") },
    ["id", "zone"],
  ),
  tool("update_summary", "Actualiza el resumen de una o dos frases de todo lo dicho hasta ahora.", { text: str("Resumen.") }, ["text"]),
];

export const OP_SCHEMAS: Record<OpName, ToolDef["input_schema"]> = Object.fromEntries(
  OP_TOOLS.map((t) => [t.name, t.input_schema]),
) as Record<OpName, ToolDef["input_schema"]>;

// ---- Catálogos de iconos (opcionales) ----
// Apagado, Claude no recibe nada del catálogo: toolsFor([]) devuelve OP_TOOLS tal cual.

/** Catálogos de iconos que el servidor conoce (hoy solo AWS). */
export const CATALOG_IDS = [AWS_PREFIJO_CATALOGO] as const;
const SERVICE_TOOLS: OpName[] = ["add_step", "add_decision", "add_component"];

/** Ids de servicio (sin prefijo de catálogo) que Claude puede mandar con los catálogos dados. */
export function serviceIdsFor(catalogs: readonly string[]): string[] {
  return catalogs.includes(AWS_PREFIJO_CATALOGO) ? SERVICIOS_AWS.map((s) => s.id) : [];
}

export function toolsFor(catalogs: readonly string[]): ToolDef[] {
  const ids = serviceIdsFor(catalogs);
  if (!ids.length) return OP_TOOLS;
  const service = { type: "string", enum: ids, description: "Servicio de AWS (icono). Solo si el hablante lo nombra o no hay duda." };
  const patched = OP_TOOLS.map((t) =>
    SERVICE_TOOLS.includes(t.name) ? { ...t, input_schema: { ...t.input_schema, properties: { ...t.input_schema.properties, service } } } : t,
  );
  return [
    ...patched.slice(0, -1),
    tool(
      "set_service",
      "Pone o cambia el icono de servicio de AWS de un elemento ya dibujado (cualquier tipo). service vacío lo quita.",
      { id: id("Id del elemento."), service: { type: "string", enum: [...ids, ""], description: "Id del servicio; vacío para quitarlo." } },
      ["id", "service"],
    ),
    patched[patched.length - 1], // update_summary sigue al final
  ];
}
