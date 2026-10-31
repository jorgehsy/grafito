import { op } from "@grafito/contract";
import { timeline } from "@grafito/board";

/** Dictado E: cómo cambió hacer software, antes y ahora (zona timeline con tramos). */
export const antesAhora = timeline([
  {
    text: "quiero mostrar cómo ha cambiado hacer software, comparando cómo era antes con cómo es ahora.",
    ops: [
      op.create_zone({ id: "tiempo", kind: "timeline", title: "Antes y ahora del software" }),
      op.update_summary({ text: "Comparación entre cómo se hacía software antes y cómo se hace ahora." }),
    ],
  },
  {
    text: "antes todo partía con una idea, luego definías el alcance, escribías las historias de usuario, estimabas el trabajo y recién ahí llegaba el software.",
    ops: [
      op.add_event({ zone: "tiempo", id: "e1", label: "Idea", when: "Antes", at: 0 }),
      op.add_event({ zone: "tiempo", id: "e2", label: "Definir alcance", at: 12 }),
      op.add_event({ zone: "tiempo", id: "e3", label: "Historias de usuario", at: 24 }),
      op.add_event({ zone: "tiempo", id: "e4", label: "Estimar", at: 36 }),
      op.add_event({ zone: "tiempo", id: "e5", label: "Software", at: 48 }),
      op.update_summary({ text: "Antes: idea, alcance, historias, estimación y por fin el software." }),
    ],
  },
  {
    text: "todo ese camino tomaba entre dos y tres meses.",
    ops: [
      op.add_span({ zone: "tiempo", id: "sp_antes", from: 0, to: 48, label: "2 a 3 meses", tone: "warn" }),
      op.update_summary({ text: "Antes el camino de la idea al software tomaba de dos a tres meses." }),
    ],
  },
  {
    text: "ahora haces un prototipo con Claude, lo pruebas, y en cosa de un mes ya tienes algo funcionando.",
    ops: [
      op.add_event({ zone: "tiempo", id: "e6", label: "Prototipo con Claude", note: "se prueba al tiro", when: "Ahora", at: 66 }),
      op.add_event({ zone: "tiempo", id: "e7", label: "Software funcionando", at: 100 }),
      op.add_span({ zone: "tiempo", id: "sp_ahora", from: 66, to: 100, label: "1 mes", tone: "ok" }),
      op.update_summary({ text: "Ahora se hace un prototipo con Claude y en un mes hay software funcionando." }),
    ],
  },
]);
