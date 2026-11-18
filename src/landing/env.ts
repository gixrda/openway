// Ambiente di build della landing. Sta in un file a parte perché lo leggono sia i testi (copy.*.ts)
// sia i dati statici (staticData.ts), che a loro volta usano i testi: così non nasce un ciclo di import.
const env = (import.meta as { env?: Record<string, string | undefined> }).env;
/** true nel build per GitHub Pages (vite build --mode static) */
export const STATIC = env?.VITE_STATIC === '1';
export const BASE = env?.BASE_URL ?? '/';

/**
 * Indirizzo della demo pubblica dell'app completa (con il server), con la barra finale.
 * La landing statica su GitHub Pages lo usa per i link "Apri OpenWay" e per aprire nell'app i tragitti demo.
 * Se la demo viene spostata o chiusa va aggiornato qui (vedi "Pubblicare l'app" nel README): vuoto, i link
 * rimandano alle istruzioni di installazione.
 */
export const DEMO_URL: string = 'https://openway-q47u.onrender.com/';
/** true se dalla landing si può aprire l'app: sempre con il server, su GitHub Pages solo se esiste la demo pubblica. */
export const HAS_APP = !STATIC || DEMO_URL !== '';
