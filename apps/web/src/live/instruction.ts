// What is said after the wake word "Grafito" is an instruction for Claude, not content.
// Includes the spellings speech recognizers produce.
const WAKE = /(?<![\p{L}\p{N}_])(?:grafito|gráfito|grafitto)(?![\p{L}\p{N}_])[,:.!]*/iu;

export function hasWakeWord(text: string): boolean {
  return WAKE.test(text);
}

export function splitInstruction(text: string): { content: string; instruction: string } {
  const m = WAKE.exec(text);
  if (!m) return { content: text, instruction: "" };
  return {
    content: text.slice(0, m.index).trim(),
    instruction: text.slice(m.index + m[0].length).replace(/^[\s,:.;!¡]+/, "").trim(),
  };
}
