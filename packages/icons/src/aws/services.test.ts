import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AWS_SERVICES } from "./services";

const FOLDER = dirname(fileURLToPath(import.meta.url));

describe("installed icons", () => {
  it.each(AWS_SERVICES.map((s) => s.id))("%s has its cleaned SVG", (id) => {
    const svg = readFileSync(join(FOLDER, `${id}.svg`), "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    const root = svg.match(/<svg\b[^>]*>/)![0];
    expect(root).toContain('viewBox="0 0 80 80"');
    expect(root).not.toMatch(/\s(width|height)=/);
    expect(svg).not.toContain("<?xml");
  });
});
