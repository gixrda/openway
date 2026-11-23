// Parti comuni agli script che leggono l'estratto Geofabrik dell'Italia: scaricamento (con cache) e chiamate a osmium.
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

/** Una sorgente dell'estratto OpenStreetMap dell'Italia. */
export interface ExtractSource {
  name: string;
  url: string;
  /** File di stato della replica (osmosis) con la data dei dati, per le sorgenti che non la scrivono nel file */
  stateUrl?: string;
}

/**
 * Sorgenti in ordine di preferenza: se la prima non risponde si passa alla successiva.
 * Dal 23/11/2026 Geofabrik rifiuta le connessioni dalle macchine di GitHub Actions (ECONNREFUSED su tutti
 * gli indirizzi, mentre da altre reti risponde): il workflow settimanale ha bisogno di una seconda sorgente.
 * OSM_EXTRACT_URL sostituisce l'elenco con un solo indirizzo (un mirror, o un estratto piccolo per le prove).
 */
export const EXTRACT_SOURCES: ExtractSource[] = process.env.OSM_EXTRACT_URL
  ? [{ name: 'da OSM_EXTRACT_URL', url: process.env.OSM_EXTRACT_URL, ...(process.env.OSM_EXTRACT_STATE_URL ? { stateUrl: process.env.OSM_EXTRACT_STATE_URL } : {}) }]
  : [
    { name: 'Geofabrik', url: 'https://download.geofabrik.de/europe/italy-latest.osm.pbf' },
    {
      name: 'OpenStreetMap France',
      url: 'https://download.openstreetmap.fr/extracts/europe/italy-latest.osm.pbf',
      stateUrl: 'https://download.openstreetmap.fr/extracts/europe/italy.state.txt',
    },
  ];

/** Da dove viene l'estratto in cache e, se la sorgente la dichiara a parte, la data dei suoi dati. */
export interface ExtractInfo { pbf: string; source: string; timestamp?: string }

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
 * Attese tra un tentativo e il successivo sulla stessa sorgente: 3 nuovi tentativi in tre minuti e mezzo,
 * poi si passa alla sorgente successiva. Un guasto passeggero si risolve in questo tempo; un blocco no.
 */
export const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

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

/**
 * Prova le sorgenti in ordine, ognuna con i suoi nuovi tentativi, e restituisce la prima che riesce.
 * Se falliscono tutte rilancia l'errore dell'ultima.
 */
export async function firstWorking<S extends { name: string }, T>(
  sources: S[],
  run: (source: S) => Promise<T>,
  options: Parameters<typeof withRetries>[1] & { log?: (m: string) => void } = {},
): Promise<{ source: S; result: T }> {
  const log = options.log ?? console.warn;
  let last: unknown = new Error('Nessuna sorgente configurata.');
  for (const [i, source] of sources.entries()) {
    try {
      return { source, result: await withRetries(() => run(source), options) };
    } catch (e) {
      last = e;
      const next = sources[i + 1];
      log(`${source.name} non disponibile (${failureReason(e)})${next ? `: passo a ${next.name}.` : '.'}`);
    }
  }
  throw last;
}

/** Data dei dati da un file di stato osmosis (`timestamp=2026-11-23T02\:19\:24Z`), in formato ISO. */
export function stateTimestamp(text: string): string | undefined {
  const value = /^timestamp=(.+)$/m.exec(text)?.[1].replaceAll('\\', '').trim();
  return value && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

async function download(source: ExtractSource, part: string): Promise<string | undefined> {
  const headers = { 'User-Agent': 'OpenWay-hackathon/0.1' };
  const res = await fetch(source.url, { headers });
  if (!res.ok || !res.body) {
    const message = `${source.name}: HTTP ${res.status}. I dati esistenti non sono stati modificati.`;
    // 4xx = richiesta sbagliata, riprovare non cambia nulla. Fanno eccezione "troppe richieste" e "tempo scaduto".
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
    throw permanent ? new PermanentError(message) : new Error(message);
  }
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(part));
  if (!source.stateUrl) return undefined;
  // La data dei dati è un'informazione in più: se il file di stato non arriva, resta quella del file scaricato.
  return fetch(source.stateUrl, { headers }).then((r) => (r.ok ? r.text() : '')).then(stateTimestamp, () => undefined);
}

/**
 * Estratto dell'Italia (2,3 GB): riusa quello in cache, lo scarica se manca o con --refresh. Al massimo una volta al giorno.
 * Accanto al file salva da quale sorgente viene, perché finisce scritto nei dati pubblicati.
 */
export async function ensureExtract(): Promise<ExtractInfo> {
  await mkdir(cache, { recursive: true });
  const pbf = cached('italy-latest.osm.pbf');
  const infoFile = `${pbf}.json`;
  if (process.argv.includes('--refresh') || !(await exists(pbf))) {
    // Ogni tentativo riparte da capo e scrive su un file provvisorio: il file buono compare solo a download finito.
    const { source, result: timestamp } = await firstWorking(EXTRACT_SOURCES, (s) => {
      console.log(`Scarico ${s.url} …`);
      return download(s, `${pbf}.part`);
    });
    await rename(`${pbf}.part`, pbf);
    const info = { source: source.name, ...(timestamp ? { timestamp } : {}) };
    await writeFile(infoFile, JSON.stringify(info));
    return { pbf, ...info };
  }
  // Un estratto in cache da prima di questo file di accompagnamento veniva da Geofabrik, l'unica sorgente di allora.
  const info = await readFile(infoFile, 'utf8').then((t) => JSON.parse(t) as Omit<ExtractInfo, 'pbf'>, () => ({ source: 'Geofabrik' }));
  return { pbf, ...info };
}
