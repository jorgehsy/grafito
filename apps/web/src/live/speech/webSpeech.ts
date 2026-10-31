import type { SpeechSource, SpeechState } from "./types";

export const MAX_RETRIES = 5;
export const BACKOFF_BASE_MS = 300;
// si el reconocedor nuevo no dispara onstart en este tiempo, se da por colgado
export const START_TIMEOUT_MS = 4000;

export const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Permiso de micrófono denegado. Permítelo en el candado de la barra de direcciones.",
  "service-not-allowed": "El navegador no permite el reconocimiento de voz en esta página.",
  "no-speech": "No se oyó nada. Habla más cerca del micrófono.",
  "audio-capture": "No se encontró ningún micrófono.",
  network: "Error de red del reconocimiento de voz (Chrome lo envía a un servidor).",
  "language-not-supported": "Idioma no soportado.",
};
const FATAL = new Set(["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]);

export const UNAVAILABLE_MESSAGE =
  "Este navegador no soporta reconocimiento de voz. Usa Chrome o Safari; el resto del panel funciona igual.";

export function getRecognitionCtor(w: any = typeof window !== "undefined" ? window : undefined): any | null {
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
}

export class WebSpeechSource implements SpeechSource {
  onInterim: (t: string) => void = () => {};
  onFinal: (t: string) => void = () => {};
  onState: (s: SpeechState, d?: string) => void = () => {};
  lang: string;
  private rec: any = null;
  private active = false;
  private retries = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private lastError = "";

  // setTimeout/clearTimeout van envueltos: llamados como this.setT(...) con `this` = la clase, Chrome lanza "Illegal invocation"
  constructor(lang = "es-CL", private ctor: any = getRecognitionCtor(), private setT: typeof setTimeout = ((f: any, ms?: number) => setTimeout(f, ms)) as typeof setTimeout, private clearT: (t: any) => void = (t) => clearTimeout(t)) {
    this.lang = lang;
  }

  get available() { return !!this.ctor; }
  isActive() { return this.active; }

  start() {
    if (!this.ctor) { this.onState("error", UNAVAILABLE_MESSAGE); return; }
    if (this.active) return;
    this.active = true;
    this.retries = 0;
    this.lastError = "";
    this.spawn();
  }

  stop() {
    this.active = false;
    this.clearTimers();
    this.discard(this.rec, true);
    this.rec = null;
    this.onState("idle");
  }

  private clearTimers() {
    if (this.timer !== undefined) this.clearT(this.timer);
    if (this.watchdog !== undefined) this.clearT(this.watchdog);
    this.timer = undefined;
    this.watchdog = undefined;
  }

  // suelta una instancia: sin handlers (sus eventos tardíos no cuentan) y la aborta
  private discard(r: any, gentle = false) {
    if (!r) return;
    r.onstart = r.onresult = r.onerror = r.onend = null;
    try { gentle && r.stop ? r.stop() : r.abort?.(); } catch { /* ya parada */ }
  }

  private scheduleRestart() {
    if (!this.active) return;
    if (this.lastError !== "no-speech" && this.retries >= MAX_RETRIES) {
      this.active = false;
      this.onState("error", (ERROR_MESSAGES[this.lastError] ?? "El reconocimiento se detuvo") + " Se agotaron los reintentos; pulsa Hablar otra vez.");
      return;
    }
    // el silencio (no-speech) es normal: reinicia sin gastar reintentos
    const delay = this.lastError === "no-speech" ? BACKOFF_BASE_MS : BACKOFF_BASE_MS * 2 ** this.retries++;
    this.onState("restarting", this.lastError ? ERROR_MESSAGES[this.lastError] : undefined);
    if (this.timer !== undefined) this.clearT(this.timer);
    this.timer = this.setT(() => { this.timer = undefined; if (this.active) this.spawn(); }, delay);
  }

  private spawn() {
    // nunca dos instancias vivas
    this.discard(this.rec);
    this.rec = null;
    if (this.watchdog !== undefined) this.clearT(this.watchdog);
    this.watchdog = undefined;
    const r = new this.ctor();
    const mine = () => this.rec === r;
    r.continuous = true;
    r.interimResults = true;
    r.lang = this.lang;
    r.onstart = () => {
      if (!mine()) return;
      if (this.watchdog !== undefined) this.clearT(this.watchdog);
      this.watchdog = undefined;
      this.onState("listening");
    };
    r.onresult = (ev: any) => {
      if (!mine()) return;
      this.retries = 0;
      this.lastError = "";
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const t: string = res[0]?.transcript ?? "";
        if (res.isFinal) { if (t.trim()) this.onFinal(t.trim()); } else interim += t;
      }
      this.onInterim(interim.trim());
    };
    r.onerror = (ev: any) => {
      if (!mine()) return;
      const code: string = ev?.error ?? "unknown";
      if (code === "aborted") return;
      this.lastError = code;
      if (FATAL.has(code)) {
        this.active = false;
        this.clearTimers();
        this.onState("error", ERROR_MESSAGES[code] ?? `Error de voz: ${code}`);
      }
    };
    r.onend = () => {
      if (!mine()) return;
      this.onInterim("");
      if (this.watchdog !== undefined) this.clearT(this.watchdog);
      this.watchdog = undefined;
      this.scheduleRestart();
    };
    this.rec = r;
    // si onstart no llega, la instancia está colgada: se descarta y cuenta como reintento
    this.watchdog = this.setT(() => {
      this.watchdog = undefined;
      if (!mine() || !this.active) return;
      this.discard(r);
      this.rec = null;
      this.lastError = "";
      this.scheduleRestart();
    }, START_TIMEOUT_MS);
    try {
      r.start();
    } catch {
      // start() que lanza no dispara onend: reprogramar a mano
      if (this.watchdog !== undefined) this.clearT(this.watchdog);
      this.watchdog = undefined;
      this.discard(r);
      this.rec = null;
      this.lastError = "";
      this.scheduleRestart();
    }
  }
}
