import { describe, expect, it } from 'vitest';
import type { OsmFeature } from '../shared/types.ts';
import type { RouteAnalysis } from '../src/lib/analysis.ts';
import { compareRoutes } from '../src/lib/compare.ts';

const f = (id: string): OsmFeature => ({ id, source: 'osm', kind: 'steps', certainty: 'known_obstacle', scope: 'path', label: 'Scale', geometry: { type: 'point', coords: [43.7, 10.4] }, tags: {} });
const a = (known: OsmFeature[], possible: OsmFeature[] = [], nearby: OsmFeature[] = []): RouteAnalysis => ({ known, nearby, possible, positive: [], unknown: [], reports: [], coverage: 0.5, alongM: {} });

describe('compareRoutes', () => {
  it('non dichiara evitato un ostacolo che il percorso per sedia a rotelle ha accanto', () => {
    // La scala è sul percorso a piedi (deciso dalla geometria) e accanto a quello per sedia a rotelle (deciso dagli id delle way).
    const c = compareRoutes({ distanceM: 300, analysis: a([], [], [f('scala-metro')]) }, { distanceM: 290, analysis: a([f('scala-metro'), f('scala-lontana')]) });
    expect(c.avoidedKnown.map((x) => x.id)).toEqual(['scala-lontana']);
  });

  it('trova gli ostacoli evitati e il costo in distanza', () => {
    const c = compareRoutes({ distanceM: 289, analysis: a([]) }, { distanceM: 137, analysis: a([f('steps1')], [f('sett')]) });
    expect(c.avoidedKnown.map((x) => x.id)).toEqual(['steps1']);
    expect(c.avoidedPossible.map((x) => x.id)).toEqual(['sett']);
    expect(c.extraM).toBe(152);
    expect(c.same).toBe(false);
  });

  it('riconosce percorsi equivalenti', () => {
    expect(compareRoutes({ distanceM: 1224, analysis: a([f('x')]) }, { distanceM: 1220, analysis: a([f('x')]) }).same).toBe(true);
  });

  it('percorsi diversi senza ostacoli evitati non sono uguali', () => {
    const c = compareRoutes({ distanceM: 900, analysis: a([]) }, { distanceM: 700, analysis: a([]) });
    expect(c.same).toBe(false);
    expect(c.avoidedKnown).toEqual([]);
  });

  it('segnala gli ostacoli noti presenti solo sul percorso per sedia a rotelle', () => {
    const kerb = { ...f('kerb'), kind: 'kerb' as const, label: 'Cordolo rialzato' };
    const c = compareRoutes({ distanceM: 290, analysis: a([kerb]) }, { distanceM: 140, analysis: a([f('steps')]) });
    expect(c.addedKnown.map((x) => x.id)).toEqual(['kerb']);
    expect(c.avoidedKnown.map((x) => x.id)).toEqual(['steps']);
  });
});
