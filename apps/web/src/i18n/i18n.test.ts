import { afterEach, describe, expect, it } from "vitest";
import { en } from "./en";
import { es } from "./es";
import { getLang, matchLang, setLang, t } from "./index";

afterEach(() => setLang("en-US"));

describe("dictionaries", () => {
  it("es has exactly the keys of en", () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
  });

  it("every translation keeps the placeholders of the source", () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(names(es[key]), key).toEqual(names(en[key]));
    }
  });
});

describe("t", () => {
  it("fills placeholders and picks the plural variant", () => {
    setLang("en-US");
    expect(t("app.queue", { count: 1 })).toBe("1 fragment in queue");
    expect(t("app.queue", { count: 3 })).toBe("3 fragments in queue");
    setLang("es-CL");
    expect(t("app.queue", { count: 1 })).toBe("1 frase en cola");
    expect(t("app.queue", { count: 0 })).toBe("0 frases en cola");
    expect(t("net.http", { status: 502 })).toBe("Error del servidor (HTTP 502)");
  });
});

describe("language setting", () => {
  it("falls back from region to language to en-US", () => {
    expect(matchLang("es-MX")).toBe("es-MX");
    expect(matchLang("es-VE")).toBe("es-CL");
    expect(matchLang("en-GB")).toBe("en-US");
    expect(matchLang("fr-FR")).toBe("en-US");
    expect(matchLang(undefined)).toBe("en-US");
  });

  it("setLang changes the current language", () => {
    setLang("es-AR");
    expect(getLang()).toBe("es-AR");
  });
});
