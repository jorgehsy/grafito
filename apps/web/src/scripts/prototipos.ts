import { op } from "@grafito/contract";
import { timeline } from "@grafito/board";

/** Dictado F: tipos de prototipo y lo que entrega cada uno (zona tree, de izquierda a derecha). */
export const prototipos = timeline([
  {
    text: "quiero explicar los tipos de prototipo que podemos hacer, porque no todos son iguales.",
    ops: [
      op.create_zone({ id: "arbol", kind: "tree", title: "Tipos de prototipo" }),
      op.add_branch({ zone: "arbol", id: "proto", label: "Prototipos" }),
      op.update_summary({ text: "Se van a explicar los tipos de prototipo." }),
    ],
  },
  {
    text: "hay dos tipos: el visual, que muestra cómo se ve la solución, y el de servicios, que prueba cómo se conectan los sistemas.",
    ops: [
      op.add_branch({ zone: "arbol", id: "visual", label: "Visual", parent: "proto", note: "cómo se ve" }),
      op.add_branch({ zone: "arbol", id: "servicios", label: "Servicios", parent: "proto", note: "cómo se conectan" }),
      op.update_summary({ text: "Hay dos tipos de prototipo: visual y de servicios." }),
    ],
  },
  {
    text: "el visual nos da dos cosas: un diseño en Figma y artefactos que se generan en Claude Code.",
    ops: [
      op.add_branch({ zone: "arbol", id: "figma", label: "Figma", parent: "visual" }),
      op.add_branch({ zone: "arbol", id: "artefactos", label: "Artefactos en Claude Code", parent: "visual" }),
      op.update_summary({ text: "El prototipo visual entrega Figma y artefactos en Claude Code." }),
    ],
  },
  {
    text: "y el de servicios nos entrega la especificación OpenAPI y una colección de Postman para probarla.",
    ops: [
      op.add_branch({ zone: "arbol", id: "openapi", label: "OpenAPI", parent: "servicios" }),
      op.add_branch({ zone: "arbol", id: "postman", label: "Postman Collection", parent: "servicios" }),
      op.update_summary({ text: "El prototipo de servicios entrega OpenAPI y una colección de Postman." }),
    ],
  },
]);
