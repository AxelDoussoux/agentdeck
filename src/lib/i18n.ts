import { en, type Messages } from "../locales/en";
import { fr } from "../locales/fr";

export type Language = "en" | "fr";
/** What the user picked in Settings: a language, or the system's. */
export type LanguageSetting = Language | "system";

export const LANGUAGES: Record<Language, { name: string; messages: Messages }> = {
  en: { name: "English", messages: en },
  fr: { name: "Français", messages: fr },
};

const SETTINGS: LanguageSetting[] = ["system", "en", "fr"];

/** French when the system prefers it, English otherwise. */
export function systemLanguage(): Language {
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of preferred) {
    const code = tag.toLowerCase().split("-")[0];
    if (code in LANGUAGES) return code as Language;
  }
  return "en";
}

export function storedLanguage(): LanguageSetting {
  try {
    const value = localStorage.getItem("language");
    return SETTINGS.includes(value as LanguageSetting) ? (value as LanguageSetting) : "system";
  } catch {
    return "system";
  }
}

/**
 * The texts of the current language. Modules import this binding, which
 * follows `applyLanguage`; the app re-renders after a change.
 */
export let t: Messages = en;
/** The current language, for dates and numbers. */
export let locale: Language = "en";

export function applyLanguage(setting: LanguageSetting) {
  locale = setting === "system" ? systemLanguage() : setting;
  t = LANGUAGES[locale].messages;
  document.documentElement.lang = locale;
  try {
    localStorage.setItem("language", setting);
  } catch {
    // Private mode or blocked storage: the choice just won't persist.
  }
}

applyLanguage(storedLanguage());

export const formatNumber = (value: number, options?: Intl.NumberFormatOptions) =>
  value.toLocaleString(locale, options);

/** A date and time, such as "22 oct. 2026, 14:05" in French. */
export const formatDateTime = (moment: number | string | Date) =>
  new Date(moment).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

/** A day without the year, such as "Oct 22". */
export const formatDay = (moment: Date, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  moment.toLocaleDateString(locale, options);

/** "A, B and C", or "A, B et C" in French; British English has no comma before "and". */
export const formatList = (items: string[]) =>
  new Intl.ListFormat(locale === "en" ? "en-GB" : locale, { type: "conjunction" }).format(items);
