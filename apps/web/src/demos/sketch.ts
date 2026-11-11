import { op } from "@grafito/contract";
import { timeline } from "@grafito/board";
import { roughArrow, roughCylinder, roughOval, roughRect, roughWords } from "./rough";

const PIZARRA = "#3E5E8C";
const blue = <T extends { color?: string }>(strokes: T[]): T[] => strokes.map((s) => ({ ...s, color: PIZARRA }));

/**
 * Dictado I: del boceto al diagrama. Los trazos aparecen a mano mientras se habla y, cuando Claude los "lee",
 * se van y queda el diagrama. Las coordenadas de cada boceto siguen el layout del tablero en ese momento.
 */
export const sketch = timeline([
  {
    title: "Un boceto a mano",
    text: "esto lo dibujo a mano, sin decir mucho: una app a la izquierda, una api al medio y, a la derecha, la base de datos donde se guardan los pedidos.",
    strokes: [
      roughRect(40, 62, 150, 96, 1),
      roughWords(72, 112, 84, 1),
      ...roughArrow(208, 110, 462, 110, 2),
      roughRect(482, 72, 138, 78, 3),
      roughWords(514, 112, 72, 3),
      ...roughArrow(640, 110, 918, 110, 4),
      ...roughCylinder(942, 54, 160, 108, 5),
    ],
    ops: [
      op.create_zone({ id: "pedidos", kind: "system", title: "Pedidos en línea" }),
      op.add_component({ zone: "pedidos", id: "app", label: "App", type: "client" }),
      op.add_component({ zone: "pedidos", id: "api", label: "API", type: "service" }),
      op.add_component({ zone: "pedidos", id: "db", label: "Base de datos", type: "database" }),
      op.connect({ id: "c_app_api", from: "app", to: "api", label: "pide" }),
      op.connect({ id: "c_api_db", from: "api", to: "db", label: "guarda" }),
      op.update_summary({ text: "Boceto pasado en limpio: una app pide a la API y la API guarda en la base de datos." }),
    ],
  },
  {
    title: "Seguir hablando",
    text: "Claude leyó el boceto y lo pasó en limpio. ahora sigo con la voz: la api también manda los correos de confirmación.",
    ops: [
      op.add_component({ zone: "pedidos", id: "correo", label: "Correos", type: "external" }),
      op.connect({ id: "c_api_correo", from: "api", to: "correo", label: "confirma", style: "dashed" }),
      op.update_summary({ text: "La app pide a la API; la API guarda en la base de datos y manda los correos de confirmación." }),
    ],
  },
  {
    title: "Dibujar sobre el diagrama",
    text: "y vuelvo al lápiz: debajo de la api dibujo otra caja con una flecha, que es la cola donde esperan los pedidos cuando hay mucha carga.",
    strokes: blue([
      ...roughArrow(551, 166, 551, 214, 6),
      roughRect(468, 222, 168, 76, 7),
      roughWords(498, 262, 108, 7),
    ]),
    ops: [
      op.add_component({ zone: "pedidos", id: "cola", label: "Cola de pedidos", type: "queue" }),
      op.connect({ id: "c_api_cola", from: "api", to: "cola" }),
      op.update_summary({ text: "La API guarda en la base de datos, manda correos y deja los pedidos en una cola cuando hay mucha carga." }),
    ],
  },
  {
    title: "Marcar lo importante",
    text: "por último encierro la base de datos en un círculo, porque es lo que más hay que cuidar.",
    strokes: blue([roughOval(1164, 110, 118, 74, 8)]),
    ops: [
      op.emphasize({ target: "db", style: "circle" }),
      op.update_summary({ text: "Pedidos en línea: app, API, cola, correos y la base de datos, que es lo que más hay que cuidar." }),
    ],
  },
]);
