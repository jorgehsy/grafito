// Saca del zip oficial de iconos de AWS los servicios de la lista curada, los limpia y los
// escribe en src/iconos/aws/. Todo o nada: si falta alguno, lista los que faltan y no escribe nada.
// Uso: npm run iconos:aws <ruta-al-zip>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AWS_RAIZ_PAQUETE, SERVICIOS_AWS } from "../src/iconos/aws/servicios";

const DESTINO_POR_DEFECTO = resolve(dirname(fileURLToPath(import.meta.url)), "../src/iconos/aws");

// Quita el prólogo <?xml?>, el width/height fijos de la raíz y prefija con `<id>-` los id internos
// (se repiten entre iconos) junto con sus referencias url(#..) y href="#..". No cambia el aspecto.
export function limpiarSvg(svg: string, id: string): string {
  let s = svg.replace(/^﻿/, "").replace(/<\?xml[\s\S]*?\?>/g, "").trim();
  s = s.replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(?:width|height)=("[^"]*"|'[^']*')/g, ""));
  const ids = new Set<string>();
  for (const m of s.matchAll(/\sid=(?:"([^"]*)"|'([^']*)')/g)) ids.add(m[1] ?? m[2]);
  if (ids.size === 0) return s;
  const alt = [...ids].map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const p = `${id}-`;
  return s
    .replace(/(\sid=)(["'])(.*?)\2/g, (m, a, q, v) => (ids.has(v) ? `${a}${q}${p}${v}${q}` : m))
    .replace(new RegExp(`url\\((["']?)#(${alt})\\1\\)`, "g"), (_m, q, v) => `url(${q}#${p}${v}${q})`)
    .replace(new RegExp(`(href=)(["'])#(${alt})\\2`, "g"), (_m, a, q, v) => `${a}${q}#${p}${v}${q}`);
}

export type ResultadoInstalacion = { ok: true; escritos: number } | { ok: false; faltan: string[] };

// Usa el `unzip` del sistema (sin dependencias nuevas).
export function instalarIconos(zip: string, destino: string = DESTINO_POR_DEFECTO): ResultadoInstalacion {
  const listado = new Set(
    execFileSync("unzip", ["-Z1", zip], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").map((l) => l.trim()),
  );
  const faltan = SERVICIOS_AWS.filter((s) => !listado.has(AWS_RAIZ_PAQUETE + s.archivo)).map((s) => `${s.id} (${s.archivo})`);
  if (faltan.length) return { ok: false, faltan };

  // Se lee y limpia todo en memoria antes de tocar el disco.
  const limpios = SERVICIOS_AWS.map((s) => {
    const crudo = execFileSync("unzip", ["-p", zip, AWS_RAIZ_PAQUETE + s.archivo], { encoding: "utf8" });
    return { id: s.id, svg: limpiarSvg(crudo, s.id) + "\n" };
  });

  mkdirSync(destino, { recursive: true });
  // Que la carpeta nunca quede mezclada entre versiones del paquete.
  for (const f of readdirSync(destino)) if (f.endsWith(".svg")) rmSync(join(destino, f));
  for (const { id, svg } of limpios) writeFileSync(join(destino, `${id}.svg`), svg);
  return { ok: true, escritos: limpios.length };
}

// Sólo corre como comando, no al importarlo desde las pruebas.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const zip = process.argv[2];
  if (!zip) {
    console.error("Uso: npm run iconos:aws <ruta-al-zip>");
    process.exit(1);
  }
  if (!existsSync(zip)) {
    console.error(`No existe el zip: ${zip}`);
    process.exit(1);
  }
  const r = instalarIconos(zip);
  if (!r.ok) {
    console.error(`Faltan ${r.faltan.length} servicio(s) en el zip; no se escribió nada:`);
    for (const f of r.faltan) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`Listo: ${r.escritos} iconos en ${DESTINO_POR_DEFECTO}`);
}
