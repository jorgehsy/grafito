import { config } from "dotenv";
import { fileURLToPath } from "node:url";
// The .env key wins over one inherited from the shell (e.g. ~/.bash_profile).
config({ override: true, path: fileURLToPath(new URL("../.env", import.meta.url)) });
import express from "express";
import { buildClients } from "./claude/clients";
import { createBoardHandler } from "./routes/board";
import { createHealthHandler } from "./routes/health";
import { createSessionsHandlers } from "./sessions";

const app = express();
app.use(express.json({ limit: "10mb" }));
// The subscription adapter is opt-in: it runs on the owner's Claude plan, not on the API key.
const clients = buildClients({ apiKey: process.env.ANTHROPIC_API_KEY, subscription: process.env.GRAFITO_SUBSCRIPTION === "1" });
app.post("/api/board", createBoardHandler(clients));
const sessions = createSessionsHandlers();
app.post("/api/sessions", sessions.save);
app.get("/api/sessions", sessions.list);
app.get("/api/sessions/:file", sessions.get);
app.get("/api/health", createHealthHandler(clients));

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => console.log(`[grafito] server at http://localhost:${port}`));
