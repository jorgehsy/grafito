// Operation vocabulary: single source of truth.
// One Zod schema per operation. The TS types are inferred from it, parseOp validates with it,
// and toolDefs exports it as JSON Schema shaped like an Anthropic tool ({name, description, input_schema}).
// No operation carries coordinates.
import { z } from "zod";

export const ZONE_KINDS = ["flow", "system", "list", "compare", "mindmap", "scale", "cycle", "timeline", "tree"] as const;
const MARK_TONES = ["neutral", "warn", "danger", "ok"] as const;
const TEXT_FIELDS = ["label", "note", "text", "when"] as const;
const COMP_TYPES = ["actor", "client", "service", "database", "queue", "storage", "external"] as const;
const EMPHASIS_STYLES = ["circle", "underline", "star"] as const;

export type ZoneKind = (typeof ZONE_KINDS)[number];
export type MarkTone = (typeof MARK_TONES)[number];
export type TextField = (typeof TEXT_FIELDS)[number];
export type ComponentType = (typeof COMP_TYPES)[number];
export type EmphasisStyle = (typeof EMPHASIS_STYLES)[number];

// Checks that do not show in the JSON Schema Claude sees (refinements are not exported):
// required text must not be blank, a span must go forward, an arrow needs two ends.
const notBlank = (v: string) => v.trim().length > 0;
const str = (description: string) => z.string().describe(description);
/** Required text: also rejects whitespace-only values. */
const text = (description: string) => z.string().refine(notBlank, "must not be blank").describe(description);
const id = (description: string) => z.string().min(1).refine(notBlank, "must not be blank").describe(description);
const pos = (description: string) => z.number().min(0).max(100).describe(description);

/** Input schema per operation with every catalog off, in the order Claude sees the tools. */
const INPUTS = {
  create_zone: z.strictObject({
    id: id("Identificador único y estable, p. ej. 'proceso_pedido'."),
    kind: z.enum(ZONE_KINDS),
    title: text("Título corto de la zona."),
    left_title: str("Sólo compare: título de la columna izquierda.").optional(),
    right_title: str("Sólo compare: título de la columna derecha.").optional(),
    min_label: str("Sólo scale: etiqueta del extremo izquierdo de la barra (por defecto '0%').").optional(),
    max_label: str("Sólo scale: etiqueta del extremo derecho de la barra (por defecto '100%').").optional(),
    center_label: str("Sólo cycle: texto del centro del ciclo, lo que cicla (p. ej. 'Ventana de contexto').").optional(),
    place: z
      .strictObject({ relation: z.enum(["right_of", "below"]), of: id("Id de la zona de referencia.") })
      .describe("Pista opcional de colocación respecto a otra zona.")
      .optional(),
  }),
  add_step: z.strictObject({
    zone: id("Id de una zona flow."),
    id: id("Identificador único."),
    label: text("Texto breve del paso (2 a 6 palabras)."),
    icon: str("Emoji opcional.").optional(),
    after: id("Id del elemento previo al que sigue (dibuja la flecha).").optional(),
  }),
  add_decision: z.strictObject({
    zone: id("Id de una zona flow."),
    id: id("Identificador único."),
    question: text("Pregunta breve, p. ej. '¿Hay stock?'."),
    after: id("Id del elemento previo.").optional(),
  }),
  add_component: z.strictObject({
    zone: id("Id de una zona system."),
    id: id("Identificador único."),
    label: text("Nombre breve."),
    type: z.enum(COMP_TYPES),
    icon: str("Emoji opcional.").optional(),
  }),
  add_node: z.strictObject({
    zone: id("Id de una zona mindmap."),
    id: id("Identificador único."),
    label: text("Idea breve."),
    parent: id("Id del nodo padre.").optional(),
  }),
  add_item: z.strictObject({
    zone: id("Id de una zona list o compare."),
    id: id("Identificador único."),
    text: text("Texto del punto."),
    column: z.enum(["left", "right"]).optional(),
  }),
  add_branch: z.strictObject({
    zone: id("Id de una zona tree."),
    id: id("Identificador único."),
    label: text("Nombre breve del nodo (1 a 4 palabras)."),
    parent: id("Id del nodo padre (opcional; sin él es raíz).").optional(),
    note: str("Explicación corta debajo de la etiqueta (opcional).").optional(),
  }),
  add_mark: z.strictObject({
    zone: id("Id de una zona scale."),
    id: id("Identificador único."),
    at: pos("Posición en la barra, de 0 a 100."),
    label: text("Etiqueta breve de la marca, p. ej. '20%: empeoran'."),
    note: str("Explicación corta que se escribe debajo (opcional).").optional(),
    tone: z
      .enum(MARK_TONES)
      .describe("neutral = tinta; warn = ámbar (cuidado); danger = rojo (límite peligroso); ok = verde.")
      .optional(),
  }),
  add_stage: z.strictObject({
    zone: id("Id de una zona cycle."),
    id: id("Identificador único."),
    label: text("Nombre breve de la etapa (2 a 5 palabras)."),
    note: str("Explicación corta debajo (opcional).").optional(),
    after: id("Id de la etapa tras la que se inserta (opcional; por defecto al final).").optional(),
  }),
  add_event: z.strictObject({
    zone: id("Id de una zona timeline."),
    id: id("Identificador único."),
    label: text("Texto breve del evento."),
    when: str("Fecha o etiqueta breve junto a la marca: 'Antes', '2024', 'Mes 1' (opcional).").optional(),
    note: str("Explicación corta debajo de la etiqueta (opcional).").optional(),
    at: pos("Posición en el eje, de 0 a 100 (opcional).").optional(),
  }),
  add_span: z
    .strictObject({
      zone: id("Id de una zona timeline."),
      id: id("Identificador único."),
      from: pos("Inicio del tramo, de 0 a 100."),
      to: pos("Final del tramo, de 0 a 100 (mayor que from)."),
      label: text("Texto breve del tramo, p. ej. '2 a 3 meses'."),
      tone: z.enum(MARK_TONES).describe("neutral = tinta; warn = ámbar (lento o costoso); danger = rojo; ok = verde (bueno).").optional(),
    })
    .refine((i) => i.from < i.to, { message: "from must be less than to", path: ["to"] }),
  set_level: z.strictObject({
    zone: id("Id de una zona scale."),
    at: pos("Hasta dónde llega el relleno, de 0 a 100."),
    label: str("Texto breve sobre el relleno (opcional), p. ej. 'se va llenando'.").optional(),
  }),
  connect: z.strictObject({
    id: id("Identificador único de la conexión."),
    from: id("Id del elemento origen."),
    to: id("Id del elemento destino."),
    label: str("Texto breve sobre la flecha.").optional(),
    style: z.enum(["solid", "dashed"]).describe("dashed = relación opcional, asíncrona o débil.").optional(),
    both_ways: z.boolean().describe("Flecha con punta en ambos extremos.").optional(),
  }).refine((i) => i.from !== i.to, { message: "source and target are the same", path: ["to"] }),
  emphasize: z.strictObject({ target: id("Id del elemento o zona."), style: z.enum(EMPHASIS_STYLES) }),
  mark_question: z.strictObject({ target: id("Id del elemento o zona."), text: str("Duda en pocas palabras (opcional).").optional() }),
  add_callout: z.strictObject({ id: id("Identificador único."), target: id("Id del elemento o zona señalado."), text: text("Texto muy corto.") }),
  update_label: z.strictObject({ id: id("Id a modificar."), label: text("Texto nuevo.") }),
  update_text: z.strictObject({
    id: id("Id del elemento, zona, conexión o nota."),
    field: z.enum(TEXT_FIELDS),
    value: str("Texto nuevo; vacío para quitarlo."),
  }),
  delete: z.strictObject({ id: id("Id a borrar.") }),
  move_to_zone: z.strictObject({ id: id("Id del elemento."), zone: id("Id de la zona destino.") }),
  update_summary: z.strictObject({ text: text("Resumen.") }),
};

/** Tool descriptions (prompt text, Spanish on purpose). Key order = tool order. */
const DESCRIPTIONS: Record<keyof typeof INPUTS, string> = {
  create_zone:
    "Crea una zona (un recuadro temático) en el tablero. Úsala cuando el hablante empieza un tema nuevo. kind: flow = proceso paso a paso; system = arquitectura de componentes; list = lista de puntos; compare = dos columnas comparadas; mindmap = ideas ramificadas; scale = una cantidad que cambia sobre un eje (barra con umbrales: porcentaje, capacidad, tiempo, nivel); cycle = algo que se repite en bucle; timeline = eventos o fases en el tiempo, antes/ahora; tree = una jerarquía o clasificación que crece de izquierda a derecha (categorías con subcategorías, tipos con sus resultados, desgloses). No se dan coordenadas: el tablero coloca la zona. 'place' sólo para pedir vecindad.",
  add_step: "Añade un paso (rectángulo) a una zona flow. 'after' conecta automáticamente con el paso anterior.",
  add_decision: "Añade una decisión (rombo) a una zona flow. Las ramas se conectan después con connect y una etiqueta ('sí', 'no').",
  add_component:
    "Añade un componente a una zona system. type: actor = persona (muñeco); client = navegador o móvil; service = caja de servicio; database = cilindro; queue = cola o tubería; storage = bucket o carpeta; external = nube punteada de un tercero.",
  add_node: "Añade una idea a una zona mindmap. Sin 'parent' es la idea central (o cuelga de ella).",
  add_item: "Añade un punto a una zona list o compare. En compare, 'column' elige la columna.",
  add_branch:
    "Añade un nodo a una zona tree: una caja en la jerarquía. Sin 'parent' es una raíz (varias raíces se apilan); con 'parent' cuelga de ese nodo, en una columna a su derecha. Los hermanos se apilan en el orden en que se añaden y el tablero dibuja los conectores. Los padres antes que los hijos.",
  add_mark:
    "Añade una marca (umbral) a una zona scale: una muesca en la barra con su etiqueta y, debajo, una explicación corta. 'at' es la posición en la barra, de 0 a 100. El tablero evita que las etiquetas se pisen.",
  add_stage:
    "Añade una etapa a una zona cycle. Las etapas se colocan en círculo en el orden en que se añaden (o tras 'after'), con flechas en sentido horario y la última vuelve a la primera.",
  add_event:
    "Añade un evento o fase a una zona timeline: una marca sobre el eje del tiempo con 'when' junto a la marca y su etiqueta en una caja arriba o abajo. Sin 'at' los eventos se reparten por igual en el orden en que se añaden; con 'at' (0 a 100) se colocan proporcionalmente.",
  add_span:
    "Añade a una zona timeline un tramo (llave bajo el eje) que cubre una duración, p. ej. '2 a 3 meses'. 'from' y 'to' son posiciones del eje de 0 a 100, con from < to.",
  set_level: "Rellena la barra de una zona scale hasta 'at' (0 a 100): el nivel actual, p. ej. 'se va llenando'. Volver a llamarla mueve el nivel.",
  connect:
    "Dibuja una flecha entre dos elementos, dentro de una zona o entre zonas distintas (p. ej. de un paso de un flujo a un componente de una arquitectura).",
  emphasize: "Resalta un elemento o zona a mano: círculo, subrayado o estrella. Para lo que el hablante marca como importante.",
  mark_question: "Marca un elemento con un signo de interrogación dibujado a mano: duda, punto sin resolver.",
  add_callout: "Añade una nota manuscrita corta con una flecha curva que apunta al elemento.",
  update_label: "Cambia el texto de un elemento, zona, conexión o nota (cuando el hablante se corrige).",
  update_text:
    "Cambia o BORRA un texto dentro de un elemento sin borrar el elemento. field: label = título de zona, etiqueta de elemento o de conexión; note = nota de una marca, etapa, evento o nodo de árbol; text = texto de una nota manuscrita (callout); when = fecha de un evento. Un value vacío quita el texto opcional (note, when, label de conexión). Úsala en lugar de delete cuando sólo se pide quitar o cambiar un texto.",
  delete: "Borra un elemento, conexión, nota o zona. Borrar una zona borra todo su contenido; borrar un elemento quita sus conexiones.",
  move_to_zone: "Mueve un elemento a otra zona (de un tipo compatible).",
  update_summary: "Actualiza el resumen de una o dos frases de todo lo dicho hasta ahora.",
};

// ---- Icon catalogs (optional) ----
// When on, the elements that can carry a service icon get `service`, and set_service appears
// (just before update_summary, which stays last). When off, Claude sees nothing of the catalog.

/** Operations that take a `service` when a catalog is on. */
const SERVICE_OPS = ["add_step", "add_decision", "add_component"] as const;
const SET_SERVICE_DESCRIPTION =
  "Pone o cambia el icono de servicio de AWS de un elemento ya dibujado (cualquier tipo). service vacío lo quita.";

/** Input schemas for one catalog set: `serviceIds` empty = catalogs off. */
export function inputSchemas(serviceIds: readonly string[]): { name: OpName; description: string; schema: z.ZodType }[] {
  const base = (Object.keys(INPUTS) as (keyof typeof INPUTS)[]).map((name) => ({
    name: name as OpName,
    description: DESCRIPTIONS[name],
    schema: INPUTS[name] as z.ZodType,
  }));
  if (!serviceIds.length) return base;
  const [first, ...rest] = serviceIds;
  const service = z.enum([first, ...rest]).describe("Servicio de AWS (icono). Solo si el hablante lo nombra o no hay duda.");
  const patched = base.map((t) =>
    (SERVICE_OPS as readonly string[]).includes(t.name)
      ? { ...t, schema: INPUTS[t.name as (typeof SERVICE_OPS)[number]].extend({ service: service.optional() }) }
      : t,
  );
  const setService = {
    name: "set_service" as OpName,
    description: SET_SERVICE_DESCRIPTION,
    schema: z.strictObject({
      id: id("Id del elemento."),
      service: z.enum([...serviceIds, ""]).describe("Id del servicio; vacío para quitarlo."),
    }),
  };
  return [...patched.slice(0, -1), setService, patched[patched.length - 1]];
}

// ---- Types ----

type BaseInputs = { [K in keyof typeof INPUTS]: z.output<(typeof INPUTS)[K]> };
type WithService<T> = T & { service?: string };

export type OpInputs = Omit<BaseInputs, (typeof SERVICE_OPS)[number]> & {
  add_step: WithService<BaseInputs["add_step"]>;
  add_decision: WithService<BaseInputs["add_decision"]>;
  add_component: WithService<BaseInputs["add_component"]>;
  /** Service icon for any element; an empty `service` removes it. Only with a catalog on. */
  set_service: { id: string; service: string };
};
export type OpName = keyof OpInputs;
export type Op = { [K in OpName]: { name: K; input: OpInputs[K] } }[OpName];

type OpBuilders = { [K in OpName]: (input: OpInputs[K]) => { name: K; input: OpInputs[K] } };
/** Typed builders: op.add_step({...}) -> {name:"add_step", input:{...}} */
export const op = new Proxy({} as OpBuilders, {
  get: (_t, name: string) => (input: unknown) => ({ name, input }),
});
