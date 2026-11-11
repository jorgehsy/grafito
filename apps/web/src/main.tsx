import { createRoot } from "react-dom/client";
import "@fontsource/kalam/400.css";
import "@fontsource/kalam/700.css";
import "./ui/tokens.css";
import "./board.css";
import "./sketch/draw.css";
import "./room/room.css";
import "./architect/architect.css";
import "./script/script.css";
import { BoardApp } from "./BoardApp";

createRoot(document.getElementById("root")!).render(<BoardApp />);
