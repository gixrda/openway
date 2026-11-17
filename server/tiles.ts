// Scrittura e lettura della griglia dei dati OSM (formato in shared/tiles.ts).
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cellsOfFeature, decodeIndex, encodeIndex, TILE_ZOOM, type OsmIndex, type OsmIndexFile, type TileFeature } from '../shared/tiles.ts';
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
  await writeFile(join(tmp, 'index.json'), JSON.stringify(encodeIndex(index)));
  await rm(dir, { recursive: true, force: true });
  await rename(tmp, dir);
}

/**
 * Garantisce che la griglia esista. Senza i dati completi (`npm run osm:download` oppure `npm run osm:build`)
 * la crea dallo snapshot demo incluso nel repository: l'app parte comunque, con i soli dati della zona universitaria di Pisa.
 */
export async function ensureTiles(dir: string, seedFile: string): Promise<OsmIndex> {
  const indexFile = join(dir, 'index.json');
  if (await stat(indexFile).then(() => true, () => false)) return decodeIndex(JSON.parse(await readFile(indexFile, 'utf8')) as OsmIndexFile);
  const seed = JSON.parse(await readFile(seedFile, 'utf8')) as OsmDataset;
  const built = buildTiles(seed.features, { source: seed.source, fetchedAt: seed.fetchedAt, scope: 'demo' });
  await writeTiles(dir, built);
  return built.index;
}

/**
 * Scrive la griglia senza tenere tutti gli elementi in memoria: l'Italia intera sono milioni di elementi.
 * Ogni elemento viene accodato a un file provvisorio per zona (32 × 32 celle, ~55 km di lato); alla fine
 * si rilegge una zona alla volta e se ne scrivono le celle. La cartella precedente viene sostituita solo a lavoro finito.
 */
export class TileWriter {
  private readonly tmp: string;
  private readonly parts: string;
  private readonly pending = new Map<string, string[]>();
  private pendingBytes = 0;
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.tmp = `${dir}.tmp`;
    this.parts = join(this.tmp, 'parts');
    rmSync(this.tmp, { recursive: true, force: true });
    mkdirSync(this.parts, { recursive: true });
  }

  add(f: OsmFeature): void {
    const json = JSON.stringify(compactFeature(f));
    const data = countsAsData(f) ? '1' : '0';
    for (const key of cellsOfFeature(f)) {
      const [x, y] = key.split('/').map(Number);
      const part = `${x >> 5}_${y >> 5}`;
      const line = `${key}\t${data}\t${json}\n`;
      const list = this.pending.get(part);
      if (list) list.push(line); else this.pending.set(part, [line]);
      this.pendingBytes += line.length;
    }
    if (this.pendingBytes > 64_000_000) this.flush();
  }

  private flush(): void {
    for (const [part, lines] of this.pending) appendFileSync(join(this.parts, part), lines.join(''));
    this.pending.clear();
    this.pendingBytes = 0;
  }

  /** Scrive celle e indice; restituisce l'indice e le dimensioni in byte di ogni cella (per il riepilogo). */
  async finish(meta: Pick<OsmIndex, 'source' | 'fetchedAt' | 'scope'>): Promise<{ index: OsmIndex; sizes: number[] }> {
    this.flush();
    const cells: Record<string, number> = {};
    const sizes: number[] = [];
    for (const part of readdirSync(this.parts)) {
      const byCell = new Map<string, { features: string[]; data: number }>();
      for (const line of readFileSync(join(this.parts, part), 'utf8').split('\n')) {
        if (!line) continue;
        const [key, data, json] = line.split('\t');
        let cell = byCell.get(key);
        if (!cell) { cell = { features: [], data: 0 }; byCell.set(key, cell); }
        cell.features.push(json);
        cell.data += Number(data);
      }
      for (const [key, cell] of byCell) {
        const folder = join(this.tmp, String(TILE_ZOOM), key.split('/')[0]);
        mkdirSync(folder, { recursive: true });
        const body = `{"features":[${cell.features.join(',')}]}`;
        writeFileSync(join(this.tmp, String(TILE_ZOOM), `${key}.json`), body);
        cells[key] = cell.data;
        sizes.push(body.length);
      }
    }
    rmSync(this.parts, { recursive: true, force: true });
    const index: OsmIndex = { ...meta, zoom: TILE_ZOOM, cells };
    writeFileSync(join(this.tmp, 'index.json'), JSON.stringify(encodeIndex(index)));
    await rm(this.dir, { recursive: true, force: true });
    await rename(this.tmp, this.dir);
    return { index, sizes };
  }
}

/**
 * Copia ridotta della griglia per la landing statica (GitHub Pages ha un limite di 1 GB e l'Italia intera ne pesa 0,7).
 * La landing disegna solo gli ostacoli noti: nelle celle restano quelli. Le celle in `full` (i tragitti demo)
 * restano complete, perché lì l'analisi del percorso usa tutti gli elementi. L'indice è copiato intero:
 * la quantità di dati mostrata è quella vera. Le celle rimaste vuote non vengono scritte.
 */
export async function writeLandingTiles(src: string, dest: string, full: Set<string>): Promise<{ cells: number; bytes: number }> {
  const index = decodeIndex(JSON.parse(await readFile(join(src, 'index.json'), 'utf8')) as OsmIndexFile);
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, 'index.json'), await readFile(join(src, 'index.json')));
  let cells = 0, bytes = 0;
  for (const key of Object.keys(index.cells)) {
    const file = join(String(index.zoom), `${key}.json`);
    let body = readFileSync(join(src, file), 'utf8');
    if (!full.has(key)) {
      const { features } = JSON.parse(body) as { features: TileFeature[] };
      const known = features.filter((f) => f.certainty === 'known_obstacle' && f.scope === 'path');
      if (!known.length) continue;
      body = JSON.stringify({ features: known });
    }
    mkdirSync(join(dest, String(index.zoom), key.split('/')[0]), { recursive: true });
    writeFileSync(join(dest, file), body);
    cells++;
    bytes += body.length;
  }
  return { cells, bytes };
}
