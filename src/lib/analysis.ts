import { distToLine, distToSegment, projector, type XY } from '../../shared/geo.ts';
import { RULES } from '../../shared/rules.ts';
import { t } from '../i18n/index.ts';
import { nearM, obstaclePoint } from './reroute.ts';
import type { LatLngTuple, OsmFeature, Report } from '../../shared/types.ts';

export interface RouteAnalysis {
  /** Ostacoli noti sul tracciato: sono i punti di attenzione numerati */
  known: OsmFeature[];
  /**
   * Ostacoli noti a pochi metri dal tracciato, su una via che il percorso non usa (es. la scala della metropolitana
   * accanto al marciapiede): non si contano tra i punti di attenzione, ma restano in un elenco "da controllare sul posto".
   */
  nearby: OsmFeature[];
  possible: OsmFeature[];
  positive: OsmFeature[];
  /** Elementi sul percorso senza dati sufficienti (es. attraversamenti con cordolo non mappato) */
  unknown: OsmFeature[];
  reports: Report[];
  /** Quota (0..1) del percorso vicina a tratti OSM con dati su superficie, pendenza, larghezza o accessibilità */
  coverage: number;
  /** Distanza dalla partenza (m) di ogni elemento trovato, per id di feature o segnalazione */
  alongM: Record<string, number>;
}

/** Un ostacolo noto o una segnalazione sul percorso, nell'ordine in cui si incontra. */
export type RouteObstacle =
  | { type: 'feature'; feature: OsmFeature; alongM: number }
  | { type: 'report'; report: Report; alongM: number };


// Il percorso è calcolato sulle vie di OpenStreetMap, quindi la sua linea coincide con quella delle vie che usa e passa
// esattamente sui loro nodi: entro ON_M un elemento è "sul percorso". Le soglie più larghe (usate fino al 21/11/2026 per
// decidere tutto) restano per l'elenco "accanto al percorso": lì finisce ciò che è vicino ma su un'altra via.
const ON_M = 1; // scarto massimo tra il percorso e un elemento che gli sta sopra
const POINT_M = 5; // un nodo (cordolo, barriera…) oltre ON_M ma entro questa distanza è "accanto"
const LINE_M = 4; // una via mappata che resta entro questa distanza dal percorso senza esserne parte è "accanto"
const FINE_M = 1; // passo con cui si misura quanta parte di una via mappata coincide con il percorso
const REPORT_M = 15; // le posizioni scelte dagli utenti sono meno precise
const STEP_M = 5; // passo di campionamento del percorso
const GRID_M = 50; // lato delle caselle dell'indice dei campioni

function lineLength(line: XY[]): number {
  let len = 0;
  for (let i = 1; i < line.length; i++) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return len;
}

/** Campiona una linea ogni ~step metri; restituisce anche la distanza dall'inizio di ogni campione. */
function sample(line: XY[], step: number): { pts: XY[]; along: number[] } {
  const pts: XY[] = line.length ? [line[0]] : [];
  const along = line.length ? [0] : [];
  let done = 0;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let k = 1; k <= n; k++) {
      pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      along.push(done + (len * k) / n);
    }
    done += len;
  }
  return { pts, along };
}

/** Distanza dalla partenza del punto del percorso più vicino a p. */
function alongRoute(p: XY, line: XY[]): number {
  let best = Infinity, at = 0, done = 0;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    const d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    if (d < best) { best = d; at = done + t * Math.sqrt(len2); }
    done += Math.sqrt(len2);
  }
  return at;
}

/** Numero della way di un elemento ("way/123" → 123), null per i nodi. */
function wayNumber(id: string): number | null {
  const m = /^way\/(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

/**
 * Confronta un percorso con i dati OSM e le segnalazioni.
 *
 * Un nodo (cordolo, barriera, attraversamento) è sul percorso se la linea gli passa entro ON_M.
 * Una via mappata (scale, tratto con un certo fondo…) è sul percorso se:
 * - `wayIds` è disponibile (id delle way percorse, dalla verifica dei tratti del server) e contiene il suo id; oppure,
 * - senza `wayIds`, coincide con il percorso (entro ON_M) per almeno 15 m o metà della sua lunghezza, se più corta:
 *   così una via che si limita a incrociare il percorso, o che parte dal suo bordo, non viene contata.
 * Gli ostacoli noti vicini ma non sul percorso (nodi entro POINT_M; vie entro LINE_M per 15 m o metà lunghezza)
 * finiscono in `nearby`. Le altre informazioni vicine ma non sul percorso riguardano un'altra via e non si elencano.
 */
export function analyzeRoute(route: LatLngTuple[], features: OsmFeature[], reports: Report[], wayIds?: readonly number[]): RouteAnalysis {
  const empty: RouteAnalysis = { known: [], nearby: [], possible: [], positive: [], unknown: [], reports: [], coverage: 0, alongM: {} };
  if (route.length < 2) return empty;
  const xy = projector(route[0][0]);
  const routeXY = route.map(xy);
  const { pts: samples, along: sampleAlong } = sample(routeXY, STEP_M);
  const alongM: Record<string, number> = {};
  const covered = new Array<boolean>(samples.length).fill(false);

  // Indice dei campioni del percorso su una griglia di GRID_M metri: per ogni elemento si guardano solo i campioni
  // delle caselle vicine. Con i dati di una regione intera un confronto "tutti con tutti" sarebbe troppo lento.
  const grid = new Map<string, number[]>();
  const cell = (v: number) => Math.floor(v / GRID_M);
  samples.forEach((p, i) => {
    const key = `${cell(p[0])},${cell(p[1])}`;
    const list = grid.get(key);
    if (list) list.push(i); else grid.set(key, [i]);
  });
  /** Indici dei campioni nelle caselle che toccano il riquadro dei punti dati, allargato di pad metri (in ordine di percorrenza). */
  const candidates = (pts: XY[], pad: number): number[] => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const out: number[] = [];
    for (let cx = cell(minX - pad); cx <= cell(maxX + pad); cx++) {
      for (let cy = cell(minY - pad); cy <= cell(maxY + pad); cy++) {
        const list = grid.get(`${cx},${cy}`);
        if (list) for (const i of list) out.push(i);
      }
    }
    return out.sort((x, y) => x - y);
  };

  /**
   * Distanza di p dal percorso, guardando solo i tratti vicini (Infinity se nessuno è entro `max`).
   * I campioni comprendono tutti i vertici: i segmenti tra campioni consecutivi sono il percorso stesso.
   */
  const routeDist = (p: XY, max: number): number => {
    let best = Infinity;
    for (const i of candidates([p], max + STEP_M)) {
      if (i > 0) best = Math.min(best, distToSegment(p, samples[i - 1], samples[i]));
      if (i + 1 < samples.length) best = Math.min(best, distToSegment(p, samples[i], samples[i + 1]));
    }
    return best;
  };
  /** Metri di una via mappata che coincidono con il percorso (entro ON_M), misurati lungo la via ogni FINE_M. */
  const overlapM = (line: XY[]): number => {
    const { pts } = sample(line, FINE_M);
    return (pts.filter((p) => routeDist(p, ON_M) <= ON_M).length / pts.length) * lineLength(line);
  };
  const traversed = wayIds ? new Set(wayIds) : null;

  const result = { ...empty, known: [] as OsmFeature[], nearby: [] as OsmFeature[], possible: [] as OsmFeature[], positive: [] as OsmFeature[], unknown: [] as OsmFeature[] };
  for (const f of features) {
    if (f.scope !== 'path') continue; // l'accessibilità di un negozio non è un ostacolo sul percorso
    let onRoute: boolean;
    let along: number;
    if (f.geometry.type === 'point') {
      const p = xy(f.geometry.coords);
      // Un campione ogni STEP_M metri: se nessuno è entro POINT_M + STEP_M, il percorso non passa di lì.
      if (!candidates([p], POINT_M + STEP_M).length) continue;
      const d = distToLine(p, routeXY);
      if (d > POINT_M) continue;
      onRoute = d <= ON_M;
      along = alongRoute(p, routeXY);
    } else {
      const line = f.geometry.coords.map(xy);
      const near = candidates(line, LINE_M).filter((i) => distToLine(samples[i], line) <= LINE_M);
      const way = traversed ? wayNumber(f.id) : null;
      if (way !== null && traversed!.has(way)) {
        onRoute = true;
      } else {
        if (!near.length) continue;
        const minM = Math.min(15, lineLength(line) / 2);
        // Con gli id delle way la risposta è già "no"; senza, decide la coincidenza con la linea del percorso.
        const overlap = way === null ? overlapM(line) : 0;
        onRoute = overlap > 0 && overlap >= minM;
        // Accanto: un incrocio perpendicolare copre al massimo ~2 campioni (10 m), serve una vicinanza più lunga.
        if (!onRoute && near.length * STEP_M < minM) continue;
      }
      along = near.length ? sampleAlong[near[0]] : alongRoute(line[0], routeXY);
      // Copertura dei dati: contano solo i tratti del percorso che stanno sopra la via, non quelli che le passano accanto.
      if (onRoute) for (const i of near) if (distToLine(samples[i], line) <= ON_M) covered[i] = true;
    }
    if (!onRoute) {
      // Vicino ma su un'altra via: un ostacolo noto resta da controllare sul posto, il resto non riguarda questo percorso.
      if (f.certainty === 'known_obstacle') { result.nearby.push(f); alongM[f.id] = along; }
      continue;
    }
    if (f.certainty !== 'info' || f.geometry.type === 'point') alongM[f.id] = along;
    if (f.certainty === 'known_obstacle') result.known.push(f);
    else if (f.certainty === 'possible_issue') result.possible.push(f);
    else if (f.certainty === 'positive_info') result.positive.push(f);
    else if (f.geometry.type === 'point') result.unknown.push(f);
  }
  // Con il punto agganciato alla rete basta una soglia stretta; senza, si tollera l'imprecisione del tocco sulla mappa.
  const reportXY = (r: Report) => xy(obstaclePoint(r));
  result.reports = reports.filter((r) => r.status !== 'resolved'
    && distToLine(reportXY(r), routeXY) <= nearM(r));
  for (const r of result.reports) alongM[r.id] = alongRoute(reportXY(r), routeXY);
  result.coverage = covered.filter(Boolean).length / samples.length;
  result.nearby.sort((a, b) => alongM[a.id] - alongM[b.id]);
  return { ...result, alongM };
}

/** Distanza dalla partenza del punto del percorso più vicino a p. */
export function distanceAlong(route: LatLngTuple[], p: LatLngTuple): number {
  if (route.length < 2) return 0;
  const xy = projector(route[0][0]);
  return alongRoute(xy(p), route.map(xy));
}

/** Ostacoli noti e segnalazioni sul percorso, in ordine di percorrenza. */
export function routeObstacles(a: RouteAnalysis): RouteObstacle[] {
  return [
    ...a.known.map((feature): RouteObstacle => ({ type: 'feature', feature, alongM: a.alongM[feature.id] ?? 0 })),
    ...a.reports.map((report): RouteObstacle => ({ type: 'report', report, alongM: a.alongM[report.id] ?? 0 })),
  ].sort((x, y) => x.alongM - y.alongM);
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', t().decimal)} km`;
}

export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}
