// Costruisce la griglia dei dati OSM di tutta la Toscana (server/data/osm-tiles/) dall'estratto Geofabrik.
// Uso: npm run osm:build            (riusa l'estratto già scaricato in .cache/osm/)
//      npm run osm:build -- --refresh   (scarica di nuovo l'estratto: 390 MB, al massimo una volta al giorno)
// Richiede osmium-tool (macOS: brew install osmium-tool · Debian/Ubuntu: apt install osmium-tool).
// Geofabrik non pubblica la sola Toscana: si parte da "Italia centrale" e si ritaglia sul confine regionale
// (relazione ISO3166-2=IT-52) contenuto nello stesso file. Overpass a questa scala non è affidabile.
import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { elementFromGeojson, matchesQuery, normalizeOverpass } from '../server/osm.ts';
import { buildTiles, countsAsData, writeTiles } from '../server/tiles.ts';
import type { OsmFeature } from '../shared/types.ts';

const EXTRACT_URL = 'https://download.geofabrik.de/europe/italy/centro-latest.osm.pbf';
const REGION = 'IT-52';
// Stessi criteri della query Overpass in server/osm.ts (nodi di riferimento inclusi da osmium).
const FILTERS = ['w/highway=footway,pedestrian,path,steps', 'w/sidewalk', 'n/kerb', 'n/highway=crossing', 'n/barrier', 'nw/wheelchair'];

const root = fileURLToPath(new URL('..', import.meta.url));
const cache = `${root}.cache/osm/`;
const file = (name: string) => `${cache}${name}`;
const exists = (path: string) => stat(path).then(() => true, () => false);

function osmium(...args: string[]): string {
  try {
    return execFileSync('osmium', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('osmium non trovato. Installa osmium-tool (brew install osmium-tool / apt install osmium-tool).', { cause: e });
    }
    throw e;
  }
}

await mkdir(cache, { recursive: true });
const pbf = file('centro-latest.osm.pbf');
if (process.argv.includes('--refresh') || !(await exists(pbf))) {
  console.log(`Scarico ${EXTRACT_URL} …`);
  const res = await fetch(EXTRACT_URL, { headers: { 'User-Agent': 'OpenWay-hackathon/0.1' } });
  if (!res.ok || !res.body) throw new Error(`Geofabrik: HTTP ${res.status}. I dati esistenti non sono stati modificati.`);
  await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), createWriteStream(`${pbf}.part`));
  await rename(`${pbf}.part`, pbf);
}

// 1. Confine regionale: la relazione con i suoi membri, esportata come poligono.
osmium('tags-filter', '-O', '-o', file('boundary.osm.pbf'), pbf, `r/ISO3166-2=${REGION}`);
osmium('export', '-O', '-o', file('boundary.geojson'), '--geometry-types=polygon', file('boundary.osm.pbf'));
const boundary = JSON.parse(await readFile(file('boundary.geojson'), 'utf8')) as {
  features: { properties: Record<string, string>; geometry: unknown }[];
};
const region = boundary.features.find((f) => f.properties['ISO3166-2'] === REGION);
if (!region) throw new Error(`Confine ${REGION} non trovato nell'estratto.`);
// Usato anche da `npm run osm:region` per rigenerare il poligono semplificato in shared/region.ts.
await writeFile(file('region.geojson'), JSON.stringify({ type: 'Feature', properties: { 'ISO3166-2': REGION }, geometry: region.geometry }));

// 2. Solo gli oggetti che servono, ritagliati sulla regione (le vie a cavallo del confine restano intere).
osmium('tags-filter', '-O', '-o', file('filtered.osm.pbf'), pbf, ...FILTERS);
osmium('extract', '-O', '-p', file('region.geojson'), '-o', file('region.osm.pbf'), file('filtered.osm.pbf'));
osmium('export', '-O', '-f', 'geojsonseq', '-x', 'print_record_separator=false', '--add-unique-id=type_id',
  '-o', file('region.geojsonseq'), file('region.osm.pbf'));
const timestamp = /osmosis_replication_timestamp=(\S+)/.exec(osmium('fileinfo', pbf))?.[1]
  ?? (await stat(pbf)).mtime.toISOString();

// 3. Stessa normalizzazione e classificazione dello snapshot Overpass.
const features: OsmFeature[] = [];
const seenWays = new Set<number>();
let elements = 0;
for await (const line of createInterface({ input: createReadStream(file('region.geojsonseq')) })) {
  if (!line) continue;
  const el = elementFromGeojson(JSON.parse(line));
  if (!el || !matchesQuery(el)) continue;
  // Una way chiusa può essere esportata due volte (linea e area): si tiene la prima.
  if (el.type === 'way') { if (seenWays.has(el.id)) continue; seenWays.add(el.id); }
  elements++;
  features.push(...normalizeOverpass([el]));
}

// 4. Griglia.
const built = buildTiles(features, {
  source: 'OpenStreetMap contributors (ODbL), estratto Geofabrik "Italia centrale" ritagliato sulla Toscana',
  fetchedAt: timestamp,
  scope: 'region',
});
const out = `${root}server/data/osm-tiles`;
await writeTiles(out, built);

const count = (test: (f: OsmFeature) => boolean) => features.filter(test).length;
const sizes = [...built.tiles.values()].map((t) => JSON.stringify({ features: t }).length);
console.log(`OSM ${timestamp}: ${elements} elementi → ${features.length} feature in ${built.tiles.size} celle`, {
  known_obstacle: count((f) => f.certainty === 'known_obstacle' && f.scope === 'path'),
  possible_issue: count((f) => f.certainty === 'possible_issue' && f.scope === 'path' && !f.trail),
  positive_info: count((f) => f.certainty === 'positive_info' && f.scope === 'path'),
  info: count((f) => f.certainty === 'info' && f.scope === 'path'),
  luoghi: count((f) => f.scope === 'place'),
  sentieri: count((f) => f.trail === true),
  con_dati: count(countsAsData),
});
console.log(`Dimensione: ${(sizes.reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} MB in tutto, cella più grande ${(Math.max(...sizes) / 1e3).toFixed(0)} kB, `
  + `mediana ${(sizes.sort((a, b) => a - b)[sizes.length >> 1] / 1e3).toFixed(1)} kB`);
