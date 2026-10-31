// Extracts the curated services from the official AWS icon zip, cleans them and writes them to
// src/aws/. All or nothing: if any is missing, lists the missing ones and writes nothing.
// Usage: pnpm icons:aws <path-to-zip>
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AWS_PACKAGE_ROOT, AWS_SERVICES } from "../src/aws/services";

const DEFAULT_DEST = resolve(dirname(fileURLToPath(import.meta.url)), "../src/aws");

// Strips the <?xml?> prolog and the fixed root width/height, and prefixes internal ids with `<id>-`
// (they repeat across icons) along with their url(#..) and href="#.." references. Looks the same.
export function cleanSvg(svg: string, id: string): string {
  let s = svg.replace(/^\uFEFF/, "").replace(/<\?xml[\s\S]*?\?>/g, "").trim();
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

export type InstallResult = { ok: true; written: number } | { ok: false; missing: string[] };

// Uses the system `unzip` (no new dependencies).
export function installIcons(zip: string, dest: string = DEFAULT_DEST): InstallResult {
  const listing = new Set(
    execFileSync("unzip", ["-Z1", zip], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").map((l) => l.trim()),
  );
  const missing = AWS_SERVICES.filter((s) => !listing.has(AWS_PACKAGE_ROOT + s.file)).map((s) => `${s.id} (${s.file})`);
  if (missing.length) return { ok: false, missing };

  // Everything is read and cleaned in memory before touching the disk.
  const cleaned = AWS_SERVICES.map((s) => {
    const raw = execFileSync("unzip", ["-p", zip, AWS_PACKAGE_ROOT + s.file], { encoding: "utf8" });
    return { id: s.id, svg: cleanSvg(raw, s.id) + "\n" };
  });

  mkdirSync(dest, { recursive: true });
  // Never leave the folder mixing icons from different package versions.
  for (const f of readdirSync(dest)) if (f.endsWith(".svg")) rmSync(join(dest, f));
  for (const { id, svg } of cleaned) writeFileSync(join(dest, `${id}.svg`), svg);
  return { ok: true, written: cleaned.length };
}

// Only runs as a command, not when imported from the tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const zip = process.argv[2];
  if (!zip) {
    console.error("Usage: pnpm icons:aws <path-to-zip>");
    process.exit(1);
  }
  if (!existsSync(zip)) {
    console.error(`Zip not found: ${zip}`);
    process.exit(1);
  }
  const r = installIcons(zip);
  if (!r.ok) {
    console.error(`${r.missing.length} service(s) missing from the zip; nothing was written:`);
    for (const f of r.missing) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`Done: ${r.written} icons in ${DEFAULT_DEST}`);
}
