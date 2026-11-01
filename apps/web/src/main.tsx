import { createRoot } from "react-dom/client";
import "@fontsource/kalam/400.css";
import "@fontsource/kalam/700.css";
import "./board.css";
import { BoardApp } from "./BoardApp";

const root = createRoot(document.getElementById("root")!);

if (import.meta.env.DEV && new URLSearchParams(location.search).get("prototype") === "architect") {
  // Throwaway prototype (#36), dev only.
  void import("./prototype-architect").then((m) => root.render(<m.ArchitectPrototype />));
} else {
  root.render(<BoardApp />);
}
