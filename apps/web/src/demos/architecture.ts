import { op } from "@grafito/contract";
import { timeline } from "@grafito/board";

/** Dictation B: architecture of a web application with a queue, a worker and external payments. */
export const architecture = timeline([
  {
    text: "Let's go over the architecture of the order application, end to end.",
    ops: [
      op.create_zone({ id: "app", kind: "system", title: "Application architecture" }),
      op.update_summary({ text: "Order app architecture: web, API, queue, worker, database and external payments." }),
    ],
  },
  {
    text: "At the very top is the user, who comes in from a browser, on a computer or on a phone.",
    ops: [
      op.add_component({ zone: "app", id: "user", label: "User", type: "actor" }),
      op.add_component({ zone: "app", id: "web", label: "Browser", type: "client" }),
      op.connect({ id: "c1", from: "user", to: "web" }),
    ],
  },
  {
    text: "The browser talks to our API over HTTPS, which is a Node service.",
    ops: [
      op.add_component({ zone: "app", id: "api", label: "API", type: "service" }),
      op.connect({ id: "c2", from: "web", to: "api", label: "HTTPS" }),
    ],
  },
  {
    text: "The API saves the order straight to the database, which is MySQL.",
    ops: [
      op.add_component({ zone: "app", id: "db", label: "MySQL", type: "database" }),
      op.connect({ id: "c_api_db", from: "api", to: "db" }),
    ],
  },
  {
    text: "No, sorry, the database is actually Postgres, not MySQL.",
    ops: [op.update_label({ id: "db", label: "PostgreSQL" })],
  },
  {
    text: "And no, the API doesn't save anything directly either. All it does is leave the order on a queue.",
    ops: [
      op.delete({ id: "c_api_db" }),
      op.add_component({ zone: "app", id: "queue", label: "Order queue", type: "queue" }),
      op.connect({ id: "c3", from: "api", to: "queue", label: "enqueues" }),
    ],
  },
  {
    text: "On the other side of the queue there's a worker that reads the orders one at a time.",
    ops: [
      op.add_component({ zone: "app", id: "worker", label: "Worker", type: "service" }),
      op.connect({ id: "c4", from: "queue", to: "worker" }),
    ],
  },
  {
    text: "The worker is the one that saves to the database and handles everything slow.",
    ops: [op.connect({ id: "c5", from: "worker", to: "db", label: "saves" })],
  },
  {
    text: "To charge customers we use an external payment provider, which we don't control.",
    ops: [
      op.add_component({ zone: "app", id: "payments", label: "Payment provider", type: "external", icon: "💳" }),
      op.connect({ id: "c6", from: "worker", to: "payments", label: "charges" }),
    ],
  },
  {
    text: "When it finishes, it notifies us asynchronously with a webhook that reaches the API.",
    ops: [op.connect({ id: "c7", from: "payments", to: "api", label: "webhook", style: "dashed" })],
  },
  {
    text: "We generate the PDF invoices in the worker and leave them in a storage bucket.",
    ops: [
      op.add_component({ zone: "app", id: "invoices", label: "Invoice bucket", type: "storage" }),
      op.connect({ id: "c8", from: "worker", to: "invoices", label: "PDF" }),
    ],
  },
  {
    text: "The queue is the key piece: it absorbs order spikes, for example during sales.",
    ops: [
      op.emphasize({ target: "queue", style: "circle" }),
      op.add_callout({ id: "queue_note", target: "queue", text: "absorbs sales spikes" }),
    ],
  },
  {
    text: "Now let's see how a payment is processed, step by step.",
    ops: [op.create_zone({ id: "payment", kind: "flow", title: "How a payment is processed", place: { relation: "below", of: "app" } })],
  },
  {
    text: "The user confirms the order and the API creates a pending payment.",
    ops: [
      op.add_step({ zone: "payment", id: "s1", label: "The user confirms" }),
      op.add_step({ zone: "payment", id: "s2", label: "The API creates a pending payment", after: "s1" }),
      op.connect({ id: "x1", from: "s2", to: "api", style: "dashed" }),
    ],
  },
  {
    text: "The order goes through the queue and the worker calls the payment provider.",
    ops: [
      op.add_step({ zone: "payment", id: "s3", label: "The worker calls the provider", after: "s2" }),
      op.connect({ id: "x2", from: "s3", to: "payments" }),
    ],
  },
  {
    text: "If the payment is approved, we save the order as paid. If not, we retry a couple of times.",
    ops: [
      op.add_decision({ zone: "payment", id: "d1", question: "Payment approved?", after: "s3" }),
      op.add_step({ zone: "payment", id: "s4", label: "Save paid order" }),
      op.add_step({ zone: "payment", id: "s5", label: "Retry", icon: "🔁" }),
      op.connect({ id: "y1", from: "d1", to: "s4", label: "yes" }),
      op.connect({ id: "y2", from: "d1", to: "s5", label: "no" }),
      op.connect({ id: "x3", from: "s4", to: "db" }),
    ],
  },
  {
    text: "And I'm not sure what happens if the provider takes too long to respond, that needs checking.",
    ops: [op.mark_question({ target: "payments", text: "what about timeouts?" })],
  },
  {
    text: "Finally, when the order is saved we send a confirmation email and the invoice is generated.",
    ops: [
      op.add_step({ zone: "payment", id: "s6", label: "Email and invoice", icon: "✉️", after: "s4" }),
      op.connect({ id: "x4", from: "s6", to: "invoices", style: "dashed" }),
      op.emphasize({ target: "s4", style: "star" }),
    ],
  },
  {
    text: "The good thing about this design is that if the worker goes down, the orders wait in the queue and none are lost, they're just processed later.",
    ops: [op.add_callout({ id: "worker_note", target: "worker", text: "if it goes down, nothing is lost" })],
  },
  {
    text: "That's all: a thin API, a queue that buffers and a worker that does the heavy lifting.",
    ops: [op.update_summary({ text: "Thin API that enqueues, worker that saves and charges through an external provider; async webhook back." })],
  },
]);
