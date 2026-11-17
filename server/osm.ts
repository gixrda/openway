import { classifyPath, classifyPlace } from '../shared/osmClassify.ts';
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

interface OverpassElement {
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
    });
  }
  return out;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
