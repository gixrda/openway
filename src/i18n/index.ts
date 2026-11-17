// Lingua dell'interfaccia: un solo stato per tutta la pagina, leggibile anche fuori dai componenti (lib/, hooks/).
// Nessuna libreria: due dizionari tipizzati (it.ts è il riferimento) e un piccolo store.
import { useSyncExternalStore } from 'react';
import { DEFAULT_LANG, isLang, type Lang } from '../../shared/lang.ts';
import { featureLabel } from '../../shared/osmClassify.ts';
import type { OsmFeature } from '../../shared/types.ts';
import { en } from './en.ts';
import { it, type Strings } from './it.ts';

export type { Lang, Strings };

const DICTS: Record<Lang, Strings> = { it, en };
const STORAGE_KEY = 'openway-lang';

/**
 * Ordine: ?lang= nel link (per condividere una versione), scelta salvata, lingua del browser.
 * Chi ha l'italiano tra le lingue del browser vede l'italiano; tutti gli altri l'inglese.
 * Fuori dal browser (test, script) resta la lingua di riferimento.
 */
function detect(): Lang {
  if (typeof window === 'undefined') return DEFAULT_LANG;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('lang');
    if (isLang(fromUrl)) return fromUrl;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch { /* storage non disponibile: si usa la lingua del browser */ }
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language ?? ''];
  return preferred.some((l) => l.toLowerCase().startsWith('it')) ? 'it' : 'en';
}

let current: Lang = detect();
const listeners = new Set<() => void>();

function applyToDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = current;
}
applyToDocument();

export const getLang = (): Lang => current;

/** Testi nella lingua corrente. Va chiamata al momento dell'uso, non a livello di modulo. */
export const t = (): Strings => DICTS[current];

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    window.localStorage.setItem(STORAGE_KEY, lang);
    // Se il link conteneva ?lang=, lo si aggiorna: altrimenti al ricaricamento vincerebbe la lingua vecchia.
    // Si sostituisce solo quel valore: il resto del link (es. from=lat,lng dei percorsi demo) resta scritto com'era.
    const search = window.location.search.replace(/([?&]lang=)[^&]*/, `$1${lang}`);
    if (search !== window.location.search) {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`);
    }
  } catch { /* storage non disponibile: la scelta vale per questa visita */ }
  applyToDocument();
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Lingua corrente; il componente si ridisegna quando cambia. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** Testi nella lingua corrente; il componente si ridisegna quando la lingua cambia. */
export function useT(): Strings {
  return DICTS[useLang()];
}

/** Intestazione che dice al server in che lingua rispondere (messaggi, indicazioni di svolta, voce). */
export const langHeaders = (): Record<string, string> => ({ 'Accept-Language': current });

/** Etichetta di un elemento OpenStreetMap nella lingua corrente (ricalcolata dai tag, non letta dallo snapshot). */
export const osmLabel = (f: OsmFeature): string => featureLabel(f, current);

export function formatDate(iso: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' }): string {
  return new Intl.DateTimeFormat(t().locale, options).format(new Date(iso));
}
