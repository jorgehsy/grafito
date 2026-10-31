import { config } from "dotenv";
import { fileURLToPath } from "node:url";
// The .env key wins over one inherited from the shell (e.g. ~/.bash_profile).
config({ override: true, path: fileURLToPath(new URL("../.env", import.meta.url)) });
import express from "express";
import { boardHandler, hasApiKey } from "./board";
import { createSessionsHandlers } from "./sessions";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.post("/api/board", boardHandler);
const sessions = createSessionsHandlers();
app.post("/api/sessions", sessions.save);
app.get("/api/sessions", sessions.list);
app.get("/api/sessions/:file", sessions.get);
app.get("/api/health", (_req, res) => res.json({ ok: true, hasKey: hasApiKey() }));

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`[grafito] server at http://localhost:${port}`));
