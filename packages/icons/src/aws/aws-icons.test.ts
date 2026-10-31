import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cleanSvg, installIcons } from "../../scripts/aws-icons";
import { AWS_PACKAGE_ROOT, AWS_SERVICES } from "./services";

describe("services", () => {
  it("there are 40, with unique ids and files", () => {
    expect(AWS_SERVICES).toHaveLength(40);
    expect(new Set(AWS_SERVICES.map((s) => s.id)).size).toBe(40);
    expect(new Set(AWS_SERVICES.map((s) => s.file)).size).toBe(40);
  });
});

describe("cleanSvg", () => {
  const raw = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="64px" height="64px" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs><clipPath id="clip-a"><rect width="80" height="80"/></clipPath><linearGradient id="g1"/></defs>
  <g clip-path="url(#clip-a)"><use xlink:href="#g1"/><use href="#clip-a"/><rect fill="url('#g1')" width="64" height="64"/></g>
</svg>`;

  it("strips the prolog and the root width/height, keeps the viewBox", () => {
    const s = cleanSvg(raw, "lambda");
    expect(s.startsWith("<svg")).toBe(true);
    expect(s).not.toContain("<?xml");
    const root = s.match(/<svg[^>]*>/)![0];
    expect(root).not.toMatch(/\swidth=/);
    expect(root).not.toMatch(/\sheight=/);
    expect(root).toContain('viewBox="0 0 80 80"');
    // width/height on inner elements are left alone
    expect(s).toContain('<rect width="80" height="80"/>');
  });

  it("prefixes internal ids and their references", () => {
    const s = cleanSvg(raw, "lambda");
    expect(s).toContain('id="lambda-clip-a"');
    expect(s).toContain('id="lambda-g1"');
    expect(s).toContain("url(#lambda-clip-a)");
    expect(s).toContain("url('#lambda-g1')");
    expect(s).toContain('xlink:href="#lambda-g1"');
    expect(s).toContain('href="#lambda-clip-a"');
    expect(s).not.toMatch(/["'(]#(clip-a|g1)\b/);
  });

  it("without internal ids it stays the same apart from the cleanup", () => {
    expect(cleanSvg('<svg width="1" viewBox="0 0 80 80"><rect/></svg>', "s3")).toBe('<svg viewBox="0 0 80 80"><rect/></svg>');
  });
});

describe("installIcons", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "aws-icons-"));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  // Builds a fake zip with the system `zip`; `omit` leaves those ids out.
  function fakeZip(omit: string[] = []): string {
    const src = join(tmp, "src");
    for (const s of AWS_SERVICES) {
      if (omit.includes(s.id)) continue;
      const filePath = join(src, AWS_PACKAGE_ROOT + s.file);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(
        filePath,
        `<?xml version="1.0"?><svg width="64" height="64" viewBox="0 0 80 80"><defs><clipPath id="c"/></defs><g clip-path="url(#c)"/></svg>`,
      );
    }
    const zip = join(tmp, "fake.zip");
    execFileSync("zip", ["-qr", zip, "."], { cwd: src });
    return zip;
  }

  it("a zip missing a service fails, lists the missing one and writes nothing", () => {
    const dest = join(tmp, "out");
    const r = installIcons(fakeZip(["lambda", "ses"]), dest);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing).toHaveLength(2);
      expect(r.missing[0]).toContain("lambda");
      expect(r.missing[1]).toContain("ses");
    }
    expect(existsSync(dest)).toBe(false);
  });

  it("a complete zip writes all 40 files, cleaned", () => {
    const dest = join(tmp, "out");
    const r = installIcons(fakeZip(), dest);
    expect(r).toEqual({ ok: true, written: 40 });
    expect(readdirSync(dest).filter((f) => f.endsWith(".svg"))).toHaveLength(40);
    const lambda = readFileSync(join(dest, "lambda.svg"), "utf8");
    expect(lambda).not.toContain("<?xml");
    expect(lambda).toContain('id="lambda-c"');
    expect(lambda).toContain("url(#lambda-c)");
  });
});
