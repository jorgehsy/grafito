import { op } from "@grafito/contract";
import { timeline } from "@grafito/board";

/** Dictado H: el modelo de datos de una tienda (zona data: entidades con campos y relaciones con cardinalidad). */
export const dataModel = timeline([
  {
    text: "quiero mostrar el modelo de datos de la tienda. partimos por los usuarios: cada uno tiene un id, un correo y un nombre.",
    ops: [
      op.create_zone({ id: "tienda", kind: "data", title: "Modelo de datos de la tienda" }),
      op.add_entity({ zone: "tienda", id: "users", name: "users", fields: [{ name: "id", type: "uuid", key: "pk" }, { name: "email", type: "text" }, { name: "name", type: "text" }] }),
      op.update_summary({ text: "El modelo de datos de la tienda parte por los usuarios." }),
    ],
  },
  {
    text: "un usuario hace muchos pedidos. cada pedido guarda a qué usuario pertenece, su estado y el total.",
    ops: [
      op.add_entity({ zone: "tienda", id: "orders", name: "orders", fields: [{ name: "id", type: "uuid", key: "pk" }, { name: "user_id", type: "uuid", key: "fk" }, { name: "status", type: "text" }, { name: "total", type: "numeric" }] }),
      op.relate({ id: "r_user_orders", from: "users", to: "orders", cardinality: "one_to_many", label: "hace" }),
      op.update_summary({ text: "Un usuario hace muchos pedidos; cada pedido guarda su usuario, estado y total." }),
    ],
  },
  {
    text: "por otro lado están los productos, con su nombre, su precio y el stock que queda.",
    ops: [
      op.add_entity({ zone: "tienda", id: "products", name: "products", fields: [{ name: "id", type: "uuid", key: "pk" }, { name: "name", type: "text" }, { name: "price", type: "numeric" }, { name: "stock", type: "int" }] }),
      op.update_summary({ text: "Usuarios con muchos pedidos, y productos con nombre, precio y stock." }),
    ],
  },
  {
    text: "un pedido tiene muchos productos y un producto está en muchos pedidos, así que entre los dos va una tabla intermedia, las líneas del pedido, con la cantidad.",
    ops: [
      op.add_entity({ zone: "tienda", id: "order_items", name: "order_items", fields: [{ name: "order_id", type: "uuid", key: "fk" }, { name: "product_id", type: "uuid", key: "fk" }, { name: "quantity", type: "int" }] }),
      op.relate({ id: "r_order_items", from: "orders", to: "order_items", cardinality: "one_to_many", label: "tiene" }),
      op.relate({ id: "r_items_product", from: "order_items", to: "products", cardinality: "many_to_one" }),
      op.update_summary({ text: "Pedidos y productos se relacionan muchos a muchos a través de las líneas del pedido." }),
    ],
  },
  {
    text: "ojo, que la línea también guarda el precio al momento de comprar, porque el precio del producto puede cambiar después.",
    ops: [
      op.set_fields({ id: "order_items", fields: [{ name: "order_id", type: "uuid", key: "fk" }, { name: "product_id", type: "uuid", key: "fk" }, { name: "quantity", type: "int" }, { name: "unit_price", type: "numeric" }] }),
      op.add_callout({ id: "nota_precio", target: "order_items", text: "precio al comprar" }),
      op.update_summary({ text: "Modelo de la tienda: usuarios, pedidos, líneas del pedido (con el precio al comprar) y productos." }),
    ],
  },
]);
