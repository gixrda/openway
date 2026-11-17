// Lingue dell'interfaccia. L'italiano è la lingua di riferimento: ogni testo nasce lì e viene tradotto.
export type Lang = 'it' | 'en';

export const LANGS: readonly Lang[] = ['it', 'en'];
export const DEFAULT_LANG: Lang = 'it';

export const isLang = (v: unknown): v is Lang => v === 'it' || v === 'en';

/** Lingua da un'intestazione Accept-Language (o da un codice come "en-GB"): conta solo la prima preferenza. */
export function langFromHeader(value: string | string[] | undefined | null): Lang {
  const first = (Array.isArray(value) ? value[0] : value)?.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('en') ? 'en' : DEFAULT_LANG;
}
