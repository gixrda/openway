// Parti comuni agli script che leggono l'estratto Geofabrik dell'Italia: scaricamento (con cache) e chiamate a osmium.
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const EXTRACT_URL = 'https://download.geofabrik.de/europe/italy-latest.osm.pbf';
export const root = fileURLToPath(new URL('..', import.meta.url));
const cache = `${root}.cache/osm/`;
/** Percorso di un file di lavoro in .cache/osm/ (cartella ignorata da git). */
export const cached = (name: string) => `${cache}${name}`;
const exists = (path: string) => stat(path).then(() => true, () => false);

/** Esegue osmium e ne restituisce l'output. Richiede osmium-tool (brew install osmium-tool / apt install osmium-tool). */
export function osmium(...args: string[]): string {
  try {
    return execFileSync('osmium', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('osmium non trovato. Installa osmium-tool (brew install osmium-tool / apt install osmium-tool).', { cause: e });
    }
    throw e;
  }
}

/**
 * Attese tra un tentativo e il successivo: 5 nuovi tentativi in circa 18 minuti.
 * Il 23/11/2026 il workflow settimanale è fallito perché i server di Geofabrik rifiutavano la connessione
 * (ECONNREFUSED) alla macchina di GitHub, mentre da altre reti rispondevano.
 */
export const RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

/** Errore per cui riprovare non serve (es. HTTP 404: l'indirizzo è sbagliato). */
export class PermanentError extends Error {}

/** Motivo di un errore di rete in una riga: `fetch failed` da solo non dice nulla, il codice sta in `cause`. */
export function failureReason(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string; errors?: { code?: string }[] } };
  const codes = [err.cause?.code, ...(err.cause?.errors ?? []).map((x) => x.code)].filter(Boolean);
  // Senza un codice (es. porta non ammessa) resta almeno il messaggio della causa.
  const details = codes.length ? [...new Set(codes)] : [err.cause?.message].filter(Boolean);
  return [err.message ?? String(e), ...details].join(' · ');
}

/**
 * Esegue `run` e, se fallisce, riprova dopo le attese indicate. Un PermanentError interrompe subito.
 * Esauriti i tentativi rilancia l'ultimo errore.
 */
export async function withRetries<T>(
  run: (attempt: number) => Promise<T>,
  { delaysMs = RETRY_DELAYS_MS, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), log = console.warn as (m: string) => void } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(attempt + 1);
    } catch (e) {
      if (e instanceof PermanentError || attempt >= delaysMs.length) throw e;
      log(`Tentativo ${attempt + 1} non riuscito (${failureReason(e)}): riprovo tra ${delaysMs[attempt] / 1000} s.`);
      await sleep(delaysMs[attempt]);
    }
  }
}

/** Estratto dell'Italia (2,3 GB): riusa quello in cache, lo scarica se manca o con --refresh. Al massimo una volta al giorno. */
export async function ensureExtract(): Promise<string> {
  await mkdir(cache, { recursive: true });
  const pbf = cached('italy-latest.osm.pbf');
  if (process.argv.includes('--refresh') || !(await exists(pbf))) {
    console.log(`Scarico ${EXTRACT_URL} …`);
    // Ogni tentativo riparte da capo e scrive su un file provvisorio: il file buono compare solo a download finito.
    await withRetries(async () => {
      const res = await fetch(EXTRACT_URL, { headers: { 'User-Agent': 'OpenWay-hackathon/0.1' } });
      if (!res.ok || !res.body) {
        const message = `Geofabrik: HTTP ${res.status}. I dati esistenti non sono stati modificati.`;
        // 4xx = richiesta sbagliata, riprovare non cambia nulla. Fanno eccezione "troppe richieste" e "tempo scaduto".
        const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
        throw permanent ? new PermanentError(message) : new Error(message);
      }
      await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(`${pbf}.part`));
    });
    await rename(`${pbf}.part`, pbf);
  }
  return pbf;
}
