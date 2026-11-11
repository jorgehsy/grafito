import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { createServer, request } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { ROOM_KEY_PREFIX, ROOM_PROTOCOL } from "@grafito/contract";
import { RoomRegistry } from "./rooms/registry";
import { attachRoomSockets, createRoomsHandlers } from "./routes/rooms";
import { OWNER_COOKIE, bareErrors, createShareGuards, isLocalRequest, jsonBody, ownerLink, sameOrigin, shareFromEnv } from "./share";
import type { ShareConfig } from "./share";
import { createWebHandlers } from "./static";

// Share mode over a real ephemeral server, wired the way index.ts wires it: guards first, then the routes
// (stubs where the real ones would call Claude or touch files), then the built front.

let server: Server | undefined;
let tmp: string | undefined;
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  if (tmp) await rm(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const SECRET_FILE = "the owner's file, outside the front";

/** A built front in a temp folder, with a file beside it that must never be served. */
async function fakeDist(): Promise<string> {
  tmp = await mkdtemp(join(tmpdir(), "grafito-share-"));
  const dist = join(tmp, "dist");
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(join(dist, "index.html"), "<!doctype html><title>Grafito</title>");
  await writeFile(join(dist, "assets", "app-abc123.js"), "console.log('app')");
  await writeFile(join(dist, ".env"), "ANTHROPIC_API_KEY=sk-not-for-guests");
  await writeFile(join(tmp, "secret.txt"), SECRET_FILE);
  await writeFile(join(tmp, ".env"), SECRET_FILE);
  return dist;
}

interface Up { port: number; share: ShareConfig; registry: RoomRegistry; spent: string[]; logged: string[] }

const CONTROL = "control-".repeat(5);

async function listen(opts: { on?: boolean; publicUrl?: string | null; dist?: string; control?: boolean } = {}): Promise<Up> {
  const app = express();
  server = createServer(app);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const share: ShareConfig = shareFromEnv({ GRAFITO_SHARE: opts.on === false ? "0" : "1", GRAFITO_PUBLIC_URL: opts.publicUrl ?? undefined, GRAFITO_SHARE_CONTROL: opts.control ? CONTROL : undefined }, port);
  const logged: string[] = [];
  const guards = createShareGuards(share, (line) => void logged.push(line));
  const registry = new RoomRegistry({ clients: {}, dir: null });
  /** Every route that would have spent the key or touched the owner's files, had it run. */
  const spent: string[] = [];
  const stub = (name: string) => (_req: express.Request, res: express.Response) => { spent.push(name); res.json({ ran: name }); };

  app.use(guards.headers, guards.host);
  app.put("/api/share/public-url", guards.announce);
  app.use(guards.api);
  app.get("/api/owner", guards.claim);
  app.get("/api/share", guards.info);
  app.use(jsonBody());
  app.post("/api/boom", () => { throw new Error(`secret detail at ${import.meta.url}`); });
  app.post("/api/board", stub("board"));
  app.post("/api/architect", stub("architect"));
  app.post("/api/sessions", stub("sessions.save"));
  app.get("/api/sessions", stub("sessions.list"));
  app.get("/api/sessions/:file", stub("sessions.get"));
  app.get("/api/health", (_req, res) => void res.json({ ok: true }));
  const rooms = createRoomsHandlers(registry);
  app.post("/api/rooms", rooms.create);
  app.get("/api/rooms/:id", rooms.info);
  if (opts.dist) { const web = createWebHandlers(opts.dist); app.use(web.files, web.page); }
  app.use(bareErrors);
  attachRoomSockets(server, registry, { allow: guards.upgrade });
  return { port, share, registry, spent, logged };
}

interface Answer { status: number; headers: IncomingMessage["headers"]; body: string }

/** A request with the path and headers exactly as given: no URL normalising, any Host. */
function send(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { ...(body ? { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) } : {}), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

/** Opens the owner link and returns the cookie it sets. */
async function claimOwner(up: Up): Promise<string> {
  const res = await send(up.port, "GET", `/api/owner?k=${up.share.ownerSecret}`);
  expect(res.status).toBe(303);
  return String(res.headers["set-cookie"]?.[0]).split(";")[0];
}

describe("share mode: a guest gets the page and a room, nothing else", () => {
  it("refuses a guest every route that spends the key or touches the owner's files", async () => {
    const up = await listen();
    const attempts: [string, string][] = [
      ["POST", "/api/board"], ["POST", "/api/architect"], ["POST", "/api/sessions"], ["GET", "/api/sessions"],
      ["GET", "/api/sessions/2026-01-01_x.json"], ["POST", "/api/rooms"], ["GET", "/api/rooms/abcdefgh"],
      // Express matches routes without regard to case or a trailing slash: so must the guard
      ["POST", "/API/board"], ["POST", "/Api/Architect"], ["POST", "/api/board/"], ["GET", "/API/sessions"],
      // routes that do not exist are not the guest's either, and neither is a write anywhere
      ["GET", "/api/anything"], ["GET", "/api"], ["POST", "/"], ["DELETE", "/index.html"], ["PUT", "/api/rooms/abcdefgh"],
    ];
    for (const [method, path] of attempts) {
      const res = await send(up.port, method, path, {}, method === "GET" ? undefined : "{}");
      expect([method, path, res.status]).toEqual([method, path, 403]);
      expect(JSON.parse(res.body)).toMatchObject({ code: "owner_only" });
    }
    expect(up.spent).toEqual([]);
    expect(up.registry.size).toBe(0);
  });

  it("refuses before reading the body: a guest cannot make the server parse megabytes", async () => {
    const up = await listen();
    const res = await send(up.port, "POST", "/api/board", {}, "{ this is not JSON and would be a 400 if it were parsed");
    expect(res.status).toBe(403);
  });

  it("lets a guest ask what the server is, and tells them nothing about the tunnel or the owner", async () => {
    const up = await listen({ publicUrl: "https://quiet-river.trycloudflare.com" });
    const host = { Host: "quiet-river.trycloudflare.com" };
    expect((await send(up.port, "GET", "/api/health", host)).status).toBe(200);
    const info = await send(up.port, "GET", "/api/share", host);
    expect(JSON.parse(info.body)).toEqual({ share: true, owner: false, publicUrl: null });
    expect(info.body).not.toContain(up.share.ownerSecret);
  });

  it("a guest joins a room with its token, through the tunnel's host and origin", async () => {
    const up = await listen({ publicUrl: "https://quiet-river.trycloudflare.com" });
    const room = up.registry.create();
    const open = (headers: Record<string, string>, token = room.token) => new Promise<number | string>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${up.port}/api/rooms/${room.id}/ws?name=Eve`, [ROOM_PROTOCOL, ROOM_KEY_PREFIX + token], { headers });
      ws.on("message", (d) => { resolve(JSON.parse(d.toString()).t); ws.terminate(); });
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("close", (code) => resolve(code));
      ws.on("error", () => {});
    });
    const tunnel = { Host: "quiet-river.trycloudflare.com", Origin: "https://quiet-river.trycloudflare.com", "Cf-Connecting-Ip": "203.0.113.9" };
    expect(await open(tunnel)).toBe("hello");
    expect(await open(tunnel, "wrong-token-wrong-token-wrong-token")).toBe(4403);
    // a page on another site cannot open the socket, and neither can a request for a host this server is not
    expect(await open({ ...tunnel, Origin: "https://evil.example" })).toBe(403);
    expect(await open({ ...tunnel, Host: "evil.example", Origin: "https://evil.example" })).toBe(403);
  });
});

describe("share mode: the owner", () => {
  it("the owner link sets an HttpOnly, SameSite=Strict cookie and goes to the app", async () => {
    const up = await listen();
    expect(ownerLink(up.share)).toBe(`http://localhost:${up.port}/api/owner?k=${up.share.ownerSecret}`);
    const res = await send(up.port, "GET", `/api/owner?k=${up.share.ownerSecret}`);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe("/");
    expect(res.headers["set-cookie"]).toEqual([`${OWNER_COOKIE}=${up.share.cookieSecret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`]);
    // 32 random bytes each, and the cookie is not the secret the link showed
    expect(Buffer.from(up.share.ownerSecret, "base64url")).toHaveLength(32);
    expect(Buffer.from(up.share.cookieSecret, "base64url")).toHaveLength(32);
    expect(up.share.cookieSecret).not.toBe(up.share.ownerSecret);
    expect(String(res.headers["set-cookie"])).not.toContain(up.share.ownerSecret);
  });

  it("H2: what the terminal shows does not make anyone the owner: the link's secret is not the cookie, and works once", async () => {
    const up = await listen();
    const link = `/api/owner?k=${up.share.ownerSecret}`;
    // someone who read the link off the terminal sends its secret as the cookie: a guest, from anywhere
    const forged = { Cookie: `${OWNER_COOKIE}=${up.share.ownerSecret}` };
    expect((await send(up.port, "GET", "/api/sessions", forged)).status).toBe(403);
    expect((await send(up.port, "POST", "/api/board", forged, "{}")).status).toBe(403);
    const Cookie = await claimOwner(up);
    expect(up.share.claimed).toBe(true);
    expect(up.logged.join(" ")).toContain("will not work again");
    // the link is spent: opening it again, even on this machine, gives nothing
    const again = await send(up.port, "GET", link);
    expect(again.status).toBe(403);
    expect(again.headers["set-cookie"]).toBeUndefined();
    expect(again.body).toContain("Restart");
    // and the owner's browser still works
    expect((await send(up.port, "GET", "/api/sessions", { Cookie })).status).toBe(200);
    expect(up.spent).toEqual(["sessions.list"]);
  });

  it("H2: the owner cookie is honoured only on this machine: through the tunnel its holder is a guest", async () => {
    const up = await listen({ publicUrl: "https://quiet-river.trycloudflare.com" });
    const Cookie = await claimOwner(up);
    const tunnel = { Cookie, Host: "quiet-river.trycloudflare.com", "Cf-Connecting-Ip": "203.0.113.9", "Cf-Ray": "8a1b2c3d4e5f-MAD", "X-Forwarded-For": "203.0.113.9" };
    expect((await send(up.port, "GET", "/api/sessions", tunnel)).status).toBe(403);
    expect((await send(up.port, "POST", "/api/board", { ...tunnel, Origin: "https://quiet-river.trycloudflare.com" }, "{}")).status).toBe(403);
    expect((await send(up.port, "POST", "/api/rooms", { ...tunnel, Origin: "https://quiet-river.trycloudflare.com" }, "{}")).status).toBe(403);
    // each sign of the tunnel is enough on its own
    expect((await send(up.port, "GET", "/api/sessions", { Cookie, Host: "quiet-river.trycloudflare.com" })).status).toBe(403);
    expect((await send(up.port, "GET", "/api/sessions", { Cookie, "Cf-Connecting-Ip": "203.0.113.9" })).status).toBe(403);
    expect((await send(up.port, "GET", "/api/sessions", { Cookie, "X-Forwarded-For": "127.0.0.1" })).status).toBe(403);
    expect(JSON.parse((await send(up.port, "GET", "/api/share", tunnel)).body)).toEqual({ share: true, owner: false, publicUrl: null });
    expect(up.spent).toEqual([]);
    expect(up.registry.size).toBe(0);
    // on this machine, the same cookie is the owner
    expect((await send(up.port, "GET", "/api/sessions", { Cookie })).status).toBe(200);
  });

  it("with the cookie, everything works; with a wrong one, nothing does", async () => {
    const up = await listen({ publicUrl: "https://quiet-river.trycloudflare.com" });
    const Cookie = await claimOwner(up);
    const local = { Cookie, Origin: `http://127.0.0.1:${up.port}`, Host: `127.0.0.1:${up.port}` };
    expect((await send(up.port, "POST", "/api/board", local, "{}")).status).toBe(200);
    expect((await send(up.port, "POST", "/api/architect", local, "{}")).status).toBe(200);
    expect((await send(up.port, "GET", "/api/sessions", { Cookie })).status).toBe(200);
    const made = JSON.parse((await send(up.port, "POST", "/api/rooms", local, "{}")).body);
    expect(made).toMatchObject({ id: expect.any(String), token: expect.any(String) });
    expect(up.spent).toEqual(["board", "architect", "sessions.list"]);
    // only the owner is told where the tunnel is
    expect(JSON.parse((await send(up.port, "GET", "/api/share", { Cookie })).body)).toEqual({ share: true, owner: true, publicUrl: "https://quiet-river.trycloudflare.com" });

    for (const bad of [`${OWNER_COOKIE}=nope`, `${OWNER_COOKIE}=${up.share.cookieSecret}x`, `${OWNER_COOKIE}=`, `other=${up.share.cookieSecret}`, `x${OWNER_COOKIE}=${up.share.cookieSecret}`, `${OWNER_COOKIE}=${up.share.ownerSecret}`]) {
      expect((await send(up.port, "POST", "/api/board", { Cookie: bad }, "{}")).status).toBe(403);
    }
    expect(up.spent).toHaveLength(3);
  });

  it("another site cannot make the owner's browser act: a write needs this server's Origin", async () => {
    const up = await listen();
    const Cookie = await claimOwner(up);
    expect((await send(up.port, "POST", "/api/board", { Cookie, Origin: "https://evil.example" }, "{}")).status).toBe(403);
    expect((await send(up.port, "POST", "/api/rooms", { Cookie, Origin: "null" }, "{}")).status).toBe(403);
    expect(up.spent).toEqual([]);
    expect(up.registry.size).toBe(0);
  });

  it("the owner link does not work through the tunnel, even with the right secret", async () => {
    const up = await listen({ publicUrl: "https://quiet-river.trycloudflare.com" });
    const link = `/api/owner?k=${up.share.ownerSecret}`;
    const refused = async (headers: Record<string, string>, path = link) => {
      const res = await send(up.port, "GET", path, headers);
      expect(res.headers["set-cookie"]).toBeUndefined();
      return res.status;
    };
    // what cloudflared sends: the tunnel's Host and the edge's headers
    expect(await refused({ Host: "quiet-river.trycloudflare.com", "Cf-Connecting-Ip": "203.0.113.9", "X-Forwarded-For": "203.0.113.9", "Cf-Ray": "8a1b2c3d4e5f-MAD" })).toBe(403);
    // each sign on its own is enough: the Host alone, or any forwarding header with a local Host
    expect(await refused({ Host: "quiet-river.trycloudflare.com" })).toBe(403);
    for (const h of ["Cf-Connecting-Ip", "X-Forwarded-For", "Cf-Ray", "Cdn-Loop", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Real-Ip", "Forwarded", "Via"]) {
      expect([h, await refused({ [h]: "203.0.113.9" })]).toEqual([h, 403]);
    }
    // a host this server does not answer as is not even looked at
    expect(await refused({ Host: "evil.example" })).toBe(421);
    // and the wrong secret, or none, from this machine
    expect(await refused({}, "/api/owner?k=wrong")).toBe(403);
    expect(await refused({}, "/api/owner")).toBe(403);
    expect(await refused({}, `/api/owner?k=${up.share.ownerSecret}&k=${up.share.ownerSecret}`)).toBe(403);
  });

  it("refuses a request for a host it does not know (DNS rebinding)", async () => {
    const up = await listen({ publicUrl: "https://quiet-river.trycloudflare.com" });
    expect((await send(up.port, "GET", "/api/health", { Host: "attacker.example" })).status).toBe(421);
    expect((await send(up.port, "GET", "/api/health", { Host: `localhost:${up.port}` })).status).toBe(200);
    expect((await send(up.port, "GET", "/api/health", { Host: "quiet-river.trycloudflare.com" })).status).toBe(200);
  });
});

describe("S1: the share script tells the server the tunnel's address after opening it", () => {
  const put = (up: Up, query: string, headers: Record<string, string> = { "X-Grafito-Control": CONTROL }) => send(up.port, "PUT", `/api/share/public-url${query}`, headers);

  it("with the control secret, from this machine: a check that this is the server it started, then the address", async () => {
    const up = await listen({ control: true });
    expect((await put(up, "")).status).toBe(204);
    expect(up.share.publicUrl).toBeNull();
    expect((await put(up, "?url=" + encodeURIComponent("https://quiet-river.trycloudflare.com/"))).status).toBe(204);
    expect(up.share.publicUrl).toBe("https://quiet-river.trycloudflare.com");
    expect(up.logged.join(" ")).toContain("https://quiet-river.trycloudflare.com");
    // from then on the server answers to that name and its own, and to no other
    expect((await send(up.port, "GET", "/api/health", { Host: "quiet-river.trycloudflare.com" })).status).toBe(200);
    expect((await send(up.port, "GET", "/api/health", { Host: "attacker.example" })).status).toBe(421);
    // the address is set once
    expect((await put(up, "?url=https://other-name.trycloudflare.com")).status).toBe(409);
    expect((await put(up, "?url=https://quiet-river.trycloudflare.com")).status).toBe(204);
  });

  it("refuses anyone else: no secret, a wrong one, through the tunnel, or a server started by hand", async () => {
    const up = await listen({ control: true });
    const url = "?url=https://evil-name.trycloudflare.com";
    expect((await put(up, url, {})).status).toBe(403);
    expect((await put(up, url, { "X-Grafito-Control": CONTROL + "x" })).status).toBe(403);
    expect((await put(up, url, { "X-Grafito-Control": CONTROL, "Cf-Connecting-Ip": "203.0.113.9" })).status).toBe(403);
    expect((await put(up, url, { "X-Grafito-Control": CONTROL, Host: "evil-name.trycloudflare.com" })).status).toBe(403);
    expect((await put(up, "?url=javascript:alert(1)")).status).toBe(400);
    expect(up.share.publicUrl).toBeNull();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    const byHand = await listen();
    expect((await put(byHand, url)).status).toBe(403);
    expect((await put(byHand, url, { "X-Grafito-Control": "" })).status).toBe(403);
    expect(byHand.share.publicUrl).toBeNull();
  });
});

describe("L1: bodies and errors", () => {
  it("a guest's body is never read, on any path: a GET with megabytes of bad JSON is just a GET", async () => {
    const up = await listen({ dist: await fakeDist() });
    const junk = "{ not json " + "x".repeat(200_000);
    for (const path of ["/", "/some/page", "/api/health", "/api/share"]) {
      const res = await send(up.port, "GET", path, { "Content-Type": "application/json" }, junk);
      expect([path, res.status]).toEqual([path, 200]);
    }
  });

  it("a failed request is answered with its status and one word: no stack, no paths, no message", async () => {
    const up = await listen();
    const Cookie = await claimOwner(up);
    const local = { Cookie, Origin: `http://127.0.0.1:${up.port}` };
    const bad = await send(up.port, "POST", "/api/board", local, "{ not json");
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body)).toEqual({ error: "Bad request" });
    const big = await send(up.port, "POST", "/api/board", local, JSON.stringify({ x: "y".repeat(11 * 1024 * 1024) }));
    expect(big.status).toBe(413);
    expect(JSON.parse(big.body)).toEqual({ error: "Too large" });
    const boom = await send(up.port, "POST", "/api/boom", local, "{}");
    expect(boom.status).toBe(500);
    expect(JSON.parse(boom.body)).toEqual({ error: "Server error" });
    for (const res of [bad, big, boom]) {
      expect(res.body).not.toMatch(/\bat \S+:\d+|node_modules|file:\/\/|\/Users\/|secret detail|SyntaxError/);
    }
  });
});

describe("outside share mode nothing is guarded", () => {
  it("every route answers as before and no owner cookie is needed", async () => {
    const up = await listen({ on: false });
    expect((await send(up.port, "POST", "/api/board", {}, "{}")).status).toBe(200);
    expect((await send(up.port, "POST", "/api/rooms", { Origin: "http://192.168.1.20:5173" }, "{}")).status).toBe(200);
    expect(JSON.parse((await send(up.port, "GET", "/api/share")).body)).toEqual({ share: false, owner: true, publicUrl: null });
    const res = await send(up.port, "GET", "/api/health", { Host: "anything.example" });
    expect(res.status).toBe(200);
    expect(res.headers["referrer-policy"]).toBeUndefined();
  });
});

describe("isLocalRequest and sameOrigin", () => {
  const req = (remoteAddress: string, headers: Record<string, string>) => ({ socket: { remoteAddress }, headers }) as unknown as IncomingMessage;

  it("local is a loopback socket, a local Host and no forwarding header: all three", () => {
    expect(isLocalRequest(req("127.0.0.1", { host: "localhost:8790" }))).toBe(true);
    expect(isLocalRequest(req("::1", { host: "[::1]:8790" }))).toBe(true);
    expect(isLocalRequest(req("::ffff:127.0.0.1", { host: "127.0.0.1:8790" }))).toBe(true);
    expect(isLocalRequest(req("192.168.1.20", { host: "localhost:8790" }))).toBe(false);
    expect(isLocalRequest(req("127.0.0.1", { host: "x.trycloudflare.com" }))).toBe(false);
    expect(isLocalRequest(req("127.0.0.1", { host: "localhost.evil.example" }))).toBe(false);
    expect(isLocalRequest(req("127.0.0.1", { host: "localhost:8790", "cf-connecting-ip": "127.0.0.1" }))).toBe(false);
    expect(isLocalRequest(req("127.0.0.1", {}))).toBe(false);
  });

  it("an Origin must be this server; none passes", () => {
    expect(sameOrigin(req("127.0.0.1", { host: "localhost:8790" }))).toBe(true);
    expect(sameOrigin(req("127.0.0.1", { host: "localhost:8790", origin: "http://localhost:8790" }))).toBe(true);
    expect(sameOrigin(req("127.0.0.1", { host: "localhost:8790", origin: "http://localhost:5173" }))).toBe(false);
    expect(sameOrigin(req("127.0.0.1", { host: "localhost:8790", origin: "null" }))).toBe(false);
  });

  it("a public address that is not an http(s) URL is ignored", () => {
    expect(shareFromEnv({ GRAFITO_SHARE: "1", GRAFITO_PUBLIC_URL: "https://a.trycloudflare.com/x?y#z" }, 1).publicUrl).toBe("https://a.trycloudflare.com");
    expect(shareFromEnv({ GRAFITO_SHARE: "1", GRAFITO_PUBLIC_URL: "javascript:alert(1)" }, 1).publicUrl).toBeNull();
    expect(shareFromEnv({ GRAFITO_SHARE: "1", GRAFITO_PUBLIC_URL: "not a url" }, 1).publicUrl).toBeNull();
    expect(shareFromEnv({}, 1).on).toBe(false);
  });
});

describe("serving the built front on the same port", () => {
  it("serves the page at / and at a room link, its assets, and the security headers", async () => {
    const up = await listen({ dist: await fakeDist() });
    for (const path of ["/", "/?room=abcdefgh", "/some/page"]) {
      const res = await send(up.port, "GET", path);
      expect([path, res.status]).toEqual([path, 200]);
      expect(res.body).toContain("<title>Grafito</title>");
      expect(res.headers["cache-control"]).toBe("no-store");
      // the page's address is never sent on to another site
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-powered-by"]).toBeUndefined();
    }
    const asset = await send(up.port, "GET", "/assets/app-abc123.js");
    expect(asset.status).toBe(200);
    expect(asset.body).toBe("console.log('app')");
    expect(asset.headers["cache-control"]).toContain("immutable");
    expect(String(asset.headers["content-type"])).toContain("javascript");
  });

  it("a file that is not there is a 404, not the page; an unknown /api path is not the page either", async () => {
    const up = await listen({ dist: await fakeDist() });
    expect((await send(up.port, "GET", "/assets/missing.js")).status).toBe(404);
    expect((await send(up.port, "GET", "/favicon.ico")).status).toBe(404);
    const api = await send(up.port, "GET", "/api/nope", { Cookie: await claimOwner(up) });
    expect(api.status).toBe(404);
    expect(api.body).not.toContain("<title>Grafito</title>");
  });

  it("serves nothing from outside the front: path traversal, encoded or not, and dotfiles", async () => {
    const up = await listen({ dist: await fakeDist() });
    const attempts = [
      "/../secret.txt", "/../../secret.txt", "/assets/../../secret.txt", "/..%2fsecret.txt", "/..%2Fsecret.txt",
      "/%2e%2e/secret.txt", "/%2e%2e%2fsecret.txt", "/assets/%2e%2e/%2e%2e/secret.txt", "/..%5csecret.txt", "/assets/..\\..\\secret.txt",
      "/%252e%252e/secret.txt", "//secret.txt", "/....//secret.txt", "/assets/..%00/secret.txt", "/%c0%ae%c0%ae/secret.txt",
      "/..", "/../", "/%2e%2e", "/assets/..%2f..", "/.env", "/../.env", "/%2e%2e/.env", "/%2eenv", "/assets/../.env",
    ];
    for (const path of attempts) {
      const res = await send(up.port, "GET", path);
      expect([path, res.body.includes(SECRET_FILE), res.body.includes("sk-not-for-guests")]).toEqual([path, false, false]);
      expect([path, res.status === 404 || res.status === 403 || res.status === 400]).toEqual([path, true]);
    }
    // the owner gets no more than a guest from the file server
    const Cookie = await claimOwner(up);
    expect((await send(up.port, "GET", "/..%2fsecret.txt", { Cookie })).body).not.toContain(SECRET_FILE);
  });

  it("L3: does not follow a link out of the front: a file, or a folder, linked from inside dist", async () => {
    const dist = await fakeDist();
    await symlink(join(tmp!, "secret.txt"), join(dist, "linked.txt"));
    await symlink(join(tmp!, "secret.txt"), join(dist, "assets", "linked.js"));
    await symlink(tmp!, join(dist, "up"));
    // a link that stays inside is an ordinary file
    await symlink(join(dist, "assets", "app-abc123.js"), join(dist, "assets", "alias.js"));
    const up = await listen({ dist });
    for (const path of ["/linked.txt", "/assets/linked.js", "/up/secret.txt", "/up/.env"]) {
      const res = await send(up.port, "GET", path);
      expect([path, res.status, res.body.includes(SECRET_FILE)]).toEqual([path, 404, false]);
    }
    expect((await send(up.port, "GET", "/assets/alias.js")).body).toBe("console.log('app')");
    expect((await send(up.port, "GET", "/assets/app-abc123.js")).status).toBe(200);
  });
});
