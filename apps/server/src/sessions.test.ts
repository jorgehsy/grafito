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
const rec = (id: string, extra: object = {}) => ({ version: 1, id, startedAt: new Date(2026, 0, 2, 3, 4, 5).getTime(), requests: [{ n: 1 }], transcript: [], totals: { requests: 1, costUsd: 0.25 }, ...extra });

let dir: string;
beforeEach(async () => { dir = join(await mkdtemp(join(tmpdir(), "grafito-")), "pruebas"); });
afterEach(async () => { await rm(join(dir, ".."), { recursive: true, force: true }); });

describe("sesiones guardadas", () => {
  it("crea la carpeta y escribe con marca de tiempo; mismo id sobrescribe", async () => {
    const h = createSessionsHandlers(dir);
    let r = fakeRes();
    await h.save({ body: rec("abc") } as any, r);
    expect(r.body.file).toBe("2026-01-02_03-04-05_abc.json");
    r = fakeRes();
    await h.save({ body: rec("abc", { startedAt: 5, requests: [{ n: 1 }, { n: 2 }] }) } as any, r);
    expect(await readdir(dir)).toEqual(["2026-01-02_03-04-05_abc.json"]);
    expect(JSON.parse(await readFile(join(dir, r.body.file), "utf8")).requests).toHaveLength(2);
  });
  it("rechaza registros inválidos e ids con ruta", async () => {
    const h = createSessionsHandlers(dir);
    for (const body of [null, { version: 2 }, rec("../x"), rec("a/b"), rec("abc", { requests: "no" })]) {
      const r = fakeRes();
      await h.save({ body } as any, r);
      expect(r.code).toBe(400);
    }
    await expect(readdir(dir)).rejects.toThrow(); // nada se creó
  });
  it("lista y lee; rechaza traversal", async () => {
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
  it("lista vacía si la carpeta no existe", async () => {
    const l = fakeRes();
    await createSessionsHandlers(join(dir, "nada")).list({} as any, l);
    expect(l.body).toEqual([]);
  });
});
