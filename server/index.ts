import { config } from "dotenv";
// La key del .env manda sobre la que venga del shell (p. ej. ~/.bash_profile).
config({ override: true });
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
app.listen(port, () => console.log(`[grafito] servidor en http://localhost:${port}`));
