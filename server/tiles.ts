// Scrittura e lettura della griglia dei dati OSM (formato in shared/tiles.ts).
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cellsOfFeature, TILE_ZOOM, type OsmIndex, type TileFeature } from '../shared/tiles.ts';
import type { LatLngTuple, OsmDataset, OsmFeature } from '../shared/types.ts';

const round = (v: number) => Math.round(v * 1e6) / 1e6; // 6 decimali ≈ 11 cm: più della precisione dei dati
const roundPoint = ([lat, lng]: LatLngTuple): LatLngTuple => [round(lat), round(lng)];

/** Toglie ciò che il browser ricostruisce da solo (etichetta, fonte, nome già presente nei tag) e arrotonda le coordinate. */
export function compactFeature(f: OsmFeature): TileFeature {
  const geometry: TileFeature['geometry'] = f.geometry.type === 'point'
    ? { type: 'point', coords: roundPoint(f.geometry.coords) }
    : { type: 'line', coords: f.geometry.coords.map(roundPoint) };
  return {
    id: f.id, kind: f.kind, certainty: f.certainty, scope: f.scope,
    ...(f.trail ? { trail: true as const } : {}), geometry, tags: f.tags,
  };
}

/**
 * Conta come "dato utile" di una cella: un elemento del percorso pedonale con un'informazione su ostacoli, fondo,
 * pendenza, larghezza o scivoli. Non contano i luoghi (negozi, edifici), i sentieri e gli attraversamenti
 * di cui si sa solo che esistono (certezza "info" su un punto: è proprio l'informazione che manca).
 */
export function countsAsData(f: Pick<OsmFeature, 'scope' | 'trail' | 'certainty' | 'geometry'>): boolean {
  return f.scope === 'path' && !f.trail && !(f.certainty === 'info' && f.geometry.type === 'point');
}

export interface BuiltTiles { index: OsmIndex; tiles: Map<string, TileFeature[]> }

/** Distribuisce gli elementi nelle celle. Una linea che attraversa più celle è salvata intera in ognuna. */
export function buildTiles(features: OsmFeature[], meta: Pick<OsmIndex, 'source' | 'fetchedAt' | 'scope'>): BuiltTiles {
  const tiles = new Map<string, TileFeature[]>();
  const cells: Record<string, number> = {};
  for (const f of features) {
    const compact = compactFeature(f);
    for (const key of cellsOfFeature(f)) {
      let list = tiles.get(key);
      if (!list) { list = []; tiles.set(key, list); cells[key] = 0; }
      list.push(compact);
      if (countsAsData(f)) cells[key]++;
    }
  }
  return { index: { ...meta, zoom: TILE_ZOOM, cells }, tiles };
}

/** Scrive la griglia in una cartella nuova e la scambia con la precedente solo a scrittura finita. */
export async function writeTiles(dir: string, { index, tiles }: BuiltTiles): Promise<void> {
  const tmp = `${dir}.tmp`;
  await rm(tmp, { recursive: true, force: true });
  const made = new Set<string>();
  for (const [key, features] of tiles) {
    const folder = join(tmp, String(index.zoom), key.split('/')[0]);
    if (!made.has(folder)) { await mkdir(folder, { recursive: true }); made.add(folder); }
    await writeFile(join(tmp, String(index.zoom), `${key}.json`), JSON.stringify({ features }));
  }
  await mkdir(tmp, { recursive: true });
  await writeFile(join(tmp, 'index.json'), JSON.stringify(index));
  await rm(dir, { recursive: true, force: true });
  await rename(tmp, dir);
}

/**
 * Garantisce che la griglia esista. Senza i dati regionali (`npm run osm:download` oppure `npm run osm:build`)
 * la crea dallo snapshot demo incluso nel repository: l'app parte comunque, con i soli dati della zona universitaria di Pisa.
 */
export async function ensureTiles(dir: string, seedFile: string): Promise<OsmIndex> {
  const indexFile = join(dir, 'index.json');
  if (await stat(indexFile).then(() => true, () => false)) return JSON.parse(await readFile(indexFile, 'utf8')) as OsmIndex;
  const seed = JSON.parse(await readFile(seedFile, 'utf8')) as OsmDataset;
  const built = buildTiles(seed.features, { source: seed.source, fetchedAt: seed.fetchedAt, scope: 'demo' });
  await writeTiles(dir, built);
  return built.index;
}
