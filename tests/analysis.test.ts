import { describe, expect, it } from 'vitest';
import type { LatLngTuple, OsmFeature, Report } from '../shared/types.ts';
import { analyzeRoute, formatDistance, formatDuration, routeObstacles } from '../src/lib/analysis.ts';

// Percorso rettilineo est-ovest di ~400 m a Pisa. 1e-5 gradi di latitudine ≈ 1,1 m.
const LAT = 43.716;
const route: LatLngTuple[] = [[LAT, 10.400], [LAT, 10.405]];

function point(id: string, lat: number, lng: number, certainty: OsmFeature['certainty'], scope: OsmFeature['scope'] = 'path'): OsmFeature {
  return { id, source: 'osm', kind: 'kerb', certainty, scope, label: id, geometry: { type: 'point', coords: [lat, lng] }, tags: {} };
}
function line(id: string, coords: LatLngTuple[], certainty: OsmFeature['certainty']): OsmFeature {
  return { id, source: 'osm', kind: 'surface', certainty, scope: 'path', label: id, geometry: { type: 'line', coords }, tags: {} };
}
function report(id: string, lat: number, lng: number, status: Report['status'] = 'unverified'): Report {
  return {
    id, lat, lng, description: 'gradino alto', category: 'steps', categorySource: 'interpretation', createdAt: '', status, source: 'user_report',
    interpretation: { category: 'steps', obstacle: null, summary: '', severity: 'unknown', missing_info: [], question: null, photo_note: null, blocking: null, engine: 'fallback' },
    hasPhoto: false, blocking: null, blockingSource: 'interpretation', snap: null, impact: 'caution',
  };
}

describe('analyzeRoute', () => {
  it('rileva i nodi sul percorso e ignora quelli lontani', () => {
    const a = analyzeRoute(route, [
      point('on', LAT + 0.000005, 10.402, 'known_obstacle'), // ~0,5 m: il percorso passa sui nodi delle vie che usa
      point('far', LAT + 0.0003, 10.402, 'known_obstacle'),
      point('fav', LAT, 10.403, 'positive_info'),
      point('crossing', LAT, 10.404, 'info'),
    ], []);
    expect(a.known.map((f) => f.id)).toEqual(['on']);
    expect(a.nearby).toEqual([]);
    expect(a.positive.map((f) => f.id)).toEqual(['fav']);
    expect(a.unknown.map((f) => f.id)).toEqual(['crossing']);
  });

  it('un ostacolo noto a pochi metri dal tracciato non è sul percorso, ma resta tra quelli accanto', () => {
    const a = analyzeRoute(route, [
      point('accanto', LAT + 0.00003, 10.402, 'known_obstacle'), // ~3,3 m: sul marciapiede di fianco
      point('lontano', LAT + 0.00006, 10.402, 'known_obstacle'), // ~6,6 m: oltre la soglia
      point('scivolo-accanto', LAT + 0.00003, 10.403, 'positive_info'),
      point('attraversamento-accanto', LAT + 0.00003, 10.404, 'info'),
    ], []);
    expect(a.known).toEqual([]);
    expect(a.nearby.map((f) => f.id)).toEqual(['accanto']);
    // Le altre informazioni vicine riguardano un'altra via: non si elencano come se fossero sul percorso.
    expect(a.positive).toEqual([]);
    expect(a.unknown).toEqual([]);
    expect(a.alongM.accanto).toBeGreaterThan(155);
    expect(a.alongM.accanto).toBeLessThan(165);
  });

  it('senza id delle way: una scala è sul percorso solo se coincide con il tracciato', () => {
    const steps = (id: string, coords: LatLngTuple[]) => ({ ...line(id, coords, 'known_obstacle'), kind: 'steps' as const });
    const a = analyzeRoute(route, [
      steps('percorsa', [[LAT, 10.4020], [LAT, 10.4021]]), // 8 m sulla linea del percorso
      steps('parallela', [[LAT + 0.00002, 10.4030], [LAT + 0.00002, 10.4031]]), // 8 m, a ~2,2 m di fianco
      steps('laterale', [[LAT, 10.4040], [LAT + 0.00005, 10.4040]]), // 5,5 m, parte dal bordo del percorso e scende di lato
      steps('incrocio', [[LAT - 0.0003, 10.4045], [LAT + 0.0003, 10.4045]]), // 66 m, attraversa soltanto
    ], []);
    expect(a.known.map((f) => f.id)).toEqual(['percorsa']);
    expect(a.nearby.map((f) => f.id)).toEqual(['parallela', 'laterale']);
  });

  it('con gli id delle way percorse decide l\'id, non la vicinanza', () => {
    // Due scale disegnate sulla stessa linea del percorso (es. la scala della metropolitana sotto la piazza):
    // la geometria non le distingue, l'elenco delle way percorse sì.
    const features = [
      { ...line('way/10', [[LAT, 10.4020], [LAT, 10.4021]], 'known_obstacle'), kind: 'steps' as const },
      { ...line('way/11', [[LAT, 10.4030], [LAT, 10.4031]], 'known_obstacle'), kind: 'steps' as const },
      line('way/12', [[LAT + 0.00002, 10.401], [LAT + 0.00002, 10.404]], 'possible_issue'), // carreggiata parallela
      line('way/13', [[LAT, 10.4005], [LAT, 10.4045]], 'possible_issue'),
    ];
    const a = analyzeRoute(route, features, [], [10, 13, 99]);
    expect(a.known.map((f) => f.id)).toEqual(['way/10']);
    expect(a.nearby.map((f) => f.id)).toEqual(['way/11']);
    expect(a.possible.map((f) => f.id)).toEqual(['way/13']);
    // Senza id (percorso a piedi di confronto, servizio di verifica non disponibile) decide la geometria.
    const b = analyzeRoute(route, features, []);
    expect(b.known.map((f) => f.id)).toEqual(['way/10', 'way/11']);
    expect(b.possible.map((f) => f.id)).toEqual(['way/13']);
  });

  it('una way percorsa per pochi metri è sul percorso se lo dice il suo id', () => {
    // Il percorso usa solo i primi 12 m di una via lunga: la sola geometria (meno di 15 m in comune) non basta
    // per dirla percorsa, e l'ostacolo resta tra quelli accanto, da controllare sul posto.
    const lunga = line('way/20', [[LAT, 10.40485], [LAT, 10.405], [LAT + 0.001, 10.405]], 'known_obstacle');
    expect(analyzeRoute(route, [lunga], [], [20]).known.map((f) => f.id)).toEqual(['way/20']);
    const senzaId = analyzeRoute(route, [lunga], []);
    expect(senzaId.known).toEqual([]);
    expect(senzaId.nearby.map((f) => f.id)).toEqual(['way/20']);
  });

  it('la copertura conta solo le vie percorse, non quelle di fianco', () => {
    const parallela = line('way/30', [[LAT + 0.00002, 10.400], [LAT + 0.00002, 10.405]], 'info');
    expect(analyzeRoute(route, [parallela], []).coverage).toBe(0);
    expect(analyzeRoute(route, [parallela], [], [1]).coverage).toBe(0);
    const percorsa = line('way/31', [[LAT, 10.400], [LAT, 10.405]], 'info');
    expect(analyzeRoute(route, [percorsa], [], [31]).coverage).toBe(1);
  });

  it("non conta l'accessibilità dei luoghi come ostacolo sul percorso", () => {
    expect(analyzeRoute(route, [point('shop', LAT, 10.402, 'known_obstacle', 'place')], []).known).toEqual([]);
  });

  it('conta una via percorsa ma non una che si limita a incrociare il percorso', () => {
    const along = line('along', [[LAT, 10.401], [LAT, 10.403]], 'possible_issue');
    const across = line('across', [[LAT - 0.001, 10.402], [LAT + 0.001, 10.402]], 'possible_issue');
    const a = analyzeRoute(route, [along, across], []);
    expect(a.possible.map((f) => f.id)).toEqual(['along']);
    expect(a.coverage).toBeGreaterThan(0.35);
    expect(a.coverage).toBeLessThan(0.5);
  });

  it('senza dati la copertura è zero e non ci sono ostacoli: nessuna conclusione positiva', () => {
    const a = analyzeRoute(route, [], []);
    expect(a.coverage).toBe(0);
    expect(a.known).toEqual([]);
  });

  it('include le segnalazioni vicine non risolte', () => {
    const a = analyzeRoute(route, [], [report('near', LAT + 0.0001, 10.402), report('done', LAT, 10.403, 'resolved'), report('far', LAT + 0.001, 10.402)]);
    expect(a.reports.map((r) => r.id)).toEqual(['near']);
  });

  it('ordina ostacoli e segnalazioni per distanza dalla partenza', () => {
    const a = analyzeRoute(route, [
      point('lontano', LAT, 10.404, 'known_obstacle'),
      point('vicino', LAT, 10.4005, 'known_obstacle'),
      line('scale', [[LAT, 10.402], [LAT, 10.4025]], 'known_obstacle'),
    ], [report('segnalazione', LAT + 0.00005, 10.403)]);
    const order = routeObstacles(a);
    expect(order.map((o) => o.type === 'feature' ? o.feature.id : o.report.id)).toEqual(['vicino', 'scale', 'segnalazione', 'lontano']);
    // 0,0005° di longitudine a questa latitudine ≈ 40 m
    expect(order[0].alongM).toBeGreaterThan(35);
    expect(order[0].alongM).toBeLessThan(45);
  });

  it('gestisce un percorso degenere', () => {
    expect(analyzeRoute([[LAT, 10.4]], [point('x', LAT, 10.4, 'known_obstacle')], []).known).toEqual([]);
  });
});

describe('formattazione', () => {
  it('formatta distanze e durate in italiano', () => {
    expect(formatDistance(234)).toBe('230 m');
    expect(formatDistance(1234)).toBe('1,2 km');
    expect(formatDuration(30)).toBe('1 min');
    expect(formatDuration(4000)).toBe('1 h 7 min');
  });
});
