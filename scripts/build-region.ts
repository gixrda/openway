// Rigenera shared/region.ts: il confine della Toscana semplificato, usato per validare i punti e per la mappa.
// Uso: npm run osm:region   (dopo npm run osm:build, che salva il confine preciso in .cache/osm/region.geojson)
// Il file generato va nel repository: cambia solo se cambia il confine regionale.
import { readFile, writeFile } from 'node:fs/promises';

const TOLERANCE_M = 300; // scostamento massimo dal confine vero (Douglas-Peucker)
const MIN_AREA_KM2 = 1.5; // isole e scogli più piccoli si scartano (restano Gorgona e Giannutri, ~2 km²)
const LAT0 = 43.4;
const KX = Math.cos((LAT0 * Math.PI) / 180) * 111.32, KY = 110.54; // km per grado

type Ring = [number, number][]; // [lng, lat] come in GeoJSON

const areaKm2 = (r: Ring) => Math.abs(r.reduce((a, p, i) => {
  const q = r[(i + 1) % r.length];
  return a + (p[0] * KX) * (q[1] * KY) - (q[0] * KX) * (p[1] * KY);
}, 0)) / 2;

function simplify(points: Ring, tolKm: number): Ring {
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = [points[a][0] * KX, points[a][1] * KY], [bx, by] = [points[b][0] * KX, points[b][1] * KY];
    const len = Math.hypot(bx - ax, by - ay);
    let far = -1, max = tolKm;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = [points[i][0] * KX, points[i][1] * KY];
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > max) { max = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

const src = new URL('../.cache/osm/region.geojson', import.meta.url);
const { geometry } = JSON.parse(await readFile(src, 'utf8')) as { geometry: { type: string; coordinates: Ring[][] } };
if (geometry.type !== 'MultiPolygon') throw new Error('Confine non valido: esegui prima npm run osm:build.');

const rings = geometry.coordinates
  .map((polygon) => polygon[0]) // solo il contorno esterno: le enclave interne non servono a validare un punto
  .filter((r) => areaKm2(r) >= MIN_AREA_KM2)
  .sort((a, b) => areaKm2(b) - areaKm2(a))
  // Un anello chiuso va semplificato in due metà, altrimenti primo e ultimo punto coincidono e la distanza non ha senso.
  .map((r) => {
    const mid = r.length >> 1;
    return [...simplify(r.slice(0, mid + 1), TOLERANCE_M / 1000), ...simplify(r.slice(mid), TOLERANCE_M / 1000).slice(1)];
  });

const all = rings.flat();
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const bounds = [Math.min(...all.map((p) => p[1])), Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0]))].map(r4);
const body = rings.map((r) => `  [${r.map(([lng, lat]) => `[${r4(lat)},${r4(lng)}]`).join(',')}],`).join('\n');

await writeFile(new URL('../shared/region.ts', import.meta.url), `// GENERATO da scripts/build-region.ts (npm run osm:region): non modificare a mano.
// Confine della Toscana (relazione OpenStreetMap ISO3166-2=IT-52, © OpenStreetMap contributors, ODbL),
// semplificato con una tolleranza di ${TOLERANCE_M} m; isole sotto ${MIN_AREA_KM2} km² escluse. Coordinate [lat, lng].
import type { LatLngTuple } from './types.ts';

/** Contorni esterni: il primo è la terraferma, gli altri le isole dell'Arcipelago e le exclave. */
export const REGION_RINGS: LatLngTuple[][] = [
${body}
];

/** Riquadro che contiene la regione: [sud, ovest, nord, est]. */
export const REGION_BOUNDS: [number, number, number, number] = [${bounds.join(', ')}];
`);
console.log(`Confine: ${geometry.coordinates.length} poligoni → ${rings.length} contorni, ${all.length} punti`, rings.map((r) => `${r.length} pt, ${areaKm2(r).toFixed(0)} km²`));
