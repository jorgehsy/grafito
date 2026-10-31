// Interfaz de entrada de voz. Una STT en la nube (AssemblyAI/Deepgram) puede sustituir a WebSpeechSource sin tocar el resto.
export type SpeechState = "idle" | "listening" | "restarting" | "error";

export interface SpeechSource {
  start(): void;
  stop(): void;
  onInterim(text: string): void;
  onFinal(text: string): void;
  onState(state: SpeechState, detail?: string): void;
}

export const SPEECH_LANGS = [
  { code: "es-CL", label: "Español (Chile)" },
  { code: "es-AR", label: "Español (Argentina)" },
  { code: "es-MX", label: "Español (México)" },
  { code: "es-ES", label: "Español (España)" },
  { code: "en-US", label: "English (US)" },
];
