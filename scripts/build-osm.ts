// Costruisce la griglia dei dati OSM di tutta l'Italia (server/data/osm-tiles/) dall'estratto Geofabrik.
// Uso: npm run osm:build              (riusa l'estratto già scaricato in .cache/osm/)
//      npm run osm:build -- --refresh   (scarica di nuovo l'estratto: 2,3 GB, al massimo una volta al giorno)
// Richiede osmium-tool (macOS: brew install osmium-tool · Debian/Ubuntu: apt install osmium-tool).
// Overpass a questa scala non è affidabile (errori e timeout già sulla sola Toscana): si filtra in locale.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { elementFromGeojson, matchesQuery, normalizeOverpass } from '../server/osm.ts';
import { countsAsData, TileWriter } from '../server/tiles.ts';
import { inArea } from '../shared/area.ts';
import { dataLevel } from '../shared/tiles.ts';
import type { OsmFeature } from '../shared/types.ts';
import { cached, ensureExtract, osmium, root } from './osm-extract.ts';

// Stessi criteri della query Overpass in server/osm.ts (i nodi delle way vengono inclusi da osmium).
const FILTERS = ['w/highway=footway,pedestrian,path,steps', 'w/sidewalk', 'n/kerb', 'n/highway=crossing', 'n/barrier', 'nw/wheelchair'];

const { pbf, source, timestamp: declared } = await ensureExtract();
osmium('tags-filter', '-O', '-o', cached('filtered.osm.pbf'), pbf, ...FILTERS);
osmium('export', '-O', '-f', 'geojsonseq', '-x', 'print_record_separator=false', '--add-unique-id=type_id',
  '-o', cached('filtered.geojsonseq'), cached('filtered.osm.pbf'));
// Data dei dati: quella scritta nel file, poi quella dichiarata dalla sorgente, infine la data del download.
const timestamp = /osmosis_replication_timestamp=(\S+)/.exec(osmium('fileinfo', pbf))?.[1] ?? declared
  ?? (await stat(pbf)).mtime.toISOString();

// Stessa normalizzazione e classificazione dello snapshot Overpass, un elemento alla volta.
const writer = new TileWriter(`${root}server/data/osm-tiles`);
const seenWays = new Set<number>();
const counts: Record<string, number> = {};
const count = (key: string) => { counts[key] = (counts[key] ?? 0) + 1; };
const tally = (f: OsmFeature) => {
  count('feature');
  if (f.trail) count('sentieri');
  else if (f.scope === 'place') count('luoghi');
  else count(f.certainty);
  if (countsAsData(f)) count('con_dati');
};
for await (const line of createInterface({ input: createReadStream(cached('filtered.geojsonseq')) })) {
  if (!line) continue;
  const el = elementFromGeojson(JSON.parse(line));
  if (!el || !matchesQuery(el)) continue;
  // Una way chiusa può essere esportata due volte (linea e area): si tiene la prima.
  if (el.type === 'way') { if (seenWays.has(el.id)) continue; seenWays.add(el.id); }
  count('elementi');
  for (const f of normalizeOverpass([el])) {
    // L'estratto Geofabrik sborda di poco oltre confine: si tiene solo ciò che sta nell'area dell'app (shared/area.ts).
    const first = f.geometry.type === 'point' ? f.geometry.coords : f.geometry.coords[0];
    if (!inArea(first[0], first[1])) { count('fuori_area'); continue; }
    tally(f);
    writer.add(f);
  }
}

const { index, sizes } = await writer.finish({
  source: `OpenStreetMap contributors (ODbL), estratto ${source} "Italy"`,
  fetchedAt: timestamp,
  scope: 'full',
});
sizes.sort((a, b) => a - b);
const levels = { none: 0, few: 0, some: 0 };
for (const n of Object.values(index.cells)) levels[dataLevel(n)]++;
console.log(`OSM ${timestamp}: ${sizes.length} celle`, counts);
console.log('Celle per quantità di dati:', levels);
console.log(`Dimensione: ${(sizes.reduce((a, b) => a + b, 0) / 1e6).toFixed(1)} MB in tutto, cella più grande ${(sizes[sizes.length - 1] / 1e3).toFixed(0)} kB, `
  + `mediana ${(sizes[sizes.length >> 1] / 1e3).toFixed(1)} kB`);
