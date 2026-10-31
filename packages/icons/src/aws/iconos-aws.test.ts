import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { limpiarSvg, instalarIconos } from "../../scripts/iconos-aws";
import { AWS_RAIZ_PAQUETE, SERVICIOS_AWS } from "./servicios";

describe("servicios", () => {
  it("son 40 con ids y archivos únicos", () => {
    expect(SERVICIOS_AWS).toHaveLength(40);
    expect(new Set(SERVICIOS_AWS.map((s) => s.id)).size).toBe(40);
    expect(new Set(SERVICIOS_AWS.map((s) => s.archivo)).size).toBe(40);
  });
});

describe("limpiarSvg", () => {
  const crudo = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="64px" height="64px" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs><clipPath id="clip-a"><rect width="80" height="80"/></clipPath><linearGradient id="g1"/></defs>
  <g clip-path="url(#clip-a)"><use xlink:href="#g1"/><use href="#clip-a"/><rect fill="url('#g1')" width="64" height="64"/></g>
</svg>`;

  it("quita el prólogo y el width/height de la raíz, conserva el viewBox", () => {
    const s = limpiarSvg(crudo, "lambda");
    expect(s.startsWith("<svg")).toBe(true);
    expect(s).not.toContain("<?xml");
    const raiz = s.match(/<svg[^>]*>/)![0];
    expect(raiz).not.toMatch(/\swidth=/);
    expect(raiz).not.toMatch(/\sheight=/);
    expect(raiz).toContain('viewBox="0 0 80 80"');
    // width/height de elementos internos no se tocan
    expect(s).toContain('<rect width="80" height="80"/>');
  });

  it("prefija los id internos y sus referencias", () => {
    const s = limpiarSvg(crudo, "lambda");
    expect(s).toContain('id="lambda-clip-a"');
    expect(s).toContain('id="lambda-g1"');
    expect(s).toContain("url(#lambda-clip-a)");
    expect(s).toContain("url('#lambda-g1')");
    expect(s).toContain('xlink:href="#lambda-g1"');
    expect(s).toContain('href="#lambda-clip-a"');
    expect(s).not.toMatch(/["'(]#(clip-a|g1)\b/);
  });

  it("sin id internos queda igual salvo la limpieza", () => {
    expect(limpiarSvg('<svg width="1" viewBox="0 0 80 80"><rect/></svg>', "s3")).toBe('<svg viewBox="0 0 80 80"><rect/></svg>');
  });
});

describe("instalarIconos", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "iconos-aws-"));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  // Arma un zip falso con el sistema `zip`; `omitir` deja fuera esos ids.
  function zipFalso(omitir: string[] = []): string {
    const src = join(tmp, "src");
    for (const s of SERVICIOS_AWS) {
      if (omitir.includes(s.id)) continue;
      const ruta = join(src, AWS_RAIZ_PAQUETE + s.archivo);
      mkdirSync(dirname(ruta), { recursive: true });
      writeFileSync(
        ruta,
        `<?xml version="1.0"?><svg width="64" height="64" viewBox="0 0 80 80"><defs><clipPath id="c"/></defs><g clip-path="url(#c)"/></svg>`,
      );
    }
    const zip = join(tmp, "falso.zip");
    execFileSync("zip", ["-qr", zip, "."], { cwd: src });
    return zip;
  }

  it("a un zip al que le falta un servicio: falla, lista el faltante y no escribe nada", () => {
    const destino = join(tmp, "salida");
    const r = instalarIconos(zipFalso(["lambda", "ses"]), destino);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.faltan).toHaveLength(2);
      expect(r.faltan[0]).toContain("lambda");
      expect(r.faltan[1]).toContain("ses");
    }
    expect(existsSync(destino)).toBe(false);
  });

  it("un zip completo escribe los 40 archivos, limpios", () => {
    const destino = join(tmp, "salida");
    const r = instalarIconos(zipFalso(), destino);
    expect(r).toEqual({ ok: true, escritos: 40 });
    expect(readdirSync(destino).filter((f) => f.endsWith(".svg"))).toHaveLength(40);
    const lambda = readFileSync(join(destino, "lambda.svg"), "utf8");
    expect(lambda).not.toContain("<?xml");
    expect(lambda).toContain('id="lambda-c"');
    expect(lambda).toContain("url(#lambda-c)");
  });
});
