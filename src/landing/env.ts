// Ambiente di build della landing. Sta in un file a parte perché lo leggono sia i testi (copy.*.ts)
// sia i dati statici (staticData.ts), che a loro volta usano i testi: così non nasce un ciclo di import.
const env = (import.meta as { env?: Record<string, string | undefined> }).env;
/** true nel build per GitHub Pages (vite build --mode static) */
export const STATIC = env?.VITE_STATIC === '1';
export const BASE = env?.BASE_URL ?? '/';
