// Dictado simulado: suelta el texto frase a frase cada N ms.
export const splitSentences = (text: string): string[] =>
  text.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);

export function startDictation(
  text: string,
  getIntervalMs: () => number,
  onSentence: (s: string) => void,
  onEnd: () => void,
) {
  const sentences = splitSentences(text);
  let i = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const step = () => {
    if (stopped) return;
    if (i >= sentences.length) return onEnd();
    onSentence(sentences[i++]);
    timer = setTimeout(step, getIntervalMs());
  };
  step();
  return { stop() { stopped = true; if (timer) clearTimeout(timer); } };
}
