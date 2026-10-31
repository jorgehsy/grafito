import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionsHandlers } from "./sessions";

const fakeRes = () => {
  const r: any = { code: 200, body: undefined };
  r.status = (c: number) => { r.code = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.type = () => r;
  r.send = (b: unknown) => { r.body = b; return r; };
  return r;
};
const request = (n: number) => ({
  n, model: "m", promptVersion: 1, batch: "t", mode: "content", startedAt: 0, firstOpMs: null, voiceFirstMs: null, totalMs: null,
  ops: [], warnings: [], usage: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }, costUsd: 0.25,
});
const rec = (id: string, extra: object = {}) => ({
  version: 2, id, startedAt: new Date(2026, 0, 2, 3, 4, 5).getTime(), updatedAt: 0, model: "m", shape: "auto", speechLang: "en-US",
  requests: [request(1)], transcript: [], summary: "", totals: { requests: 1, costUsd: 0.25, medianVoiceFirstMs: null }, ...extra,
});

let dir: string;
beforeEach(async () => { dir = join(await mkdtemp(join(tmpdir(), "grafito-")), "sessions"); });
afterEach(async () => { await rm(join(dir, ".."), { recursive: true, force: true }); });

describe("saved sessions", () => {
  it("creates the folder and writes with a timestamp; same id overwrites", async () => {
    const h = createSessionsHandlers(dir);
    let r = fakeRes();
    await h.save({ body: rec("abc") } as any, r);
    expect(r.body.file).toBe("2026-01-02_03-04-05_abc.json");
    r = fakeRes();
    await h.save({ body: rec("abc", { startedAt: 5, requests: [request(1), request(2)] }) } as any, r);
    expect(await readdir(dir)).toEqual(["2026-01-02_03-04-05_abc.json"]);
    expect(JSON.parse(await readFile(join(dir, r.body.file), "utf8")).requests).toHaveLength(2);
  });
  it("rejects invalid records and ids with a path", async () => {
    const h = createSessionsHandlers(dir);
    for (const body of [null, { version: 2 }, rec("abc", { version: 1 }), rec("../x"), rec("a/b"), rec("abc", { requests: "no" })]) {
      const r = fakeRes();
      await h.save({ body } as any, r);
      expect(r.code).toBe(400);
    }
    const old = fakeRes();
    await h.save({ body: rec("abc", { version: 1 }) } as any, old);
    expect(old.body.error).toBe("This session was saved by an older grafito and cannot be restored.");
    await expect(readdir(dir)).rejects.toThrow(); // nothing was created
  });
  it("lists and reads; rejects traversal", async () => {
    const h = createSessionsHandlers(dir);
    await h.save({ body: rec("uno") } as any, fakeRes());
    await h.save({ body: rec("dos", { startedAt: new Date(2026, 5, 1).getTime() }) } as any, fakeRes());
    await writeFile(join(dir, "nota.txt"), "x");
    const l = fakeRes();
    await h.list({} as any, l);
    expect(l.body.map((x: any) => x.requests)).toEqual([1, 1]);
    expect(l.body[0].file).toContain("_dos.json");
    expect(l.body[0].costUsd).toBe(0.25);
    const g = fakeRes();
    await h.get({ params: { file: l.body[1].file } } as any, g);
    expect(JSON.parse(g.body).id).toBe("uno");
    for (const file of ["../x", "..%2Fx.json", "../../etc/passwd", "a/b.json", "nota.txt"]) {
      const t = fakeRes();
      await h.get({ params: { file } } as any, t);
      expect(t.code).toBe(400);
    }
    const nf = fakeRes();
    await h.get({ params: { file: "no.json" } } as any, nf);
    expect(nf.code).toBe(404);
  });
  it("empty list if the folder does not exist", async () => {
    const l = fakeRes();
    await createSessionsHandlers(join(dir, "nada")).list({} as any, l);
    expect(l.body).toEqual([]);
  });
});
