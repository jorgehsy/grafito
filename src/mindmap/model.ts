// Modelo puro del mapa mental. Sin React.
export interface MMNode {
  id: string;
  label: string;
  parentId: string | null;
  notes: string[];
}
export interface MMLink {
  id: string;
  from: string;
  to: string;
  label?: string;
}
export interface MindMap {
  rootId: string | null;
  nodes: Record<string, MMNode>;
  links: MMLink[];
}

export type Op =
  | { type: "set_root"; label: string; id?: string }
  | { type: "add_node"; id: string; parent_id: string; label: string }
  | { type: "update_node"; id: string; label: string }
  | { type: "move_node"; id: string; new_parent_id: string }
  | { type: "delete_node"; id: string }
  | { type: "add_note"; node_id: string; text: string }
  | { type: "add_link"; from_id: string; to_id: string; label?: string }
  | { type: "update_summary"; text: string };

export const ROOT_ID = "root";

export const emptyMap = (): MindMap => ({ rootId: null, nodes: {}, links: [] });

export function children(map: MindMap, id: string): MMNode[] {
  return Object.values(map.nodes).filter((n) => n.parentId === id);
}

export function subtreeIds(map: MindMap, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    out.push(cur);
    for (const c of children(map, cur)) stack.push(c.id);
  }
  return out;
}

function isDescendant(map: MindMap, ancestor: string, candidate: string): boolean {
  return subtreeIds(map, ancestor).includes(candidate);
}

export interface ApplyResult {
  map: MindMap;
  warning?: string;
}

/** Aplica una operación. Devuelve el mapa (nuevo) y un aviso si la op era inválida. */
export function applyOp(map: MindMap, op: Op): ApplyResult {
  const bad = (w: string): ApplyResult => ({ map, warning: w });
  switch (op.type) {
    case "set_root": {
      if (!op.label?.trim()) return bad("set_root: etiqueta vacía");
      if (map.rootId && map.nodes[map.rootId]) {
        const root = map.nodes[map.rootId];
        return { map: { ...map, nodes: { ...map.nodes, [root.id]: { ...root, label: op.label } } } };
      }
      const id = ROOT_ID;
      return {
        map: { ...map, rootId: id, nodes: { ...map.nodes, [id]: { id, label: op.label, parentId: null, notes: [] } } },
      };
    }
    case "add_node": {
      if (!op.id || !op.label?.trim()) return bad("add_node: id o etiqueta vacíos");
      if (map.nodes[op.id]) return bad(`add_node: el id "${op.id}" ya existe`);
      if (!map.nodes[op.parent_id]) return bad(`add_node: padre desconocido "${op.parent_id}"`);
      return {
        map: { ...map, nodes: { ...map.nodes, [op.id]: { id: op.id, label: op.label, parentId: op.parent_id, notes: [] } } },
      };
    }
    case "update_node": {
      const n = map.nodes[op.id];
      if (!n) return bad(`update_node: id desconocido "${op.id}"`);
      if (!op.label?.trim()) return bad("update_node: etiqueta vacía");
      return { map: { ...map, nodes: { ...map.nodes, [op.id]: { ...n, label: op.label } } } };
    }
    case "move_node": {
      const n = map.nodes[op.id];
      if (!n) return bad(`move_node: id desconocido "${op.id}"`);
      if (op.id === map.rootId) return bad("move_node: no se puede mover la raíz");
      if (!map.nodes[op.new_parent_id]) return bad(`move_node: padre desconocido "${op.new_parent_id}"`);
      if (isDescendant(map, op.id, op.new_parent_id)) return bad("move_node: crearía un ciclo");
      return { map: { ...map, nodes: { ...map.nodes, [op.id]: { ...n, parentId: op.new_parent_id } } } };
    }
    case "delete_node": {
      if (!map.nodes[op.id]) return bad(`delete_node: id desconocido "${op.id}"`);
      if (op.id === map.rootId) return bad("delete_node: no se puede borrar la raíz");
      const gone = new Set(subtreeIds(map, op.id));
      const nodes = { ...map.nodes };
      gone.forEach((i) => delete nodes[i]);
      return { map: { ...map, nodes, links: map.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)) } };
    }
    case "add_note": {
      const n = map.nodes[op.node_id];
      if (!n) return bad(`add_note: id desconocido "${op.node_id}"`);
      if (!op.text?.trim()) return bad("add_note: texto vacío");
      if (n.notes.includes(op.text)) return bad("add_note: nota duplicada");
      return { map: { ...map, nodes: { ...map.nodes, [n.id]: { ...n, notes: [...n.notes, op.text] } } } };
    }
    case "add_link": {
      if (!map.nodes[op.from_id]) return bad(`add_link: origen desconocido "${op.from_id}"`);
      if (!map.nodes[op.to_id]) return bad(`add_link: destino desconocido "${op.to_id}"`);
      if (op.from_id === op.to_id) return bad("add_link: origen y destino iguales");
      if (map.links.some((l) => l.from === op.from_id && l.to === op.to_id)) return bad("add_link: enlace duplicado");
      const id = `link-${op.from_id}-${op.to_id}`;
      return { map: { ...map, links: [...map.links, { id, from: op.from_id, to: op.to_id, label: op.label }] } };
    }
    case "update_summary":
      return { map }; // el resumen vive fuera del mapa (lo guarda el cliente)
    default:
      return bad(`op desconocida`);
  }
}
