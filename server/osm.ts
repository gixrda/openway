import { classifyPath, classifyPlace, isTrail } from '../shared/osmClassify.ts';
import type { LatLngTuple, OsmFeature } from '../shared/types.ts';

// Le regole di classificazione stanno in shared/: servono anche all'interfaccia per tradurre le etichette.
export { classifyPath };

export function overpassQuery([s, w, n, e]: [number, number, number, number]): string {
  const b = `${s},${w},${n},${e}`;
  return `[out:json][timeout:60];
(
  way["highway"~"^(footway|pedestrian|path|steps)$"](${b});
  way["sidewalk"](${b});
  node["kerb"](${b});
  node["highway"="crossing"](${b});
  node["barrier"](${b});
  nwr["wheelchair"](${b});
);
out tags geom;`;
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

const KEPT_TAGS = [
  'highway', 'kerb', 'kerb:height', 'barrier', 'surface', 'smoothness', 'incline', 'width',
  'wheelchair', 'step_count', 'ramp:wheelchair', 'handrail', 'tactile_paving', 'crossing',
  'name', 'amenity', 'shop', 'tourism',
];

export function normalizeOverpass(elements: OverpassElement[]): OsmFeature[] {
  const out: OsmFeature[] = [];
  for (const el of elements) {
    const t = el.tags;
    if (!t || el.type === 'relation') continue;
    const isPath = Boolean(t.highway || t.kerb || t.barrier || t['kerb:height']);
    const c = isPath ? classifyPath(t) : classifyPlace(t);
    if (!c) continue;

    let geometry: OsmFeature['geometry'];
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
      geometry = { type: 'point', coords: [el.lat, el.lon] };
    } else if (el.type === 'way' && el.geometry && el.geometry.length > 0) {
      const pts = el.geometry.map((g): LatLngTuple => [g.lat, g.lon]);
      // Un luogo (edificio, area) è mostrato come punto al centro della sua geometria.
      geometry = isPath
        ? { type: 'line', coords: pts }
        : { type: 'point', coords: [avg(pts.map((p) => p[0])), avg(pts.map((p) => p[1]))] };
    } else continue;

    const tags = Object.fromEntries(KEPT_TAGS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]]));
    out.push({
      id: `${el.type}/${el.id}`, source: 'osm', scope: isPath ? 'path' : 'place',
      ...c, ...(t.name ? { name: t.name } : {}), geometry, tags,
      // I sentieri restano nei dati per l'analisi del percorso, ma non vengono disegnati sulla mappa.
      ...(el.type === 'way' && isPath && isTrail(t) ? { trail: true } : {}),
    });
  }
  return out;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const FOOT_WAYS = new Set(['footway', 'pedestrian', 'path', 'steps']);

/** Stessi criteri della query Overpass, per i dati filtrati in locale da un estratto (scripts/build-osm.ts). */
export function matchesQuery(el: OverpassElement): boolean {
  const t = el.tags;
  if (!t || el.type === 'relation') return false;
  if (t.wheelchair) return true;
  return el.type === 'way'
    ? FOOT_WAYS.has(t.highway) || t.sidewalk !== undefined
    : t.kerb !== undefined || t.highway === 'crossing' || t.barrier !== undefined;
}

interface GeojsonFeature {
  id?: string;
  geometry?: { type: string; coordinates: unknown };
  properties?: Record<string, string> | null;
}

/**
 * Una riga di `osmium export --add-unique-id=type_id` nella forma degli elementi Overpass (`out tags geom`).
 * Gli id sono n<nodo>, w<way> e a<area>: un'area con numero pari viene da una way chiusa (id × 2),
 * una con numero dispari da una relazione (ignorata, come nella query Overpass normalizzata).
 */
export function elementFromGeojson(f: GeojsonFeature): OverpassElement | null {
  const m = /^([nwa])(\d+)$/.exec(f.id ?? '');
  const g = f.geometry;
  if (!m || !g || !f.properties) return null;
  const tags = f.properties;
  const num = Number(m[2]);
  if (m[1] === 'n' && g.type === 'Point') {
    const [lon, lat] = g.coordinates as [number, number];
    return { type: 'node', id: num, lat, lon, tags };
  }
  let line: [number, number][] | undefined;
  if (m[1] === 'w' && g.type === 'LineString') line = g.coordinates as [number, number][];
  // Way chiusa esportata come area (es. una piazza con area=yes): si usa il contorno esterno.
  if (m[1] === 'a' && num % 2 === 0 && g.type === 'MultiPolygon') line = (g.coordinates as [number, number][][][])[0]?.[0];
  if (!line?.length) return null;
  return { type: 'way', id: m[1] === 'a' ? num / 2 : num, geometry: line.map(([lon, lat]) => ({ lat, lon })), tags };
}
