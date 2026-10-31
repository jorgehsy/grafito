import { op } from "@grafito/contract";
import { timeline } from "@grafito/board";

/** Dictado G: la ventana de contexto en cuatro cuadros (zonas scale en fila): se llena, se compacta y sigue con el resumen. */
export const compactar = timeline([
  {
    text: "te voy a mostrar la ventana de contexto en cuatro cuadros, uno al lado del otro, cada uno con su barra.",
    ops: [
      op.update_summary({ text: "La ventana de contexto en cuatro cuadros, cada uno con su barra." }),
    ],
  },
  {
    text: "cuadro uno: sesión nueva. La barra está casi vacía, al cinco por ciento: sólo las instrucciones del sistema.",
    ops: [
      op.create_zone({ id: "c1", kind: "scale", title: "1. Sesión nueva" }),
      op.set_level({ zone: "c1", at: 5, label: "instrucciones del sistema" }),
      op.add_mark({ zone: "c1", id: "c1_m", at: 5, label: "5%", tone: "ok" }),
      op.update_summary({ text: "Cuadro 1: sesión nueva, la ventana al 5% con sólo las instrucciones del sistema." }),
    ],
  },
  {
    text: "cuadro dos: después de varios turnos. Cada mensaje y cada respuesta suman. La barra llega al cincuenta por ciento.",
    ops: [
      op.create_zone({ id: "c2", kind: "scale", title: "2. Varios turnos", place: { relation: "right_of", of: "c1" } }),
      op.set_level({ zone: "c2", at: 50, label: "mensajes y respuestas" }),
      op.add_mark({ zone: "c2", id: "c2_m", at: 50, label: "50%", tone: "neutral" }),
      op.connect({ id: "k12", from: "c1_m", to: "c2_m", label: "turnos" }),
      op.update_summary({ text: "Cuadro 2: tras varios turnos la ventana llega al 50%; cada mensaje y respuesta suman." }),
    ],
  },
  {
    text: "cuadro tres: la barra llega al noventa por ciento. Ese es el umbral: Claude compacta automáticamente.",
    ops: [
      op.create_zone({ id: "c3", kind: "scale", title: "3. Umbral: compacta", place: { relation: "right_of", of: "c2" } }),
      op.set_level({ zone: "c3", at: 90, label: "casi llena" }),
      op.add_mark({ zone: "c3", id: "c3_m", at: 90, label: "90%: compacta", tone: "danger" }),
      op.connect({ id: "k23", from: "c2_m", to: "c3_m", label: "más turnos" }),
      op.update_summary({ text: "Cuadro 3: al 90% Claude compacta automáticamente." }),
    ],
  },
  {
    text: "compactar es resumir la conversación y guardar sólo las decisiones importantes.",
    ops: [
      op.add_callout({ id: "n_compactar", target: "c3_m", text: "resume y guarda las decisiones" }),
      op.update_summary({ text: "Al 90% Claude compacta: resume la conversación y guarda sólo las decisiones importantes." }),
    ],
  },
  {
    text: "cuadro cuatro: después de compactar. La barra baja al quince por ciento. Sólo queda el resumen y sigues trabajando.",
    ops: [
      op.create_zone({ id: "c4", kind: "scale", title: "4. Después de compactar", place: { relation: "right_of", of: "c3" } }),
      op.set_level({ zone: "c4", at: 15, label: "sólo el resumen" }),
      op.add_mark({ zone: "c4", id: "c4_m", at: 15, label: "15%: resumen", tone: "ok" }),
      op.connect({ id: "k34", from: "c3_m", to: "c4_m", label: "compactar" }),
      op.update_summary({ text: "La ventana se llena con los turnos (5% → 50%), al 90% Claude compacta y la conversación sigue al 15% con el resumen." }),
    ],
  },
]);
