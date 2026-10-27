import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICIOS_AWS } from "./servicios";

const CARPETA = dirname(fileURLToPath(import.meta.url));

describe("iconos instalados", () => {
  it.each(SERVICIOS_AWS.map((s) => s.id))("%s tiene su SVG limpio", (id) => {
    const svg = readFileSync(join(CARPETA, `${id}.svg`), "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    const raiz = svg.match(/<svg\b[^>]*>/)![0];
    expect(raiz).toContain('viewBox="0 0 80 80"');
    expect(raiz).not.toMatch(/\s(width|height)=/);
    expect(svg).not.toContain("<?xml");
  });
});
