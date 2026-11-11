export type BoardMode = "content" | "instruction" | "sketch";

// User text sent to the model. Pure so it can be tested. The headers are named in the system prompt.
export function buildUserText(a: { board?: unknown; summary?: unknown; delta: string; shape?: unknown; mode?: BoardMode; sketch?: string }): string {
  const boardText = typeof a.board === "string" && a.board.trim() ? a.board : "(empty board)";
  const summary = a.summary || "(empty)";
  if (a.mode === "instruction") {
    return `CURRENT BOARD:\n${boardText}\n\nSUMMARY SO FAR:\n${summary}\n\nUSER INSTRUCTION (a command about the board, not content to draw):\n${a.delta}`;
  }
  if (a.mode === "sketch") {
    const caption = a.delta.trim() ? `\n\nWHAT THE USER SAID ABOUT IT:\n${a.delta.trim()}` : "";
    return `CURRENT BOARD:\n${boardText}\n\nSUMMARY SO FAR:\n${summary}\n\nUSER SKETCH (drawn by hand on the board; turn it into board elements):\n${a.sketch?.trim() || "(no description)"}${caption}`;
  }
  const hint = a.shape && a.shape !== "auto" ? `\n\nPreferred shape for new zones: ${a.shape}.` : "";
  return `CURRENT BOARD:\n${boardText}\n\nSUMMARY SO FAR:\n${summary}\n\nNEW SPOKEN FRAGMENT:\n${a.delta}${hint}`;
}
