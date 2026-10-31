export type BoardMode = "content" | "instruction";

// User text sent to the model. Pure so it can be tested.
// Spanish on purpose: prompt text, translated with the English prompt ticket.
export function buildUserText(a: { board?: unknown; summary?: unknown; delta: string; shape?: unknown; mode?: BoardMode }): string {
  const boardText = typeof a.board === "string" && a.board.trim() ? a.board : "(tablero vacío)";
  const summary = a.summary || "(vacío)";
  if (a.mode === "instruction") {
    return `TABLERO ACTUAL:\n${boardText}\n\nRESUMEN HASTA AHORA:\n${summary}\n\nINSTRUCCIÓN DEL USUARIO (es una orden sobre el tablero, no contenido para dibujar):\n${a.delta}`;
  }
  const hint = a.shape && a.shape !== "auto" ? `\n\nForma preferida para zonas nuevas: ${a.shape}.` : "";
  return `TABLERO ACTUAL:\n${boardText}\n\nRESUMEN HASTA AHORA:\n${summary}\n\nNUEVO FRAGMENTO DICHO:\n${a.delta}${hint}`;
}
