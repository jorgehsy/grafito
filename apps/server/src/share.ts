// Share mode: the server is reachable from outside through a tunnel (`pnpm share`, ADR 0009). Two kinds of
// visitor then exist. The owner sits at this machine, opened the owner link the server printed, and may use
// everything. A guest came through the tunnel and may do exactly three things: load the page, ask what the
// server is (health, share info) and join a room whose invite token they hold. Everything else under /api
// spends the owner's API key or touches the owner's files, and is refused.
import express from "express";
import type { ErrorRequestHandler, Request, RequestHandler, Response } from "express";
import type { IncomingMessage } from "node:http";
import { newSecret, safeEqual } from "./secret";

export interface ShareConfig {
  /** Off: no guard at all, the server behaves as it always did (dev, your own network). */
  on: boolean;
  /**
   * What the owner link carries. Made at startup, shown only in this machine's terminal, and good for one
   * use: it is not what proves a browser is the owner's afterwards (that is `cookieSecret`).
   */
  ownerSecret: string;
  /** The owner cookie's value: made at startup, never printed, sent only in answer to the owner link. */
  cookieSecret: string;
  /** The owner link was used. It does not work again; a restart makes a new one. */
  claimed: boolean;
  /** The tunnel's address (`https://<name>.trycloudflare.com`), once the server was told. */
  publicUrl: string | null;
  /**
   * What `pnpm share` proves itself with when it tells the server the tunnel's address
   * (`GRAFITO_SHARE_CONTROL`); null when the server was started by hand.
   */
  control: string | null;
  port: number;
}

export const OWNER_COOKIE = "grafito_owner";

/** An http(s) address as an origin, or null. */
function originOf(raw: unknown): string | null {
  try {
    const u = typeof raw === "string" && raw ? new URL(raw) : null;
    return u && (u.protocol === "https:" || u.protocol === "http:") ? u.origin : null;
  } catch { return null; }
}

/** Share mode from the environment: `GRAFITO_SHARE=1`, and optionally `GRAFITO_PUBLIC_URL` (an http(s) origin). */
export function shareFromEnv(env: Record<string, string | undefined>, port: number): ShareConfig {
  const control = env.GRAFITO_SHARE_CONTROL && env.GRAFITO_SHARE_CONTROL.length >= 32 ? env.GRAFITO_SHARE_CONTROL : null;
  // 32 bytes each: nobody types these
  return { on: env.GRAFITO_SHARE === "1", ownerSecret: newSecret(32), cookieSecret: newSecret(32), claimed: false, publicUrl: originOf(env.GRAFITO_PUBLIC_URL), control, port };
}

/** The link the owner opens once in their browser: it sets the owner cookie and goes to the app. */
export const ownerLink = (share: ShareConfig) => `http://localhost:${share.port}/api/owner?k=${share.ownerSecret}`;

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Headers a proxy or a tunnel adds. `cloudflared` sends Cf-Connecting-Ip, Cf-Ray, Cdn-Loop and X-Forwarded-For on every request. */
const FORWARDED = ["cf-connecting-ip", "cf-ray", "cf-visitor", "cf-ipcountry", "cf-warp-tag-id", "cdn-loop", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "forwarded", "via"];

const hostName = (host: string | undefined) => (host ?? "").toLowerCase().replace(/:\d+$/, "");

/**
 * Whether a request was made on this machine, straight to the server. The tunnel also connects from
 * 127.0.0.1, so the socket address alone says nothing. A request that came through it differs in two ways a
 * remote sender cannot undo: its Host is the tunnel's name (Cloudflare routes on it, so it cannot be
 * "localhost"), and it carries the headers the edge adds (a sender can add headers, not remove these).
 * All three must hold. It gates the owner link and every use of the owner cookie, each on top of its secret.
 */
export function isLocalRequest(req: IncomingMessage): boolean {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? "")) return false;
  if (!LOCAL_NAMES.has(hostName(req.headers.host))) return false;
  return !FORWARDED.some((h) => req.headers[h] !== undefined);
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/**
 * Whether this request comes from the owner's browser: it was made on this machine, straight to the server,
 * and carries the owner cookie. Both, always: the cookie alone, sent through the tunnel, is a guest. So
 * whoever learns a secret (a screenshot of the terminal, a copied cookie) still cannot be the owner from
 * outside. Always true outside share mode.
 */
export function isOwner(share: ShareConfig, req: IncomingMessage): boolean {
  if (!share.on) return true;
  // both checks always run
  const local = isLocalRequest(req);
  const key = safeEqual(cookie(req, OWNER_COOKIE), share.cookieSecret);
  return local && key;
}

/** Whether `host` is one this server answers as: itself on this machine, or the tunnel. */
function knownHost(share: ShareConfig, host: string | undefined): boolean {
  const h = (host ?? "").toLowerCase();
  if (h === `localhost:${share.port}` || h === `127.0.0.1:${share.port}` || h === `[::1]:${share.port}`) return true;
  return !!share.publicUrl && h === new URL(share.publicUrl).host;
}

/**
 * Whether a request's `Origin` is this server. A page on another site that talks to this one sends its own
 * origin; a request with no Origin is not from a page (or is a plain navigation) and passes.
 */
export function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try { return new URL(origin).host.toLowerCase() === (req.headers.host ?? "").toLowerCase(); } catch { return false; }
}

/** What a guest may ask for under /api. Room sockets are upgrades, which never reach these handlers. */
const GUEST_API = new Set(["GET /api/health", "GET /api/share", "GET /api/owner"]);

/**
 * The guards share mode puts in front of every route; mount them first, before the body parser, so a refused
 * request is never read. Outside share mode each one lets everything through.
 * - `headers`: no referrer (the page URL may sit next to a room link), no framing, no sniffing.
 * - `host`: only requests addressed to this server by a name it knows (stops DNS rebinding); 421 otherwise.
 * - `api`: a guest may read pages and files, and under /api gets `GUEST_API` and nothing else (403); nothing
 *   a guest sends is ever a write. The owner also needs a matching Origin on anything that is not a read, so
 *   another site cannot make their browser do it.
 * - `claim`: `GET /api/owner?k=<secret>` from this machine sets the owner cookie and goes to the app, once.
 * - `announce`: `PUT /api/share/public-url[?url=<address>]`, how `pnpm share` tells the server the tunnel's
 *   address after opening it (and, without `url`, checks that the server on the port is the one it started).
 *   Mounted before `api`; it takes a request from this machine with the control secret, nothing else.
 * - `errors`: the last handler. A failed request is answered with its status and one word, never a stack.
 * - `info`: `GET /api/share` says whether the server is shared and whether you are the owner; only the owner
 *   is told the public address.
 */
export function createShareGuards(share: ShareConfig, log: (line: string) => void = () => {}) {
  const off: RequestHandler = (_req, _res, next) => next();

  const headers: RequestHandler = (_req, res, next) => {
    res.removeHeader("X-Powered-By");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    next();
  };

  const host: RequestHandler = (req, res, next) => {
    // without a public address to compare with, only what claims to be local is checked (by `claim`)
    if (!share.publicUrl || knownHost(share, req.headers.host)) return next();
    res.status(421).json({ error: "Unknown host" });
  };

  const api: RequestHandler = (req, res, next) => {
    // Express matches routes without regard to case: so does this
    const path = (req.baseUrl + req.path).toLowerCase();
    const read = req.method === "GET" || req.method === "HEAD";
    // A guest reads pages and files; everything under /api, and every request that is not a read, is the owner's.
    if (read && path !== "/api" && !path.startsWith("/api/")) return next();
    if (GUEST_API.has(`${req.method} ${path.replace(/\/+$/, "")}`)) return next();
    if (!isOwner(share, req)) return void res.status(403).json({ error: "Only the owner of this Grafito can do that: guests can only join a room they were invited to", code: "owner_only" });
    if (!read && !sameOrigin(req)) return void res.status(403).json({ error: "Cross-site request refused", code: "owner_only" });
    next();
  };

  function claim(req: Request, res: Response) {
    if (!share.on) return void res.redirect(303, "/");
    // both checks always run, so the answer does not say which one failed
    const local = isLocalRequest(req);
    const key = safeEqual(typeof req.query.k === "string" ? req.query.k : undefined, share.ownerSecret);
    if (!local || !key || share.claimed) return void res.status(403).type("text/plain").send("This link only works once, on the machine that runs Grafito. Restart `pnpm share` for a new one.\n");
    // One use: whoever sees the link later (the terminal's scrollback, a screenshot) has nothing.
    share.claimed = true;
    log("the owner link was used; it will not work again (restart for a new one)");
    // The cookie is another secret, not the link's. A week is longer than any run.
    res.setHeader("Set-Cookie", `${OWNER_COOKIE}=${share.cookieSecret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
    res.setHeader("Cache-Control", "no-store");
    res.redirect(303, "/");
  }

  function info(req: Request, res: Response) {
    const owner = isOwner(share, req);
    res.setHeader("Cache-Control", "no-store");
    res.json({ share: share.on, owner, publicUrl: owner ? share.publicUrl : null });
  }

  function announce(req: Request, res: Response) {
    const ok = share.on && share.control !== null && isLocalRequest(req) && safeEqual(req.headers["x-grafito-control"], share.control ?? "-");
    if (!ok) return void res.status(403).json({ error: "Refused", code: "owner_only" });
    if (req.query.url === undefined) return void res.status(204).end();
    const url = originOf(req.query.url);
    if (!url) return void res.status(400).json({ error: "Not an http(s) address" });
    // set once: the tunnel's address does not change while it is open
    if (share.publicUrl && share.publicUrl !== url) return void res.status(409).json({ error: "The public address is already set" });
    share.publicUrl = url;
    log(`guests reach it at ${url}, and need a room link: press Collaborate, then Share`);
    res.status(204).end();
  }

  /** For a WebSocket upgrade, which no middleware sees: a known host, and a page of this server (or no page at all). */
  const upgrade = (req: IncomingMessage): boolean =>
    !share.on || (sameOrigin(req) && (!share.publicUrl || knownHost(share, req.headers.host)));

  const guard = (h: RequestHandler): RequestHandler => (share.on ? h : off);
  return { headers: guard(headers), host: guard(host), api: guard(api), claim, info, announce, upgrade };
}

/**
 * The JSON body parser, for the requests that have a body to read: a POST, PUT or PATCH under /api. Mounted
 * after the guards, so in share mode only the owner's requests get this far; a GET never has its body read,
 * whoever sends it.
 */
export function jsonBody(limit = "10mb"): RequestHandler {
  const parse = express.json({ limit });
  return (req, res, next) => {
    const writes = req.method === "POST" || req.method === "PUT" || req.method === "PATCH";
    return writes && /^\/api(\/|$)/i.test(req.path) ? parse(req, res, next) : next();
  };
}

const STATUS_WORDS: Record<number, string> = { 400: "Bad request", 403: "Forbidden", 404: "Not found", 413: "Too large", 415: "Unsupported media type" };

/**
 * The last handler: what a request that failed is answered with. Express's own answer in development is the
 * error's stack, with this machine's paths in it. This one sends the status and one word.
 */
export const bareErrors: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const raw = Number((err as { status?: unknown; statusCode?: unknown })?.status ?? (err as { statusCode?: unknown })?.statusCode);
  const status = Number.isInteger(raw) && raw >= 400 && raw < 600 ? raw : 500;
  if (status >= 500) console.error(`[grafito] request failed: ${(err as Error)?.message ?? err}`);
  res.status(status).json({ error: STATUS_WORDS[status] ?? (status >= 500 ? "Server error" : "Bad request") });
};
