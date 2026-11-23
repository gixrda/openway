import type { LatLngTuple, RouteResult, RouteSafety, SafetySegment } from '../shared/types.ts';
import { distToLine, projector } from '../shared/geo.ts';
import { HttpError, USER_AGENT } from './errors.ts';
import { m, MESSAGES } from './messages.ts';

/**
 * Verifica dei tratti di un percorso, indipendente dal servizio che l'ha calcolato.
 * Valhalla /trace_attributes associa la geometria alla rete OSM e restituisce, per ogni tratto, tipo d'uso,
 * classe stradale e presenza di marciapiede. I divieti di accesso (foot=no, access=no, autostrade) sono già
 * esclusi dal router: qui si riconoscono i tratti in carreggiata e quelli pericolosi per scegliere tra le alternative.
 */

type Edge = {
  use?: string; road_class?: string; sidewalk?: string; length?: number; names?: string[];
  begin_shape_index?: number; end_shape_index?: number; way_id?: number;
};

// Infrastruttura separata dal traffico (o zone residenziali a priorità pedonale: living_street).
const PEDESTRIAN_USES = new Set([
  'footway', 'sidewalk', 'pedestrian', 'path', 'pedestrian_crossing', 'living_street', 'elevator', 'cycleway', 'track', 'bridleway',
]);
const STEP_USES = new Set(['steps', 'escalator']);
// Senza marciapiede mappato, camminare su queste strade è un pericolo identificabile: il percorso viene scartato.
const MAIN_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
// Il primo e l'ultimo tratto collegano il punto scelto sulla mappa alla rete: se brevi non indicano un cammino in carreggiata.
const ACCESS_M = 20;
// Frammenti più corti sono rumore dell'aggancio della geometria alla rete, non tratti percorsi.
const NOISE_M = 3;
// Si accettano fino a 2 m di percorso in più per ogni metro di carreggiata senza marciapiede evitato.
const DETOUR_PER_CARRIAGEWAY_M = 2;
// Scarto massimo tra la geometria riconosciuta da trace_attributes e quella del percorso perché gli id delle way valgano.
const TRACE_MATCH_M = 1;

/** Testo italiano (lingua di riferimento); a chi usa l'app arriva quello della lingua della richiesta. */
export const NOT_VERIFIABLE = MESSAGES.it.notVerifiable;

export function decodePolyline6(str: string): LatLngTuple[] {
  const out: LatLngTuple[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += d; else lng += d;
    }
    out.push([lat / 1e6, lng / 1e6]);
  }
  return out;
}

export function classifyEdges(edges: Edge[], shape: LatLngTuple[]): RouteSafety {
  let pedestrianM = 0, sidewalkM = 0, carriagewayM = 0;
  const segments: (SafetySegment & { endIndex?: number })[] = [];
  edges.forEach((e, i) => {
    const m = (e.length ?? 0) * 1000;
    const use = e.use ?? 'other';
    let kind: SafetySegment['kind'] | null = null;
    if (STEP_USES.has(use)) kind = 'steps';
    else if (PEDESTRIAN_USES.has(use)) pedestrianM += m;
    else if (e.sidewalk && e.sidewalk !== 'none') sidewalkM += m;
    else if (((i === 0 || i === edges.length - 1) && m < ACCESS_M) || m < NOISE_M) pedestrianM += m;
    else kind = MAIN_ROADS.has(e.road_class ?? '') ? 'main_road' : 'carriageway';
    if (!kind) return;
    if (kind !== 'steps') carriagewayM += m;
    const coords = shape.slice(e.begin_shape_index ?? 0, (e.end_shape_index ?? 0) + 1);
    const name = e.names?.[0];
    const last = segments.at(-1);
    // Tratti consecutivi dello stesso tipo e della stessa via diventano un unico segmento.
    if (last && last.kind === kind && last.name === name && last.endIndex === e.begin_shape_index) {
      last.lengthM += m;
      last.coords.push(...coords.slice(1));
      last.endIndex = e.end_shape_index;
    } else {
      segments.push({ kind, lengthM: m, ...(name ? { name } : {}), coords, endIndex: e.end_shape_index });
    }
  });
  const hasHazard = segments.some((s) => s.kind !== 'carriageway');
  return {
    checked: true,
    pedestrianM: Math.round(pedestrianM), sidewalkM: Math.round(sidewalkM), carriagewayM: Math.round(carriagewayM),
    segments: segments.map(({ endIndex: _, ...s }) => ({ ...s, lengthM: Math.round(s.lengthM) })),
    verifiable: carriagewayM === 0 && !hasHazard,
    alternatives: 1,
  };
}

/**
 * Id delle way percorse, senza doppioni. undefined se la geometria riconosciuta si scosta dal percorso: quando
 * Valhalla non riesce a seguire il percorso tratto per tratto lo aggancia alla rete "a occhio" e può finire sulla via
 * parallela (misurato il 21/11/2026: fino a 9 m di scarto in 3 percorsi su 16). In quel caso gli id non dicono dove si passa.
 */
export function tracedWayIds(edges: Edge[], shape: LatLngTuple[], coords: LatLngTuple[]): number[] | undefined {
  const ids = edges.map((e) => e.way_id);
  if (!ids.every((id): id is number => typeof id === 'number' && Number.isInteger(id))) return undefined;
  if (!shape.length || !coords.length) return undefined;
  const xy = projector(coords[0][0]);
  const [a, b] = [shape.map(xy), coords.map(xy)];
  // Nei due versi: un tratto in più o uno in meno contano entrambi come scarto.
  if (a.some((p) => distToLine(p, b) > TRACE_MATCH_M) || b.some((p) => distToLine(p, a) > TRACE_MATCH_M)) return undefined;
  return [...new Set(ids)];
}

/** Classifica i tratti di un percorso. Restituisce null se la verifica non è disponibile. */
export async function assessRoute(coords: LatLngTuple[], wheelchair: boolean): Promise<RouteSafety | null> {
  try {
    const res = await fetch('https://valhalla1.openstreetmap.de/trace_attributes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
      body: JSON.stringify({
        shape: coords.map(([lat, lon]) => ({ lat, lon })),
        shape_match: 'walk_or_snap',
        costing: 'pedestrian',
        costing_options: { pedestrian: { type: wheelchair ? 'wheelchair' : 'foot' } },
        filters: {
          attributes: ['shape', 'edge.use', 'edge.road_class', 'edge.sidewalk', 'edge.length', 'edge.names', 'edge.begin_shape_index', 'edge.end_shape_index', 'edge.way_id'],
          action: 'include',
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { edges?: Edge[]; shape?: string };
    if (!json.edges?.length || typeof json.shape !== 'string') return null;
    const shape = decodePolyline6(json.shape);
    const wayIds = tracedWayIds(json.edges, shape, coords);
    return { ...classifyEdges(json.edges, shape), ...(wayIds ? { wayIds } : {}) };
  } catch {
    return null;
  }
}

/**
 * Sceglie tra percorsi alternativi quello più verificabile.
 * Scarta i percorsi su strade principali senza marciapiede e, per la sedia a rotelle, quelli con scale.
 * Se la verifica non è disponibile restituisce il primo percorso marcato come non verificato.
 */
export async function chooseSafest(candidates: RouteResult[], wheelchair: boolean): Promise<RouteResult> {
  const assessed = await Promise.all(candidates.map(async (route) => ({ route, safety: await assessRoute(route.coords, wheelchair) })));
  const checked = assessed.filter((a): a is { route: RouteResult; safety: RouteSafety } => a.safety !== null);
  if (!checked.length) {
    return {
      ...candidates[0],
      safety: { checked: false, pedestrianM: 0, sidewalkM: 0, carriagewayM: 0, segments: [], verifiable: false, alternatives: candidates.length },
    };
  }
  const rejected = (s: RouteSafety) => s.segments.some((x) => x.kind === 'main_road' || (wheelchair && x.kind === 'steps'));
  const ok = checked.filter((a) => !rejected(a.safety));
  if (!ok.length) {
    throw new HttpError(422, `${m().notVerifiable} ${m().allRejected(wheelchair)}`);
  }
  const minDist = Math.min(...ok.map((a) => a.route.distanceM));
  const score = (a: (typeof ok)[number]) => a.safety.carriagewayM + (a.route.distanceM - minDist) / DETOUR_PER_CARRIAGEWAY_M;
  const best = ok.reduce((x, y) => (score(y) < score(x) ? y : x));
  const first = checked[0];
  // Spiegazione in parole semplici, solo quando la scelta cambia qualcosa per chi si sposta.
  let choice: string | undefined;
  if (best !== first) {
    const extra = best.route.distanceM - first.route.distanceM;
    choice = rejected(first.safety)
      ? m().choiceRejected(extra, first.safety.segments.some((s) => s.kind === 'main_road'))
      : m().choiceAvoids(extra, first.safety.carriagewayM - best.safety.carriagewayM);
  }
  return { ...best.route, safety: { ...best.safety, alternatives: checked.length, ...(choice ? { choice } : {}) } };
}
