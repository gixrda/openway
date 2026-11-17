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

/** Estratto dell'Italia (2,3 GB): riusa quello in cache, lo scarica se manca o con --refresh. Al massimo una volta al giorno. */
export async function ensureExtract(): Promise<string> {
  await mkdir(cache, { recursive: true });
  const pbf = cached('italy-latest.osm.pbf');
  if (process.argv.includes('--refresh') || !(await exists(pbf))) {
    console.log(`Scarico ${EXTRACT_URL} …`);
    const res = await fetch(EXTRACT_URL, { headers: { 'User-Agent': 'OpenWay-hackathon/0.1' } });
    if (!res.ok || !res.body) throw new Error(`Geofabrik: HTTP ${res.status}. I dati esistenti non sono stati modificati.`);
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(`${pbf}.part`));
    await rename(`${pbf}.part`, pbf);
  }
  return pbf;
}
