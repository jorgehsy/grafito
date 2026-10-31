import { op } from "@grafito/contract";
import { timeline } from "@grafito/board";

/** Dictado C: la ventana de contexto como una barra con umbrales (zona scale). */
export const context = timeline([
  {
    text: "quiero explicar cómo funciona la ventana de contexto en Claude Code.",
    ops: [
      op.create_zone({ id: "ventana", kind: "scale", title: "Ventana de contexto (1 M tokens)" }),
      op.update_summary({ text: "Cómo funciona la ventana de contexto en Claude Code." }),
    ],
  },
  {
    text: "la mayoría de los modelos como Opus, Sonnet, Haiku tienen una ventana de contexto de un millón de tokens.",
    ops: [
      op.add_callout({ id: "c_modelos", target: "ventana", text: "Opus, Sonnet, Haiku" }),
      op.update_summary({ text: "Opus, Sonnet y Haiku tienen una ventana de contexto de un millón de tokens." }),
    ],
  },
  {
    text: "cuando vas conversando con los modelos esa ventana se va llenando hasta ocupar el 90%.",
    ops: [
      op.set_level({ zone: "ventana", at: 60, label: "se va llenando" }),
      op.update_summary({ text: "La ventana de un millón de tokens se va llenando al conversar, hasta ocupar el 90%." }),
    ],
  },
  {
    text: "el harness de Claude Code tiene configurado que al llegar a cierto porcentaje la ventana se compacta para comprimir la conversación y continuar sin perder información.",
    ops: [
      op.add_mark({ zone: "ventana", id: "m90", at: 90, label: "90%: se compacta", note: "el harness comprime y sigue", tone: "danger" }),
      op.update_summary({ text: "La ventana se va llenando; al llegar al 90% el harness la compacta para seguir sin perder información." }),
    ],
  },
  {
    text: "he notado que cuando la ventana llega a un 20% los modelos, aunque razonen muy bien, empiezan a responder mal o a alucinar.",
    ops: [
      op.add_mark({ zone: "ventana", id: "m20", at: 20, label: "20%: empeoran", note: "respuestas malas o alucinaciones", tone: "warn" }),
      op.update_summary({ text: "La ventana se llena; desde el 20% los modelos empeoran y al 90% el harness la compacta." }),
    ],
  },
]);
