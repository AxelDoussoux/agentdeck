import { afterEach, describe, expect, it } from "vitest";
import { applyLanguage, errorText, formatList, locale, t } from "./i18n";
import { en } from "../locales/en";
import { fr } from "../locales/fr";
import { matches } from "./search";

afterEach(() => applyLanguage("en"));

/** Paths of every text in a locale, such as `settings.title`. */
function keys(messages: object, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "object" && value !== null && !("$$typeof" in value)
      ? keys(value, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe("locales", () => {
  it("French has every English text", () => {
    const french = new Set(keys(fr));
    expect(keys({ ...en, errors: {} }).filter((key) => !french.has(key))).toEqual([]);
  });

  it("applyLanguage switches the texts and the page language", () => {
    applyLanguage("fr");
    expect(locale).toBe("fr");
    expect(t).toBe(fr);
    expect(document.documentElement.lang).toBe("fr");
    expect(localStorage.getItem("language")).toBe("fr");
  });
});

describe("errorText", () => {
  const info = { code: "io", path: "/a", detail: "denied", message: "cannot read /a: denied" };

  it("words error codes in French and falls back to the core's message", () => {
    expect(errorText(info)).toBe("cannot read /a: denied");
    applyLanguage("fr");
    expect(errorText(info)).toBe("Impossible d’accéder à /a\u00a0: denied");
  });

  it("reads errors and anything else", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText(42)).toBe("42");
  });
});

it("formatList has no comma before and", () => {
  expect(formatList(["A", "B", "C"])).toBe("A, B and C");
  applyLanguage("fr");
  expect(formatList(["A", "B", "C"])).toBe("A, B et C");
});

it("matches finds every word in any of the texts, ignoring case", () => {
  expect(matches("git HUB", ["GitHub server", null])).toBe(true);
  expect(matches("git lab", ["GitHub server", undefined])).toBe(false);
  expect(matches("  ", [])).toBe(true);
});
