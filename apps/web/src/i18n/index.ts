import { useSyncExternalStore } from "react";
import { en } from "./en";
import { es } from "./es";
import { browserStore } from "../storage";
import { DEFAULT_LANG, LANGS, isLang } from "@grafito/contract";
import type { Lang } from "@grafito/contract";

export { LANGS, isLang } from "@grafito/contract";
export type { Lang } from "@grafito/contract";

type Raw = keyof typeof en;
/** A message key; plural messages are addressed without their `.one` / `.other` suffix. */
export type MessageKey = { [K in Raw]: K extends `${infer B}.${"one" | "other"}` ? B : K }[Raw];
export type Vars = Record<string, string | number>;

const STORAGE_KEY = "grafito.lang";

/** An exact match, else the first supported language with the same primary subtag, else `en-US`. */
export function matchLang(tag: string | undefined): Lang {
  if (isLang(tag)) return tag;
  const primary = tag?.split("-")[0].toLowerCase();
  return LANGS.find((l) => l.code.split("-")[0] === primary)?.code ?? DEFAULT_LANG;
}

function initialLang(): Lang {
  const saved = browserStore.get(STORAGE_KEY);
  if (isLang(saved)) return saved;
  return matchLang(typeof navigator !== "undefined" ? navigator.language : undefined);
}

let current: Lang = initialLang();
const listeners = new Set<() => void>();
const applyHtmlLang = () => { if (typeof document !== "undefined") document.documentElement.lang = current; };
applyHtmlLang();

export const getLang = (): Lang => current;

export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  browserStore.set(STORAGE_KEY, lang);
  applyHtmlLang();
  listeners.forEach((f) => f());
}

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

const dictionary = (): Record<string, string> => (current.startsWith("es") ? es : en);

/** Looks up `key` in the current language. A numeric `count` picks the `.one` / `.other` variant. */
export function t(key: MessageKey, vars?: Vars): string {
  const dict = dictionary();
  let msg = dict[key];
  if (typeof vars?.count === "number") {
    msg = dict[`${key}.${new Intl.PluralRules(current).select(vars.count)}`] ?? dict[`${key}.other`] ?? msg;
  }
  return msg.replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? ""));
}

/** Re-renders the component when the language changes and returns `t`. */
export function useT(): typeof t {
  useSyncExternalStore(subscribe, getLang);
  return t;
}

export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang);
}
