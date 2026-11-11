import type { Demo } from "@grafito/board";
import { architecture } from "./architecture";
import { process } from "./process";
import { context } from "./context";
import { cycle } from "./cycle";
import { beforeAfter } from "./before-after";
import { prototypes } from "./prototypes";
import { compact } from "./compact";
import { dataModel } from "./data-model";
import { sketch } from "./sketch";

/** `lang` is the language the demo is spoken in; `description` is one line, in that language. */
export interface DemoInfo { id: string; name: string; description: string; lang: "en" | "es"; demo: Demo }
export const DEMOS: DemoInfo[] = [
  { id: "architecture", name: "Architecture of a web app", description: "A system drawn end to end, with corrections on the way: web, API, queue, worker and payments.", lang: "en", demo: architecture },
  { id: "process", name: "Proceso de un pedido", description: "Un flujo paso a paso, con una decisión, y una lista de problemas abiertos al lado.", lang: "es", demo: process },
  { id: "sketch", name: "Del boceto al diagrama", description: "Trazos a mano que Claude lee y pasa en limpio, mezclados con la voz.", lang: "es", demo: sketch },
  { id: "context", name: "Ventana de contexto", description: "Una barra con umbrales: cómo se llena la ventana de contexto.", lang: "es", demo: context },
  { id: "cycle", name: "Ciclo de la ventana", description: "Algo que se repite, dibujado como un ciclo.", lang: "es", demo: cycle },
  { id: "before-after", name: "Antes y ahora del software", description: "Una línea de tiempo que compara dos épocas.", lang: "es", demo: beforeAfter },
  { id: "prototypes", name: "Tipos de prototipo", description: "Una clasificación que crece como un árbol.", lang: "es", demo: prototypes },
  { id: "compact", name: "Compactar en cuatro cuadros", description: "La ventana de contexto en cuatro cuadros: se llena, se compacta y sigue.", lang: "es", demo: compact },
  { id: "data-model", name: "Modelo de datos de una tienda", description: "Tablas con sus campos y las relaciones entre ellas.", lang: "es", demo: dataModel },
];
