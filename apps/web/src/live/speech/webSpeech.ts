import { getLang, t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import type { SpeechSource, SpeechState } from "./types";

export const MAX_RETRIES = 5;
export const BACKOFF_BASE_MS = 300;
// a new recognizer that does not fire onstart in this time is considered hung
export const START_TIMEOUT_MS = 4000;

const KNOWN_ERRORS = new Set(["not-allowed", "service-not-allowed", "no-speech", "audio-capture", "network", "language-not-supported"]);

const errorMessage = (code: string): string | undefined => {
  const key = `speech.error.${code}`;
  return KNOWN_ERRORS.has(code) ? t(key as MessageKey) : undefined;
};
const FATAL = new Set(["not-allowed", "service-not-allowed", "audio-capture", "language-not-supported"]);

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

  // setTimeout/clearTimeout are wrapped: called as this.setT(...) with `this` = the class, Chrome throws "Illegal invocation"
  constructor(lang: string = getLang(), private ctor: any = getRecognitionCtor(), private setT: typeof setTimeout = ((f: any, ms?: number) => setTimeout(f, ms)) as typeof setTimeout, private clearT: (t: any) => void = (t) => clearTimeout(t)) {
    this.lang = lang;
  }

  get available() { return !!this.ctor; }
  isActive() { return this.active; }

  start() {
    if (!this.ctor) { this.onState("error", t("speech.unavailable")); return; }
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

  // drops an instance: without handlers (its late events must not count) and aborted
  private discard(r: any, gentle = false) {
    if (!r) return;
    r.onstart = r.onresult = r.onerror = r.onend = null;
    try { gentle && r.stop ? r.stop() : r.abort?.(); } catch { /* already stopped */ }
  }

  private scheduleRestart() {
    if (!this.active) return;
    if (this.lastError !== "no-speech" && this.retries >= MAX_RETRIES) {
      this.active = false;
      this.onState("error", t("speech.retriesExhausted", { reason: errorMessage(this.lastError) ?? t("speech.stopped") }));
      return;
    }
    // silence (no-speech) is normal: restart without spending retries
    const delay = this.lastError === "no-speech" ? BACKOFF_BASE_MS : BACKOFF_BASE_MS * 2 ** this.retries++;
    this.onState("restarting", this.lastError ? errorMessage(this.lastError) : undefined);
    if (this.timer !== undefined) this.clearT(this.timer);
    this.timer = this.setT(() => { this.timer = undefined; if (this.active) this.spawn(); }, delay);
  }

  private spawn() {
    // never two live instances
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
        const text: string = res[0]?.transcript ?? "";
        if (res.isFinal) { if (text.trim()) this.onFinal(text.trim()); } else interim += text;
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
        this.onState("error", errorMessage(code) ?? t("speech.errorCode", { code }));
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
    // if onstart never arrives the instance is hung: drop it and count a retry
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
      // a start() that throws does not fire onend: reschedule by hand
      if (this.watchdog !== undefined) this.clearT(this.watchdog);
      this.watchdog = undefined;
      this.discard(r);
      this.rec = null;
      this.lastError = "";
      this.scheduleRestart();
    }
  }
}
