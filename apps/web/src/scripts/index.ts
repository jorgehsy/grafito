import type { Demo } from "@grafito/board";
import { arquitectura } from "./arquitectura";
import { proceso } from "./proceso";
import { contexto } from "./contexto";
import { ciclo } from "./ciclo";
import { antesAhora } from "./antes-ahora";
import { prototipos } from "./prototipos";
import { compactar } from "./compactar";

export interface ScriptInfo { id: string; name: string; script: Demo }
export const SCRIPTS: ScriptInfo[] = [
  { id: "arquitectura", name: "Arquitectura de una app web", script: arquitectura },
  { id: "proceso", name: "Proceso de un pedido", script: proceso },
  { id: "contexto", name: "Ventana de contexto", script: contexto },
  { id: "ciclo", name: "Ciclo de la ventana", script: ciclo },
  { id: "antes-ahora", name: "Antes y ahora del software", script: antesAhora },
  { id: "prototipos", name: "Tipos de prototipo", script: prototipos },
  { id: "compactar", name: "Compactar en cuatro cuadros", script: compactar },
];
