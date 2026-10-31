import { op } from "@grafito/contract";
import { timeline } from "@grafito/board";

/** Dictado A: cómo se procesa un pedido, de la compra a la entrega. */
export const process = timeline([
  {
    text: "Bueno, voy a explicar cómo procesamos un pedido en la tienda, desde que el cliente compra hasta que le llega el paquete.",
    ops: [
      op.create_zone({ id: "pedido", kind: "flow", title: "Proceso de un pedido" }),
      op.update_summary({ text: "Cómo se procesa un pedido de la tienda, de la compra a la entrega." }),
    ],
  },
  {
    text: "Todo empieza cuando el cliente hace la compra en la web y paga con tarjeta.",
    ops: [
      op.add_step({ zone: "pedido", id: "compra", label: "El cliente compra", icon: "🛒" }),
      op.add_step({ zone: "pedido", id: "pago", label: "Cobro con tarjeta", icon: "💳", after: "compra" }),
    ],
  },
  {
    text: "Después del cobro verificamos la identidad del cliente.",
    ops: [op.add_step({ zone: "pedido", id: "identidad", label: "Verificar identidad", after: "pago" })],
  },
  {
    text: "No, perdón, eso no hace falta, el banco ya lo hace por nosotros.",
    ops: [op.delete({ id: "identidad" })],
  },
  {
    text: "Lo siguiente es comprobar si hay stock de lo que pidió.",
    ops: [op.add_decision({ zone: "pedido", id: "stock", question: "¿Hay stock?", after: "pago" })],
  },
  {
    text: "Si hay, pasamos a preparar el paquete en el almacén.",
    ops: [
      op.add_step({ zone: "pedido", id: "preparar", label: "Preparar el paquete", icon: "📦" }),
      op.connect({ id: "c_si", from: "stock", to: "preparar", label: "sí" }),
    ],
  },
  {
    text: "Y si no hay, avisamos al cliente de la espera y pedimos al proveedor.",
    ops: [
      op.add_step({ zone: "pedido", id: "avisar", label: "Avisar y pedir al proveedor", icon: "🏭" }),
      op.connect({ id: "c_no", from: "stock", to: "avisar", label: "no" }),
    ],
  },
  {
    text: "En cuanto llega la mercancía volvemos a preparar el paquete.",
    ops: [op.connect({ id: "c_llega", from: "avisar", to: "preparar", label: "llega", style: "dashed" })],
  },
  {
    text: "Una vez preparado, lo mandamos ese mismo día con el courier.",
    ops: [op.add_step({ zone: "pedido", id: "enviar", label: "Enviar el mismo día", icon: "🚚", after: "preparar" })],
  },
  {
    text: "Bueno, no, en realidad no es el mismo día, se envía al día siguiente porque el courier recoge una sola vez, por la mañana.",
    ops: [op.update_label({ id: "enviar", label: "Enviar al día siguiente" }), op.emphasize({ target: "enviar", style: "underline" })],
  },
  {
    text: "Y por último, el cliente recibe el paquete en su casa. Ese paso es el que más nos importa.",
    ops: [
      op.add_step({ zone: "pedido", id: "entrega", label: "Entrega en casa", icon: "🏠", after: "enviar" }),
      op.emphasize({ target: "entrega", style: "star" }),
    ],
  },
  {
    text: "Ahora bien, hay varios problemas que todavía tenemos abiertos.",
    ops: [op.create_zone({ id: "problemas", kind: "list", title: "Problemas abiertos", place: { relation: "below", of: "pedido" } })],
  },
  {
    text: "Uno: a veces el stock del sistema no coincide con el real. Dos: las devoluciones no tienen un proceso claro.",
    ops: [
      op.add_item({ zone: "problemas", id: "p1", text: "El stock del sistema no coincide con el real" }),
      op.add_item({ zone: "problemas", id: "p2", text: "Las devoluciones no tienen proceso" }),
      op.mark_question({ target: "stock", text: "¿stock real?" }),
    ],
  },
  {
    text: "Tres: los clientes preguntan dónde está su paquete y no les podemos decir nada. Y cuatro: nos faltan repartidores propios.",
    ops: [
      op.add_item({ zone: "problemas", id: "p3", text: "Sin seguimiento del paquete" }),
      op.add_item({ zone: "problemas", id: "p4", text: "Faltan repartidores propios" }),
    ],
  },
  {
    text: "Eso nos lleva a decidir si el envío lo hacemos nosotros o seguimos con un courier.",
    ops: [
      op.create_zone({
        id: "envios", kind: "compare", title: "¿Cómo enviamos?", left_title: "Envío propio", right_title: "Courier",
        place: { relation: "right_of", of: "problemas" },
      }),
    ],
  },
  {
    text: "Con envío propio controlamos los tiempos y sale más barato dentro de la ciudad.",
    ops: [
      op.add_item({ zone: "envios", id: "e1", text: "Controlamos los tiempos", column: "left" }),
      op.add_item({ zone: "envios", id: "e2", text: "Más barato en la ciudad", column: "left" }),
    ],
  },
  {
    text: "El courier cubre todo el país y da seguimiento, pero es más caro y depende de su horario.",
    ops: [
      op.add_item({ zone: "envios", id: "e3", text: "Cubre todo el país", column: "right" }),
      op.add_item({ zone: "envios", id: "e4", text: "Da seguimiento", column: "right" }),
      op.add_item({ zone: "envios", id: "e5", text: "Más caro y con horario fijo", column: "right" }),
    ],
  },
  {
    text: "Ah, y lo de los repartidores no es un problema abierto, es la desventaja de tener envío propio, así que va en la comparación.",
    ops: [op.move_to_zone({ id: "p4", zone: "envios" })],
  },
  {
    text: "En resumen, el flujo está claro; lo difícil es el stock real y el seguimiento de los envíos.",
    ops: [
      op.update_summary({ text: "Flujo de pedido claro; pendientes: stock real, devoluciones, seguimiento y decidir envío propio o courier." }),
      op.emphasize({ target: "p1", style: "circle" }),
      op.add_callout({ id: "nota1", target: "p3", text: "el courier ya lo resuelve" }),
    ],
  },
  {
    text: "Eso es todo por ahora, luego lo afinamos.",
    ops: [],
  },
]);
