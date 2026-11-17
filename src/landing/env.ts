// Ambiente di build della landing. Sta in un file a parte perché lo leggono sia i testi (copy.*.ts)
// sia i dati statici (staticData.ts), che a loro volta usano i testi: così non nasce un ciclo di import.
const env = (import.meta as { env?: Record<string, string | undefined> }).env;
/** true nel build per GitHub Pages (vite build --mode static) */
export const STATIC = env?.VITE_STATIC === '1';
export const BASE = env?.BASE_URL ?? '/';

/**
 * Indirizzo della demo pubblica dell'app completa (con il server), es. 'https://openway.example.org/'.
 * Vuoto finché non è pubblicata: va scritto qui dopo il primo deploy (vedi "Pubblicare l'app" nel README).
 * La landing statica su GitHub Pages lo usa per i link "Apri OpenWay"; senza, rimanda alle istruzioni.
 */
export const DEMO_URL: string = '';
/** true se dalla landing si può aprire l'app: sempre con il server, su GitHub Pages solo se esiste la demo pubblica. */
export const HAS_APP = !STATIC || DEMO_URL !== '';
