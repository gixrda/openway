// Rigenera shared/region.ts: il confine dell'Italia semplificato, usato per validare i punti e per la mappa.
// Uso: npm run osm:region   (legge l'estratto Geofabrik in .cache/osm/, scaricandolo se manca; richiede osmium-tool)
// Il confine è l'insieme delle 20 regioni (relazioni admin_level=4 con ISO3166-2=IT-nn): seguono la costa,
// mentre il confine di Stato in OpenStreetMap comprende le acque territoriali.
// Il file generato va nel repository: cambia solo se cambiano i confini regionali.
import { readFile, writeFile } from 'node:fs/promises';
import { cached, ensureExtract, osmium } from './osm-extract.ts';

const REGIONS = 20;
const TOLERANCE_M = 800; // scostamento massimo dal confine vero (Douglas-Peucker): il file finisce nel browser, deve restare piccolo
const MIN_AREA_KM2 = 0.5; // isole e scogli più piccoli si scartano: li copre comunque il margine di shared/area.ts se sono vicini a terra
const KY = 110.54; // km per grado di latitudine
const kx = (lat: number) => Math.cos((lat * Math.PI) / 180) * 111.32;

type Ring = [number, number][]; // [lng, lat] come in GeoJSON

function areaKm2(r: Ring): number {
  const k = kx(r[0][1]);
  return Math.abs(r.reduce((a, p, i) => {
    const q = r[(i + 1) % r.length];
    return a + (p[0] * k) * (q[1] * KY) - (q[0] * k) * (p[1] * KY);
  }, 0)) / 2;
}

function simplify(points: Ring, tolKm: number): Ring {
  const k = kx(points[0][1]);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = [points[a][0] * k, points[a][1] * KY], [bx, by] = [points[b][0] * k, points[b][1] * KY];
    const len = Math.hypot(bx - ax, by - ay);
    let far = -1, max = tolKm;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = [points[i][0] * k, points[i][1] * KY];
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > max) { max = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

const pbf = await ensureExtract();
osmium('tags-filter', '-O', '-o', cached('boundary.osm.pbf'), pbf, 'r/admin_level=4');
osmium('export', '-O', '-o', cached('boundary.geojson'), '--geometry-types=polygon', cached('boundary.osm.pbf'));
const { features } = JSON.parse(await readFile(cached('boundary.geojson'), 'utf8')) as {
  features: { properties: Record<string, string>; geometry: { type: string; coordinates: Ring[][] } }[];
};
const regions = features.filter((f) => /^IT-\d\d$/.test(f.properties['ISO3166-2'] ?? '') && f.geometry.type === 'MultiPolygon');
const codes = [...new Set(regions.map((f) => f.properties['ISO3166-2']))].sort();
// Una relazione incompleta nell'estratto farebbe sparire una regione intera: meglio fermarsi.
if (codes.length !== REGIONS) throw new Error(`Trovate ${codes.length} regioni su ${REGIONS} (${codes.join(', ')}): shared/region.ts non è stato modificato.`);

const rings = regions
  .flatMap((f) => f.geometry.coordinates.map((polygon) => polygon[0])) // solo i contorni esterni: le enclave interne non servono a validare un punto
  .filter((r) => areaKm2(r) >= MIN_AREA_KM2)
  .sort((a, b) => areaKm2(b) - areaKm2(a))
  // Un anello chiuso va semplificato in due metà, altrimenti primo e ultimo punto coincidono e la distanza non ha senso.
  .map((r) => {
    const mid = r.length >> 1;
    return [...simplify(r.slice(0, mid + 1), TOLERANCE_M / 1000), ...simplify(r.slice(mid), TOLERANCE_M / 1000).slice(1)];
  });

const r3 = (v: number) => Math.round(v * 1e3) / 1e3; // ~100 m: molto meno della tolleranza
let [s, w, n, e] = [Infinity, Infinity, -Infinity, -Infinity];
for (const [lng, lat] of rings.flat()) { s = Math.min(s, lat); w = Math.min(w, lng); n = Math.max(n, lat); e = Math.max(e, lng); }
const body = rings.map((r) => `  [${r.map(([lng, lat]) => `[${r3(lat)},${r3(lng)}]`).join(',')}],`).join('\n');

await writeFile(new URL('../shared/region.ts', import.meta.url), `// GENERATO da scripts/build-region.ts (npm run osm:region): non modificare a mano.
// Confini delle ${REGIONS} regioni italiane (relazioni OpenStreetMap admin_level=4, © OpenStreetMap contributors, ODbL),
// semplificati con una tolleranza di ${TOLERANCE_M} m; isole sotto ${MIN_AREA_KM2} km² escluse. Coordinate [lat, lng].
import type { LatLngTuple } from './types.ts';

/** Contorni esterni di regioni e isole, dal più grande al più piccolo. I confini tra regioni compaiono due volte. */
export const REGION_RINGS: LatLngTuple[][] = [
${body}
];

/** Riquadro che contiene tutti i contorni: [sud, ovest, nord, est]. */
export const REGION_BOUNDS: [number, number, number, number] = [${[s, w, n, e].map(r3).join(', ')}];
`);
console.log(`Confine: ${codes.length} regioni → ${rings.length} contorni, ${rings.flat().length} punti`);
