// Palabra de activación: lo que se dice tras "Grafito" es una instrucción para Claude, no contenido.
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
