// Saved sessions: POST/GET /api/sessions, stored as sessions/<YYYY-MM-DD_HH-mm-ss>_<id>.json (never outside that folder).
import type { Request, Response } from "express";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRecord } from "@grafito/contract";

export const DEFAULT_DIR = resolve(fileURLToPath(new URL("..", import.meta.url)), "sessions");
const FILE_RE = /^[A-Za-z0-9_-]+\.json$/;
const MAX_BYTES = 8 * 1024 * 1024;

const pad = (n: number) => String(n).padStart(2, "0");
export const fileTimestamp = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
};

export function createSessionsHandlers(dir: string = DEFAULT_DIR) {
  const root = resolve(dir);
  const inside = (p: string) => p.startsWith(root + sep);

  async function existing(id: string): Promise<string | null> {
    try {
      return (await readdir(root)).find((f) => f.endsWith(`_${id}.json`)) ?? null;
    } catch { return null; }
  }

  async function save(req: Request, res: Response) {
    const parsed = parseRecord(req.body);
    if (!parsed.ok) return void res.status(400).json({ error: parsed.error });
    // The parsed record, not the body: a record id is safe in a file name, and unknown keys are dropped.
    const rec = parsed.record;
    const body = JSON.stringify(rec, null, 2);
    if (Buffer.byteLength(body) > MAX_BYTES) return void res.status(413).json({ error: "Record too large" });
    try {
      await mkdir(root, { recursive: true });
      const file = (await existing(rec.id)) ?? `${fileTimestamp(rec.startedAt)}_${rec.id}.json`;
      const path = resolve(root, file);
      if (!inside(path)) return void res.status(400).json({ error: "Invalid path" });
      await writeFile(path, body);
      res.json({ ok: true, file });
    } catch (e: any) {
      res.status(500).json({ error: "Could not save: " + e.message });
    }
  }

  async function list(_req: Request, res: Response) {
    let files: string[] = [];
    try { files = (await readdir(root)).filter((f) => FILE_RE.test(f)); } catch { /* directory does not exist yet */ }
    const out: { file: string; startedAt: number; requests: number; costUsd: number }[] = [];
    for (const file of files) {
      try {
        const r = JSON.parse(await readFile(join(root, file), "utf8"));
        out.push({ file, startedAt: r.startedAt, requests: r.requests?.length ?? 0, costUsd: r.totals?.costUsd ?? 0 });
      } catch { /* foreign or corrupt file: skip it */ }
    }
    out.sort((a, b) => b.startedAt - a.startedAt);
    res.json(out);
  }

  async function get(req: Request, res: Response) {
    const file = String(req.params.file ?? "");
    const path = resolve(root, file);
    if (!FILE_RE.test(file) || !inside(path)) return void res.status(400).json({ error: "Invalid file name" });
    try {
      res.type("json").send(await readFile(path, "utf8"));
    } catch {
      res.status(404).json({ error: "Not found" });
    }
  }

  return { save, list, get };
}
