import type { Demo } from "@grafito/board";
import { architecture } from "./architecture";
import { process } from "./process";
import { context } from "./context";
import { cycle } from "./cycle";
import { beforeAfter } from "./before-after";
import { prototypes } from "./prototypes";
import { compact } from "./compact";

export interface DemoInfo { id: string; name: string; demo: Demo }
export const DEMOS: DemoInfo[] = [
  { id: "architecture", name: "Architecture of a web app", demo: architecture },
  { id: "process", name: "Proceso de un pedido", demo: process },
  { id: "context", name: "Ventana de contexto", demo: context },
  { id: "cycle", name: "Ciclo de la ventana", demo: cycle },
  { id: "before-after", name: "Antes y ahora del software", demo: beforeAfter },
  { id: "prototypes", name: "Tipos de prototipo", demo: prototypes },
  { id: "compact", name: "Compactar en cuatro cuadros", demo: compact },
];
