export type SpeechState = "idle" | "listening" | "restarting" | "error";

/** A speech-to-text source; a cloud service can replace WebSpeechSource without touching the rest. */
export interface SpeechSource {
  start(): void;
  stop(): void;
  onInterim(text: string): void;
  onFinal(text: string): void;
  onState(state: SpeechState, detail?: string): void;
}
