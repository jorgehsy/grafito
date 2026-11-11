import { config } from "dotenv";
import { fileURLToPath } from "node:url";
// The .env key wins over one inherited from the shell (e.g. ~/.bash_profile).
config({ override: true, path: fileURLToPath(new URL("../.env", import.meta.url)) });
import express from "express";
import { createServer } from "node:http";
import { buildClients } from "./claude/clients";
import { createArchitectHandler } from "./routes/architect";
import { createBoardHandler } from "./routes/board";
import { createHealthHandler } from "./routes/health";
import { attachRoomSockets, createRoomsHandlers } from "./routes/rooms";
import { limitsFromEnv } from "./rooms/limits";
import { RoomRegistry } from "./rooms/registry";
import { createSessionsHandlers } from "./sessions";
import { bareErrors, createShareGuards, jsonBody, ownerLink, shareFromEnv } from "./share";
import { createWebHandlers, hasWebBuild } from "./static";

const port = Number(process.env.PORT ?? 8787);
// Share mode (`pnpm share`, ADR 0009): the server is reachable through a tunnel. These guards go first, before
// any body is read: a guest gets the page and a room they hold the token of; the rest is the owner's.
// Outside share mode they do nothing.
const share = shareFromEnv(process.env, port);
const guards = createShareGuards(share, (line) => console.log(`[grafito] ${line}`));
const limits = limitsFromEnv(process.env, { share: share.on });
// Shared, nothing about this machine goes out in an error: Express answers with stacks unless told it is production.
if (share.on) process.env.NODE_ENV = "production";

const app = express();
app.disable("x-powered-by");
app.use(guards.headers, guards.host);
// `pnpm share` telling the server the tunnel's address: before the owner guard, with a secret of its own.
app.put("/api/share/public-url", guards.announce);
app.use(guards.api);
app.get("/api/owner", guards.claim);
app.get("/api/share", guards.info);
// Bodies are read only where there is one to read (a write under /api), and after the guards.
app.use(jsonBody());
// The subscription adapter is opt-in: it runs on the owner's Claude plan, not on the API key.
// It is off while shared: a room would run guests' requests on the owner's plan, which is for the owner only (ADR 0004, 0009).
const subscription = process.env.GRAFITO_SUBSCRIPTION === "1" && !share.on;
if (share.on && process.env.GRAFITO_SUBSCRIPTION === "1") console.warn("[grafito] plan models are off while sharing: GRAFITO_SUBSCRIPTION is for this machine's owner only");
const clients = buildClients({ apiKey: process.env.ANTHROPIC_API_KEY, subscription });
app.post("/api/board", createBoardHandler(clients));
app.post("/api/architect", createArchitectHandler(clients));
const sessions = createSessionsHandlers();
app.post("/api/sessions", sessions.save);
app.get("/api/sessions", sessions.list);
app.get("/api/sessions/:file", sessions.get);
app.get("/api/health", createHealthHandler(clients));
// Rooms: several people on one board. HTTP makes and finds them; each browser then holds a WebSocket.
const rooms = new RoomRegistry({ clients, limits });
const roomRoutes = createRoomsHandlers(rooms);
app.post("/api/rooms", roomRoutes.create);
app.get("/api/rooms/:id", roomRoutes.info);

// One port for everything: with a built front (apps/web/dist) and share mode or GRAFITO_STATIC=1, this server
// serves the page too. In dev the page is Vite's, which proxies /api here. Mounted last, after every API route.
const serveWeb = share.on || process.env.GRAFITO_STATIC === "1";
if (serveWeb && hasWebBuild()) {
  const web = createWebHandlers();
  app.use(web.files, web.page);
} else if (serveWeb) console.warn("[grafito] no built front in apps/web/dist: run `pnpm --filter @grafito/web build` (or `pnpm share`)");
// Last: a request that failed gets its status and one word, never a stack with this machine's paths.
app.use(bareErrors);

const server = createServer(app);
server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE" ? `[grafito] port ${port} is already in use` : `[grafito] server error: ${e.message}`);
  process.exit(1);
});
// Started by `pnpm share`: if that process is gone (killed, terminal closed), this one must not stay behind
// with a tunnel still pointing at it.
const parent = Number(process.env.GRAFITO_PARENT_PID);
if (share.on && Number.isInteger(parent) && parent > 1) {
  setInterval(() => {
    try { process.kill(parent, 0); } catch { console.error("[grafito] the share script is gone: stopping"); process.exit(0); }
  }, 2000).unref();
}
attachRoomSockets(server, rooms, { limits, allow: guards.upgrade });
// Shared, the server listens on this machine only: the tunnel connects from here, the local network does not.
const onListening = () => {
  if (!share.on) return void console.log(`[grafito] server at http://localhost:${port}`);
  console.log(`[grafito] share mode on port ${port} (this machine only)`);
  console.log(`[grafito] you, the owner, open this in your browser on this machine. It works once; restart for a new one: ${ownerLink(share)}`);
  console.log(share.publicUrl ? `[grafito] guests reach it at ${share.publicUrl}, and need a room link: press Collaborate, then Share` : "[grafito] no public address yet: nothing outside this machine reaches it");
};
if (share.on) server.listen(port, "127.0.0.1", onListening);
else server.listen(port, onListening);
