import { useEffect, useRef, useState } from "react";
import { WebSpeechSource } from "../speech/webSpeech";
import { createMicLock } from "../speech/micLock";
import type { SpeechSource, SpeechState } from "../speech/types";
import { useT } from "../../i18n";

interface MicOptions {
  lang: string;
  /** Live mode; the mic stops when it turns off, and Space toggles it only while on. */
  active: boolean;
  onFinal(text: string, endOfTurn: boolean): void;
  onInterim(text: string): void;
}

export function useMic({ lang, active, onFinal, onInterim }: MicOptions) {
  const t = useT();
  const [micOn, setMicOn] = useState(false);
  const [mic, setMic] = useState<{ state: SpeechState; detail?: string }>({ state: "idle" });
  const speech = useRef<SpeechSource | null>(null);
  const micLock = useRef<ReturnType<typeof createMicLock> | null>(null);
  const cb = useRef({ onFinal, onInterim, active });
  cb.current = { onFinal, onInterim, active };

  const toggle = () => {
    if (speech.current) {
      const cur = speech.current; speech.current = null; setMicOn(false);
      cur.stop();
      cb.current.onFinal("", true);
      cb.current.onInterim("");
      return;
    }
    const src = new WebSpeechSource(lang);
    if (!src.available) { setMic({ state: "error", detail: t("speech.unavailable") }); return; }
    src.onInterim = (x) => cb.current.onInterim(x);
    src.onFinal = (x) => cb.current.onFinal(x, false);
    src.onState = (state, detail) => {
      setMic({ state, detail });
      if (state === "error" || state === "idle") { if (speech.current === src) { speech.current = null; setMicOn(false); } if (state === "error") cb.current.onFinal("", true); }
    };
    speech.current = src; setMicOn(true);
    micLock.current?.claim();
    src.start();
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  // Another tab claimed the mic: release it here and warn.
  useEffect(() => {
    micLock.current = createMicLock(() => {
      if (!speech.current) return;
      toggleRef.current();
      setMic({ state: "error", detail: t("speech.micTaken") });
    });
    return () => { micLock.current?.close(); micLock.current = null; speech.current?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; the callback reads current values through refs
  }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!cb.current.active || e.code !== "Space" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(el.tagName))) return;
      e.preventDefault();
      toggleRef.current();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => { if (!active && speech.current) toggleRef.current(); }, [active]);

  return { micOn, mic, toggle };
}
