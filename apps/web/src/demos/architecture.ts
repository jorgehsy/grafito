import { op } from "@grafito/contract";
import { timeline } from "@grafito/board";

/** Dictado B: arquitectura de una aplicación web con cola, worker y pagos externos. */
export const architecture = timeline([
  {
    text: "Vamos a repasar la arquitectura de la aplicación de pedidos, de punta a punta.",
    ops: [
      op.create_zone({ id: "app", kind: "system", title: "Arquitectura de la aplicación" }),
      op.update_summary({ text: "Arquitectura de la app de pedidos: web, API, cola, worker, base de datos y pagos externos." }),
    ],
  },
  {
    text: "Arriba del todo está el usuario, que entra desde su navegador, desde el ordenador o desde el móvil.",
    ops: [
      op.add_component({ zone: "app", id: "usuario", label: "Usuario", type: "actor" }),
      op.add_component({ zone: "app", id: "web", label: "Navegador", type: "client" }),
      op.connect({ id: "c1", from: "usuario", to: "web" }),
    ],
  },
  {
    text: "El navegador habla con nuestra API por HTTPS, que es un servicio en Node.",
    ops: [
      op.add_component({ zone: "app", id: "api", label: "API", type: "service" }),
      op.connect({ id: "c2", from: "web", to: "api", label: "HTTPS" }),
    ],
  },
  {
    text: "La API guarda el pedido directamente en la base de datos, que es MySQL.",
    ops: [
      op.add_component({ zone: "app", id: "bd", label: "MySQL", type: "database" }),
      op.connect({ id: "c_api_bd", from: "api", to: "bd" }),
    ],
  },
  {
    text: "No, perdón, en realidad la base de datos es Postgres, no MySQL.",
    ops: [op.update_label({ id: "bd", label: "PostgreSQL" })],
  },
  {
    text: "Y tampoco, la API no guarda nada directamente. Lo único que hace es dejar el pedido en una cola.",
    ops: [
      op.delete({ id: "c_api_bd" }),
      op.add_component({ zone: "app", id: "cola", label: "Cola de pedidos", type: "queue" }),
      op.connect({ id: "c3", from: "api", to: "cola", label: "encola" }),
    ],
  },
  {
    text: "Del otro lado de la cola hay un worker que va leyendo los pedidos de uno en uno.",
    ops: [
      op.add_component({ zone: "app", id: "worker", label: "Worker", type: "service" }),
      op.connect({ id: "c4", from: "cola", to: "worker" }),
    ],
  },
  {
    text: "Es el worker el que guarda en la base de datos y el que se encarga de todo lo lento.",
    ops: [op.connect({ id: "c5", from: "worker", to: "bd", label: "guarda" })],
  },
  {
    text: "Para cobrar usamos un proveedor de pagos externo, que no controlamos nosotros.",
    ops: [
      op.add_component({ zone: "app", id: "pagos", label: "Proveedor de pagos", type: "external", icon: "💳" }),
      op.connect({ id: "c6", from: "worker", to: "pagos", label: "cobra" }),
    ],
  },
  {
    text: "Cuando termina, nos avisa de forma asíncrona con un webhook que llega a la API.",
    ops: [op.connect({ id: "c7", from: "pagos", to: "api", label: "webhook", style: "dashed" })],
  },
  {
    text: "Las facturas en PDF las generamos en el worker y las dejamos en un bucket de almacenamiento.",
    ops: [
      op.add_component({ zone: "app", id: "facturas", label: "Bucket de facturas", type: "storage" }),
      op.connect({ id: "c8", from: "worker", to: "facturas", label: "PDF" }),
    ],
  },
  {
    text: "La cola es la pieza clave: absorbe los picos de pedidos, por ejemplo en rebajas.",
    ops: [
      op.emphasize({ target: "cola", style: "circle" }),
      op.add_callout({ id: "nota_cola", target: "cola", text: "absorbe los picos de ventas" }),
    ],
  },
  {
    text: "Ahora veamos cómo se procesa un pago, paso a paso.",
    ops: [op.create_zone({ id: "pago", kind: "flow", title: "Cómo se procesa un pago", place: { relation: "below", of: "app" } })],
  },
  {
    text: "El usuario confirma el pedido y la API crea un pago pendiente.",
    ops: [
      op.add_step({ zone: "pago", id: "s1", label: "El usuario confirma" }),
      op.add_step({ zone: "pago", id: "s2", label: "La API crea un pago pendiente", after: "s1" }),
      op.connect({ id: "x1", from: "s2", to: "api", style: "dashed" }),
    ],
  },
  {
    text: "El pedido pasa por la cola y el worker llama al proveedor de pagos.",
    ops: [
      op.add_step({ zone: "pago", id: "s3", label: "El worker llama al proveedor", after: "s2" }),
      op.connect({ id: "x2", from: "s3", to: "pagos" }),
    ],
  },
  {
    text: "Si el pago se aprueba, guardamos el pedido como pagado. Si no, reintentamos un par de veces.",
    ops: [
      op.add_decision({ zone: "pago", id: "d1", question: "¿Pago aprobado?", after: "s3" }),
      op.add_step({ zone: "pago", id: "s4", label: "Guardar pedido pagado" }),
      op.add_step({ zone: "pago", id: "s5", label: "Reintentar", icon: "🔁" }),
      op.connect({ id: "y1", from: "d1", to: "s4", label: "sí" }),
      op.connect({ id: "y2", from: "d1", to: "s5", label: "no" }),
      op.connect({ id: "x3", from: "s4", to: "bd" }),
    ],
  },
  {
    text: "Y no tengo claro qué pasa si el proveedor tarda demasiado en responder, eso hay que revisarlo.",
    ops: [op.mark_question({ target: "pagos", text: "¿y los timeouts?" })],
  },
  {
    text: "Por último, al guardar el pedido mandamos un correo de confirmación y se genera la factura.",
    ops: [
      op.add_step({ zone: "pago", id: "s6", label: "Correo y factura", icon: "✉️", after: "s4" }),
      op.connect({ id: "x4", from: "s6", to: "facturas", style: "dashed" }),
      op.emphasize({ target: "s4", style: "star" }),
    ],
  },
  {
    text: "Lo bueno de este diseño es que si el worker se cae, los pedidos se quedan esperando en la cola y no se pierde ninguno, simplemente se procesan más tarde.",
    ops: [op.add_callout({ id: "nota_worker", target: "worker", text: "si se cae, nada se pierde" })],
  },
  {
    text: "Eso sería todo: una API fina, una cola que amortigua y un worker que hace el trabajo pesado.",
    ops: [op.update_summary({ text: "API fina que encola, worker que guarda y cobra con un proveedor externo; webhook asíncrono de vuelta." })],
  },
]);
