// La demo pubblica gira su un piano gratuito che si addormenta dopo 15 minuti senza visite: la prima pagina
// dopo una pausa arriva dopo circa un minuto. La landing statica la sveglia in anticipo, appena viene aperta,
// così chi poi preme "Apri OpenWay" la trova già pronta (o quasi).
// È una sola richiesta senza cookie e senza dati: la risposta non viene nemmeno letta.

/** Non si ripete la richiesta prima di questo intervallo: la demo resta sveglia 15 minuti. */
export const PREWARM_EVERY_MS = 10 * 60_000;
const KEY = 'openway-prewarm';

export interface PrewarmDeps {
  fetch: typeof fetch;
  /** Ricorda l'ultima richiesta per la durata della visita (sessionStorage); può mancare o essere bloccato. */
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  now?: number;
  /** true se chi visita ha chiesto al browser di risparmiare dati */
  saveData?: boolean;
}

/** Restituisce true se la richiesta è partita. Non lancia mai: se la demo non risponde, la landing non ne risente. */
export function prewarmDemo(demoUrl: string, { fetch: send, storage, now = Date.now(), saveData = false }: PrewarmDeps): boolean {
  if (!demoUrl || saveData) return false;
  try {
    const last = Number(storage?.getItem(KEY) ?? 0);
    if (now - last < PREWARM_EVERY_MS) return false;
    storage?.setItem(KEY, String(now));
  } catch { /* storage bloccato: si fa comunque una richiesta per pagina */ }
  // no-cors: basta che la richiesta arrivi al server. /api/status è la risposta più leggera che ha.
  void send(`${demoUrl}api/status`, { mode: 'no-cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' })
    .catch(() => { /* demo spenta o irraggiungibile: nessun effetto sulla pagina */ });
  return true;
}
