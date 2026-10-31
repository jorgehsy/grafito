import { createRoot } from "react-dom/client";
import "@fontsource/kalam/400.css";
import "@fontsource/kalam/700.css";
import "./board.css";
import { BoardApp } from "./BoardApp";

createRoot(document.getElementById("root")!).render(<BoardApp />);
