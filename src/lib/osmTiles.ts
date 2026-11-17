// Dati OpenStreetMap a celle (shared/tiles.ts): si scaricano solo le celle della zona guardata e quelle
// attraversate dal percorso. Con il server le serve /api/osm/, nella versione statica sono file in data/osm/.
import { useEffect, useState } from 'react';
import { cellsAlongLine, cellsInBounds, decodeIndex, TILE_ZOOM, type OsmIndex, type OsmIndexFile, type OsmTile } from '../../shared/tiles.ts';
import type { LatLngTuple, OsmFeature } from '../../shared/types.ts';
import { BASE, STATIC } from '../landing/env.ts';

export type Bounds = [number, number, number, number]; // sud, ovest, nord, est

/** Sotto questo zoom la mappa mostra quanta informazione c'è, non i singoli elementi: una vista larga richiederebbe decine di celle. */
export const FEATURE_ZOOM = 16;
/** Celle tenute in memoria: abbastanza per un percorso di 10 km e la zona attorno, senza crescere all'infinito. */
const MAX_CACHED = 80;

const root = STATIC ? `${BASE}data/osm/` : '/api/osm/';
let index: Promise<OsmIndex> | null = null;
const cells = new Map<string, Promise<OsmFeature[]>>();

async function getJson<T>(path: string, missing?: T): Promise<T> {
  const res = await fetch(`${root}${path}`);
  // Una cella che non esiste è una cella senza elementi (succede nella versione statica, che pubblica celle ridotte).
  // Alcuni server statici rispondono a un file mancante con la pagina iniziale: conta come mancante anche quella.
  if (missing !== undefined && (res.status === 404 || !(res.headers.get('content-type') ?? '').includes('json'))) return missing;
  if (!res.ok) throw new Error(`OSM ${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Indice delle celle: quali esistono e quanti dati contengono. Un errore non resta in cache: si riprova alla chiamata successiva. */
export function loadOsmIndex(): Promise<OsmIndex> {
  index ??= getJson<OsmIndexFile>('index.json').then(decodeIndex).catch((e: unknown) => { index = null; throw e; });
  return index;
}

function loadCell(key: string): Promise<OsmFeature[]> {
  let hit = cells.get(key);
  if (hit) {
    cells.delete(key); // riletta: torna in fondo alla coda, l'ultima a essere scartata
  } else {
    hit = getJson<OsmTile>(`${TILE_ZOOM}/${key}.json`, { features: [] })
      .then((t) => t.features.map((f): OsmFeature => ({ ...f, source: 'osm', ...(f.tags.name ? { name: f.tags.name } : {}) })))
      .catch((e: unknown) => { cells.delete(key); throw e; });
  }
  cells.set(key, hit);
  for (const old of cells.keys()) { if (cells.size <= MAX_CACHED) break; cells.delete(old); }
  return hit;
}

/** Elementi delle celle indicate, senza doppioni (una linea a cavallo di due celle sta in entrambe). Le celle senza dati non si chiedono. */
export async function loadCells(keys: string[]): Promise<OsmFeature[]> {
  const idx = await loadOsmIndex();
  const lists = await Promise.all(keys.filter((k) => k in idx.cells).map(loadCell));
  const seen = new Set<string>();
  return lists.flat().filter((f) => !seen.has(f.id) && seen.add(f.id));
}

/** Quanti elementi con dati utili ci sono nelle celle che toccano il riquadro (dall'indice, senza scaricarle). */
export function dataInBounds(idx: OsmIndex, bounds: Bounds): number {
  return cellsInBounds(bounds).reduce((n, k) => n + (idx.cells[k] ?? 0), 0);
}

export function useOsmIndex(onError?: () => void): OsmIndex | null {
  const [idx, setIdx] = useState<OsmIndex | null>(null);
  useEffect(() => {
    let live = true;
    loadOsmIndex().then((i) => { if (live) setIdx(i); }).catch(() => { if (live) onError?.(); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return idx;
}

/**
 * Elementi da disegnare per la zona guardata. Sotto FEATURE_ZOOM non si scarica nulla.
 * Mentre arrivano le celle nuove restano in vista gli elementi di prima, così la mappa non lampeggia.
 */
export function useViewFeatures(view: { bounds: Bounds; zoom: number } | null, onError?: () => void): OsmFeature[] {
  const [features, setFeatures] = useState<OsmFeature[]>([]);
  const wanted = view && view.zoom >= FEATURE_ZOOM ? cellsInBounds(view.bounds).join(' ') : '';
  useEffect(() => {
    if (!wanted) { setFeatures([]); return; }
    let live = true;
    loadCells(wanted.split(' ')).then((f) => { if (live) setFeatures(f); }).catch(() => { if (live) onError?.(); });
    return () => { live = false; };
  }, [wanted]); // eslint-disable-line react-hooks/exhaustive-deps
  return features;
}

/**
 * Elementi lungo uno o più percorsi: solo le celle che i percorsi attraversano.
 * `null` finché i dati non sono arrivati: prima di averli letti non si dice nulla sugli ostacoli.
 */
export function useRouteFeatures(lines: (LatLngTuple[] | undefined)[], onError?: () => void): OsmFeature[] | null {
  const [state, setState] = useState<{ key: string; features: OsmFeature[] } | null>(null);
  const keys = [...new Set(lines.flatMap((l) => (l ? cellsAlongLine(l) : [])))].sort().join(' ');
  useEffect(() => {
    if (!keys) { setState(null); return; }
    let live = true;
    loadCells(keys.split(' ')).then((features) => { if (live) setState({ key: keys, features }); })
      // Dati non arrivati: l'errore viene mostrato e l'analisi prosegue senza elementi OSM, come dichiarato nel messaggio.
      .catch(() => { if (live) { onError?.(); setState({ key: keys, features: [] }); } });
    return () => { live = false; };
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps
  return state && state.key === keys ? state.features : null;
}
