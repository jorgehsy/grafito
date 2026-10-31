/**
 * The one language setting: UI text, speech recognition, `<html lang>` and the language Claude
 * writes the board in. `code` is the BCP 47 tag sent as `lang`; `name` goes into the prompt.
 */
export const LANGS = [
  { code: "es-CL", label: "Español (Chile)", short: "Chile", name: "Spanish" },
  { code: "es-AR", label: "Español (Argentina)", short: "Argentina", name: "Spanish" },
  { code: "es-MX", label: "Español (México)", short: "México", name: "Spanish" },
  { code: "es-ES", label: "Español (España)", short: "España", name: "Spanish" },
  { code: "en-US", label: "English (US)", short: "English US", name: "English" },
] as const;

export type Lang = (typeof LANGS)[number]["code"];

export const DEFAULT_LANG: Lang = "en-US";

export const isLang = (x: unknown): x is Lang => LANGS.some((l) => l.code === x);

/** English name of the language, as the prompt writes it. */
export const languageName = (lang: Lang): string => LANGS.find((l) => l.code === lang)!.name;
