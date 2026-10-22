// Pruebas guardadas: POST/GET /api/sessions en pruebas/<YYYY-MM-DD_HH-mm-ss>_<id>.json (nunca fuera de esa carpeta).
import type { Request, Response } from "express";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)), "pruebas");
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FILE_RE = /^[A-Za-z0-9_-]+\.json$/;
const MAX_BYTES = 8 * 1024 * 1024;

const pad = (n: number) => String(n).padStart(2, "0");
export const stamp = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
};

/** Valida lo mínimo; devuelve el motivo del rechazo o null. */
export function validateRecord(r: any): string | null {
  if (!r || typeof r !== "object" || Array.isArray(r)) return "El registro debe ser un objeto";
  if (r.version !== 1) return "version debe ser 1";
  if (typeof r.id !== "string" || !ID_RE.test(r.id)) return "id inválido";
  if (typeof r.startedAt !== "number" || !Number.isFinite(r.startedAt)) return "startedAt inválido";
  if (!Array.isArray(r.requests)) return "requests debe ser una lista";
  if (r.transcript !== undefined && !Array.isArray(r.transcript)) return "transcript debe ser una lista";
  return null;
}

export function createSessionsHandlers(dir: string = DEFAULT_DIR) {
  const root = resolve(dir);
  const inside = (p: string) => p.startsWith(root + sep);

  async function existing(id: string): Promise<string | null> {
    try {
      return (await readdir(root)).find((f) => f.endsWith(`_${id}.json`)) ?? null;
    } catch { return null; }
  }

  async function save(req: Request, res: Response) {
    const rec = req.body;
    const bad = validateRecord(rec);
    if (bad) return void res.status(400).json({ error: bad });
    const body = JSON.stringify(rec, null, 2);
    if (Buffer.byteLength(body) > MAX_BYTES) return void res.status(413).json({ error: "Registro demasiado grande" });
    try {
      await mkdir(root, { recursive: true });
      const file = (await existing(rec.id)) ?? `${stamp(rec.startedAt)}_${rec.id}.json`;
      const path = resolve(root, file);
      if (!inside(path)) return void res.status(400).json({ error: "Ruta inválida" });
      await writeFile(path, body);
      res.json({ ok: true, file });
    } catch (e: any) {
      res.status(500).json({ error: "No se pudo guardar: " + e.message });
    }
  }

  async function list(_req: Request, res: Response) {
    let files: string[] = [];
    try { files = (await readdir(root)).filter((f) => FILE_RE.test(f)); } catch { /* aún no existe */ }
    const out: { file: string; startedAt: number; requests: number; costUsd: number }[] = [];
    for (const file of files) {
      try {
        const r = JSON.parse(await readFile(join(root, file), "utf8"));
        out.push({ file, startedAt: r.startedAt, requests: r.requests?.length ?? 0, costUsd: r.totals?.costUsd ?? 0 });
      } catch { /* archivo ajeno o corrupto: se omite */ }
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    res.json(out);
  }

  async function get(req: Request, res: Response) {
    const file = String(req.params.file ?? "");
    const path = resolve(root, file);
    if (!FILE_RE.test(file) || !inside(path)) return void res.status(400).json({ error: "Nombre de archivo inválido" });
    try {
      res.type("json").send(await readFile(path, "utf8"));
    } catch {
      res.status(404).json({ error: "No existe" });
    }
  }

  return { save, list, get };
}
