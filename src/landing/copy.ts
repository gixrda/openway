// Testi della landing: un dizionario per lingua (copy.it.ts è il riferimento, copy.en.ts la traduzione).
// Qui restano i collegamenti e il modo di leggere i testi nella lingua corrente.
import type { Lang } from '../../shared/lang.ts';
import type { LatLngTuple } from '../../shared/types.ts';
import { getLang, useLang } from '../i18n/index.ts';
import { en } from './copy.en.ts';
import { it, type Copy } from './copy.it.ts';
import { DEMO_URL, STATIC } from './env.ts';

export type { Copy };
export interface Scenario { id: string; name: string; hint: string; from: LatLngTuple; to: LatLngTuple }

export const REPO_URL = 'https://github.com/gixrda/openway';
// Su GitHub Pages l'app (che richiede il server) non c'è: i link portano alla demo pubblica, se esiste,
// altrimenti alle istruzioni per provarla.
export const APP_URL = STATIC ? (DEMO_URL || `${REPO_URL}#installazione`) : '/';

const COPY: Record<Lang, Copy> = { it, en };

/** I tragitti demo: le coordinate non dipendono dalla lingua, solo nome e descrizione. */
export const SCENARIOS: Scenario[] = it.demo.scenarios;

/** Testi nella lingua corrente, fuori dai componenti. Va chiamata al momento dell'uso. */
export const getCopy = (): Copy => COPY[getLang()];

/** Testi nella lingua corrente; il componente si ridisegna quando la lingua cambia. */
export function useCopy(): Copy {
  return COPY[useLang()];
}
