export type BoardMode = "content" | "instruction";

// User text sent to the model. Pure so it can be tested. The headers are named in the system prompt.
export function buildUserText(a: { board?: unknown; summary?: unknown; delta: string; shape?: unknown; mode?: BoardMode }): string {
  const boardText = typeof a.board === "string" && a.board.trim() ? a.board : "(empty board)";
  const summary = a.summary || "(empty)";
  if (a.mode === "instruction") {
    return `CURRENT BOARD:\n${boardText}\n\nSUMMARY SO FAR:\n${summary}\n\nUSER INSTRUCTION (a command about the board, not content to draw):\n${a.delta}`;
  }
  const hint = a.shape && a.shape !== "auto" ? `\n\nPreferred shape for new zones: ${a.shape}.` : "";
  return `CURRENT BOARD:\n${boardText}\n\nSUMMARY SO FAR:\n${summary}\n\nNEW SPOKEN FRAGMENT:\n${a.delta}${hint}`;
}
