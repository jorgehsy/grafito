// Serving the built front (apps/web/dist) from the API server, so one port carries the page, the API and the
// room sockets: what a single tunnel needs (`pnpm share`). In dev the front is Vite's and this is not mounted.
import express from "express";
import type { RequestHandler } from "express";
import { existsSync, realpathSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_WEB_DIST = resolve(fileURLToPath(new URL("../../web/dist", import.meta.url)));

/** Whether a built front is there to serve. */
export const hasWebBuild = (dist: string = DEFAULT_WEB_DIST) => existsSync(resolve(dist, "index.html"));

const isApi = (path: string) => /^\/api(\/|$)/i.test(path);

function decoded(path: string): string | null {
  try { return decodeURIComponent(path); } catch { return null; }
}

/**
 * Two handlers, mounted after the API routes:
 * - `files` serves what is in `dist` and nothing above it. `express.static` resolves the path inside its root
 *   and refuses `..` segments, encoded or not; dotfiles are never served. A link inside `dist` that points
 *   out of it is not followed: the file's real path must be inside the real `dist`.
 * - `page` answers any other GET that looks like a page (no file extension, not /api) with index.html, so
 *   `/?room=<id>` and a reload anywhere open the app. A path that names a file that is not there is a 404, and
 *   so is anything with `..` or a NUL in it, before it gets near the file system.
 */
export function createWebHandlers(dist: string = DEFAULT_WEB_DIST): { files: RequestHandler; page: RequestHandler } {
  const root = resolve(dist);
  const serve = express.static(root, {
    index: false, dotfiles: "ignore", redirect: false, fallthrough: true,
    setHeaders(res, file) {
      // Vite's hashed assets never change; everything else is asked for again
      res.setHeader("Cache-Control", /[/\\]assets[/\\]/.test(file) ? "public, max-age=31536000, immutable" : "no-cache");
    },
  });
  let realRoot = root;
  try { realRoot = realpathSync(root); } catch { /* no dist yet: nothing will be found in it */ }
  const files: RequestHandler = (req, res, next) => {
    if (isApi(req.path)) return next();
    const path = decoded(req.path);
    if (path === null || path.includes("\0")) return next();
    // where the request points once links are followed; a file that is not there is `page`'s to answer
    realpath(resolve(root, "." + path)).then(
      (real) => (real === realRoot || real.startsWith(realRoot + sep) ? serve(req, res, next) : void res.status(404).type("text/plain").send("Not found\n")),
      () => next(),
    );
  };
  const page: RequestHandler = (req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || isApi(req.path)) return next();
    const path = decoded(req.path);
    if (path === null || path.includes("\0") || path.split(/[/\\]/).includes("..") || /\.[A-Za-z0-9]+$/.test(path)) return void res.status(404).type("text/plain").send("Not found\n");
    res.setHeader("Cache-Control", "no-store");
    res.sendFile("index.html", { root });
  };
  return { files, page };
}
