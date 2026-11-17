// Griglia dei dati OpenStreetMap: i dati sono divisi in celle, una per file, così il browser scarica
// solo quelle che servono (la zona guardata e le celle attraversate dal percorso), mai l'intera regione.
// Le celle sono le tile "slippy map" standard al livello 14: circa 1,8 km di lato alla latitudine della Toscana.
import type { LatLngTuple, OsmFeature } from './types.ts';

export const TILE_ZOOM = 14;
const N = 2 ** TILE_ZOOM;

/** Elemento OSM come sta in una cella: senza etichetta (si ricalcola dai tag nella lingua scelta), fonte e nome (è nei tag). */
export type TileFeature = Omit<OsmFeature, 'label' | 'source' | 'name'>;

export interface OsmTile { features: TileFeature[] }

/**
 * Indice delle celle (index.json). `cells` elenca solo le celle che hanno un file: chiave "x/y",
 * valore = numero di elementi con informazioni utili a chi si muove in sedia a rotelle
 * (ostacoli noti, possibili difficoltà, elementi favorevoli; sentieri e semplici dati descrittivi esclusi).
 */
export interface OsmIndex {
  source: string;
  /** Data dei dati OpenStreetMap (non della generazione dei file) */
  fetchedAt: string;
  /** region = tutta la regione; demo = solo lo snapshot della zona universitaria di Pisa incluso nel repository */
  scope: 'region' | 'demo';
  zoom: number;
  cells: Record<string, number>;
}

export const tileX = (lng: number): number => Math.min(N - 1, Math.max(0, Math.floor(((lng + 180) / 360) * N)));

export function tileY(lat: number): number {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return Math.min(N - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N)));
}

export const cellKey = (lat: number, lng: number): string => `${tileX(lng)}/${tileY(lat)}`;

/** Celle che toccano un riquadro [sud, ovest, nord, est]. */
export function cellsInBounds([s, w, n, e]: [number, number, number, number]): string[] {
  const keys: string[] = [];
  for (let x = tileX(w); x <= tileX(e); x++) for (let y = tileY(n); y <= tileY(s); y++) keys.push(`${x}/${y}`);
  return keys;
}

/**
 * Celle attraversate da una linea, allargata di `padM` metri: per un percorso sono molte meno
 * di quelle del suo riquadro. I tratti lunghi vengono campionati ogni ~200 m per non saltare una cella.
 */
export function cellsAlongLine(line: LatLngTuple[], padM = 30): string[] {
  const keys = new Set<string>();
  const add = ([lat, lng]: LatLngTuple) => {
    const dLat = padM / 110_540;
    const dLng = padM / (111_320 * Math.cos((lat * Math.PI) / 180));
    for (const k of cellsInBounds([lat - dLat, lng - dLng, lat + dLat, lng + dLng])) keys.add(k);
  };
  for (let i = 0; i < line.length; i++) {
    add(line[i]);
    if (i === 0) continue;
    const [a, b] = [line[i - 1], line[i]];
    const steps = Math.ceil(Math.hypot((b[0] - a[0]) * 110_540, (b[1] - a[1]) * 80_000) / 200);
    for (let k = 1; k < steps; k++) add([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
  }
  return [...keys];
}

/** Celle in cui va salvato un elemento: quella del punto, o tutte quelle toccate dalla linea. */
export function cellsOfFeature(f: Pick<OsmFeature, 'geometry'>): string[] {
  return f.geometry.type === 'point' ? [cellKey(...f.geometry.coords)] : cellsAlongLine(f.geometry.coords, 0);
}

/**
 * Quanti dati ha una cella (~3 km²), per dirlo a chi guarda la mappa:
 * none = nessun dato utile; few = da 1 a FEW_DATA_MAX elementi; some = di più.
 * In Toscana (16/11/2026) solo ~300 celle su ~5.700 superano la soglia: sono i centri delle città.
 * "some" non vuol dire che la zona è mappata bene, solo che l'assenza di un ostacolo sulla mappa pesa un po' di più.
 */
export const FEW_DATA_MAX = 49;
export type DataLevel = 'none' | 'few' | 'some';
export const dataLevel = (count: number | undefined): DataLevel => (!count ? 'none' : count <= FEW_DATA_MAX ? 'few' : 'some');
