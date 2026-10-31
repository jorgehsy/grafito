import { op } from "@grafito/contract";
import { timeline } from "@grafito/board";

/** Dictado D: la ventana de contexto como un ciclo que se repite (zona cycle). */
export const ciclo = timeline([
  {
    text: "voy a contar qué pasa con la ventana de contexto mientras trabajas con Claude Code, porque es un ciclo que se repite.",
    ops: [
      op.create_zone({ id: "ciclo", kind: "cycle", title: "Ciclo de la ventana", center_label: "Ventana de contexto" }),
      op.update_summary({ text: "La ventana de contexto sigue un ciclo que se repite mientras se trabaja con Claude Code." }),
    ],
  },
  {
    text: "primero conversas con el modelo, vas pidiendo cosas y él te va respondiendo, y todo eso queda dentro de la ventana.",
    ops: [
      op.add_stage({ zone: "ciclo", id: "s1", label: "Conversar", note: "pides y responde" }),
      op.update_summary({ text: "Se conversa con el modelo y todo queda dentro de la ventana." }),
    ],
  },
  {
    text: "a medida que conversas la ventana se va llenando, cada mensaje y cada archivo que lee ocupa espacio.",
    ops: [
      op.add_stage({ zone: "ciclo", id: "s2", label: "Se llena", note: "cada mensaje ocupa espacio" }),
      op.update_summary({ text: "Al conversar la ventana se va llenando." }),
    ],
  },
  {
    text: "cuando llega al noventa por ciento, ahí es donde el harness reacciona.",
    ops: [
      op.add_stage({ zone: "ciclo", id: "s3", label: "Llega al 90%" }),
      op.emphasize({ target: "s3", style: "circle" }),
      op.update_summary({ text: "Al llegar al 90% el harness reacciona." }),
    ],
  },
  {
    text: "entonces se compacta, comprime la conversación en un resumen y la ventana vuelve a quedar casi vacía, y de nuevo a conversar: el ciclo empieza otra vez.",
    ops: [
      op.add_stage({ zone: "ciclo", id: "s4", label: "Se compacta", note: "resume y baja el uso" }),
      op.update_summary({ text: "La ventana se llena, al 90% se compacta, baja, y el ciclo vuelve a empezar." }),
    ],
  },
]);
