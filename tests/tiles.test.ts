import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { elementFromGeojson, matchesQuery, normalizeOverpass } from '../server/osm.ts';
import { buildTiles, countsAsData, ensureTiles } from '../server/tiles.ts';
import { inArea, straightDistanceM } from '../shared/area.ts';
import { isTrail } from '../shared/osmClassify.ts';
import { cellKey, cellsAlongLine, cellsInBounds, dataLevel } from '../shared/tiles.ts';
import type { OsmFeature, RouteResult } from '../shared/types.ts';
import { analyzeRoute } from '../src/lib/analysis.ts';
import { verdictOf } from '../src/lib/verdict.ts';

const PISA: [number, number] = [43.7175, 10.4005];

describe('griglia delle celle', () => {
  it('usa le tile standard di livello 14', () => {
    expect(cellKey(...PISA)).toBe('8665/5975');
    expect(cellKey(43.7696, 11.2558)).toBe('8704/5972'); // Firenze
  });

  it('elenca le celle di un riquadro', () => {
    expect(cellsInBounds([43.715, 10.398, 43.72, 10.403])).toEqual(['8665/5975']);
    expect(cellsInBounds([43.70, 10.38, 43.73, 10.42])).toHaveLength(9);
  });

  it('un percorso prende solo le celle che attraversa, senza saltarne', () => {
    // Pisa → Lucca in linea retta (~16 km): due punti soli, le celle in mezzo vanno comunque trovate.
    const keys = cellsAlongLine([PISA, [43.8429, 10.5027]]);
    const box = cellsInBounds([43.7175, 10.4005, 43.8429, 10.5027]);
    expect(keys.length).toBeGreaterThan(8);
    expect(keys.length).toBeLessThan(box.length / 2);
    // Ogni cella è adiacente (anche in diagonale) ad almeno un'altra: nessun buco lungo la linea.
    const xy = keys.map((k) => k.split('/').map(Number));
    for (const [x, y] of xy) expect(xy.some(([a, b]) => (a !== x || b !== y) && Math.abs(a - x) <= 1 && Math.abs(b - y) <= 1)).toBe(true);
  });

  it('classifica la quantità di dati di una cella', () => {
    expect([undefined, 0, 1, 49, 50].map(dataLevel)).toEqual(['none', 'none', 'few', 'few', 'some']);
  });
});

describe('costruzione delle celle', () => {
  const features = normalizeOverpass([
    { type: 'node', id: 1, lat: 43.71750049, lon: 10.40050051, tags: { barrier: 'kerb', kerb: 'raised' } },
    { type: 'node', id: 2, lat: 43.7176, lon: 10.4006, tags: { highway: 'crossing' } },
    { type: 'way', id: 3, geometry: [{ lat: 43.7175, lon: 10.4005 }, { lat: 43.7175, lon: 10.43 }], tags: { highway: 'footway', surface: 'sett', name: 'Via di prova' } },
    { type: 'way', id: 4, geometry: [{ lat: 43.7175, lon: 10.4005 }, { lat: 43.718, lon: 10.401 }], tags: { highway: 'path', surface: 'ground', sac_scale: 'hiking' } },
    { type: 'node', id: 5, lat: 43.7177, lon: 10.4007, tags: { shop: 'bakery', wheelchair: 'yes' } },
  ]);
  const { index, tiles } = buildTiles(features, { source: 'test', fetchedAt: '2026-11-16T21:22:36Z', scope: 'full' });

  it('toglie etichetta, fonte e nome e arrotonda le coordinate', () => {
    const kerb = tiles.get('8665/5975')!.find((f) => f.id === 'node/1')!;
    expect(kerb).toEqual({
      id: 'node/1', kind: 'kerb', certainty: 'known_obstacle', scope: 'path',
      geometry: { type: 'point', coords: [43.7175, 10.400501] }, tags: { barrier: 'kerb', kerb: 'raised' },
    });
    const way = tiles.get('8665/5975')!.find((f) => f.id === 'way/3')!;
    expect(way).not.toHaveProperty('label');
    expect(way).not.toHaveProperty('name');
    expect(way.tags.name).toBe('Via di prova');
  });

  it('salva una linea intera in ogni cella che attraversa', () => {
    const withWay = [...tiles].filter(([, list]) => list.some((f) => f.id === 'way/3')).map(([k]) => k).sort();
    expect(withWay).toEqual(['8665/5975', '8666/5975']);
    expect(tiles.get('8666/5975')![0].geometry).toEqual({ type: 'line', coords: [[43.7175, 10.4005], [43.7175, 10.43]] });
  });

  it("conta come dati solo gli elementi utili del percorso: non i luoghi, i sentieri e gli attraversamenti senza informazioni", () => {
    expect(features.map(countsAsData)).toEqual([true, false, true, false, false]);
    expect(index).toMatchObject({ scope: 'full', zoom: 14, cells: { '8665/5975': 2, '8666/5975': 1 } });
  });

  it('senza dati regionali crea la griglia dallo snapshot demo, una volta sola', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'openway-tiles-'));
    await writeFile(join(dir, 'seed.json'), JSON.stringify({ source: 'seed', fetchedAt: '2026-10-24', bbox: [0, 0, 0, 0], features }));
    const first = await ensureTiles(join(dir, 'osm'), join(dir, 'seed.json'));
    expect(first).toMatchObject({ source: 'seed', scope: 'demo' });
    expect(JSON.parse(await readFile(join(dir, 'osm', '14', '8666', '5975.json'), 'utf8')).features).toHaveLength(1);
    // Alla seconda chiamata si legge l'indice esistente: lo snapshot non serve più.
    expect(await ensureTiles(join(dir, 'osm'), join(dir, 'missing.json'))).toEqual(first);
  });
});

describe('sentieri', () => {
  it.each([
    [{ highway: 'path' }, true],
    [{ highway: 'path', surface: 'ground' }, true],
    [{ highway: 'path', sac_scale: 'hiking', bicycle: 'designated' }, true],
    [{ highway: 'path', surface: 'asphalt' }, false],
    [{ highway: 'path', foot: 'designated', bicycle: 'designated' }, false],
    [{ highway: 'path', lit: 'yes' }, false],
    [{ highway: 'path', sac_scale: 'hiking', wheelchair: 'no' }, false], // un dato esplicito sull'accessibilità non si nasconde mai
    [{ highway: 'footway', surface: 'ground' }, false],
    [{ highway: 'steps', sac_scale: 'hiking' }, false],
  ])('%o → %s', (tags, trail) => {
    expect(isTrail(tags as Record<string, string>)).toBe(trail);
  });

  it('restano nei dati con il segno "trail", per avvisare chi ci passa', () => {
    const [f] = normalizeOverpass([{ type: 'way', id: 9, geometry: [{ lat: 43.9, lon: 10.5 }, { lat: 43.901, lon: 10.5 }], tags: { highway: 'path', surface: 'ground' } }]);
    expect(f).toMatchObject({ trail: true, certainty: 'possible_issue', kind: 'surface' });
    const a = analyzeRoute([[43.9, 10.5], [43.901, 10.5]], [f], []);
    expect(a.possible.map((x) => x.id)).toEqual(['way/9']);
  });
});

describe('estratto filtrato in locale', () => {
  it('legge nodi, way e aree di osmium export', () => {
    expect(elementFromGeojson({ id: 'n7', geometry: { type: 'Point', coordinates: [10.4, 43.7] }, properties: { highway: 'crossing' } }))
      .toEqual({ type: 'node', id: 7, lat: 43.7, lon: 10.4, tags: { highway: 'crossing' } });
    expect(elementFromGeojson({ id: 'w8', geometry: { type: 'LineString', coordinates: [[10.4, 43.7], [10.41, 43.71]] }, properties: { highway: 'steps' } }))
      .toMatchObject({ type: 'way', id: 8, geometry: [{ lat: 43.7, lon: 10.4 }, { lat: 43.71, lon: 10.41 }] });
    // Area da way chiusa: id × 2, contorno esterno. Area da relazione (id dispari): ignorata.
    const ring = [[10.4, 43.7], [10.41, 43.7], [10.41, 43.71], [10.4, 43.7]];
    expect(elementFromGeojson({ id: 'a18', geometry: { type: 'MultiPolygon', coordinates: [[ring]] }, properties: { highway: 'pedestrian', area: 'yes' } }))
      .toMatchObject({ type: 'way', id: 9 });
    expect(elementFromGeojson({ id: 'a19', geometry: { type: 'MultiPolygon', coordinates: [[ring]] }, properties: { wheelchair: 'yes' } })).toBeNull();
  });

  it('applica gli stessi criteri della query Overpass', () => {
    const node = (tags: Record<string, string>) => matchesQuery({ type: 'node', id: 1, lat: 0, lon: 0, tags });
    const way = (tags: Record<string, string>) => matchesQuery({ type: 'way', id: 1, geometry: [], tags });
    expect([node({ kerb: 'lowered' }), node({ highway: 'crossing' }), node({ barrier: 'gate' }), node({ shop: 'bakery', wheelchair: 'no' })]).toEqual([true, true, true, true]);
    expect([node({ highway: 'traffic_signals' }), node({ surface: 'asphalt' })]).toEqual([false, false]); // nodi inclusi solo perché parte di una way
    expect([way({ highway: 'footway' }), way({ highway: 'residential', sidewalk: 'both' }), way({ building: 'yes', wheelchair: 'yes' })]).toEqual([true, true, true]);
    expect(way({ highway: 'residential' })).toBe(false);
  });
});

describe('area: Italia', () => {
  it.each([
    ['Pisa', 43.7175, 10.4005, true], ['Firenze', 43.7696, 11.2558, true], ['Roma', 41.9028, 12.4964, true],
    ['Milano', 45.4642, 9.19, true], ['Napoli', 40.8518, 14.2681, true], ['Palermo', 38.1157, 13.3615, true],
    ['Cagliari', 39.2238, 9.1217, true], ['Venezia', 45.4371, 12.3326, true], ['Aosta', 45.7372, 7.3206, true],
    ['Bolzano', 46.4983, 11.3548, true], ['Trieste', 45.6495, 13.7768, true], ['Lecce', 40.3515, 18.175, true],
    ['Portoferraio (Elba)', 42.8145, 10.3167, true], ['Lampedusa', 35.5022, 12.6094, true], ['Ventimiglia', 43.7912, 7.6076, true],
    ['Città del Vaticano (enclave nel Lazio)', 41.9022, 12.4539, true],
    ['San Marino (tra due regioni, non dentro una)', 43.9361, 12.4473, false], ['Nizza', 43.7102, 7.262, false], ['Lugano', 46.0037, 8.9511, false], ['Innsbruck', 47.2692, 11.4041, false],
    ['Lubiana', 46.0569, 14.5058, false], ['Bastia (Corsica)', 42.6973, 9.4509, false], ['Malta', 35.8989, 14.5146, false],
    ['Tirreno, mare aperto', 40.5, 11.5, false], ['Adriatico, mare aperto', 43.5, 14.5, false],
  ])('%s', (_name, lat, lng, inside) => {
    expect(inArea(lat, lng)).toBe(inside);
  });

  it('rifiuta valori che non sono coordinate', () => {
    expect([inArea('43.7', 10.4), inArea(NaN, 10.4), inArea(undefined, undefined)]).toEqual([false, false, false]);
  });

  it('misura la distanza in linea d\'aria', () => {
    const d = straightDistanceM({ lat: 43.7175, lng: 10.4005 }, { lat: 43.8429, lng: 10.5027 });
    expect(d).toBeGreaterThan(16_000);
    expect(d).toBeLessThan(16_400);
  });
});

describe('esito con pochi dati', () => {
  const route: RouteResult = {
    mode: 'wheelchair', provider: 'valhalla', coords: [], distanceM: 500, durationS: 400,
    safety: { checked: true, verifiable: true, pedestrianM: 500, sidewalkM: 0, carriagewayM: 0, segments: [], alternatives: 1 },
  };

  it('"nessun ostacolo noto" resta tranquillo solo dove ci sono dati', () => {
    expect(verdictOf(route, [], 0.8)).toMatchObject({ tone: 'calm', title: 'Nessun ostacolo noto' });
  });

  it('un ostacolo noto accanto al percorso toglie l\'esito tranquillo, senza diventare un punto di attenzione', () => {
    const v = verdictOf(route, [], 0.8, 2);
    expect(v).toMatchObject({ tone: 'warn', title: '2 ostacoli noti accanto al percorso' });
    expect(v.text).toMatch(/controlla sul posto/);
    expect(verdictOf(route, [], 0.04, 1).text).toMatch(/controlla sul posto.*solo per il 4% del percorso/);
    // Se il percorso non è verificabile resta quello l'avviso principale.
    const unverified = verdictOf({ ...route, safety: { ...route.safety!, verifiable: false } }, [], 0.8, 1);
    expect(unverified).toMatchObject({ tone: 'warn', title: '1 ostacolo noto accanto al percorso' });
    expect(unverified.text).toMatch(/sufficientemente verificabile/);
  });

  it('con pochi dati lungo il percorso lo dice, invece di rassicurare', () => {
    const v = verdictOf(route, [], 0.04);
    expect(v.tone).toBe('warn');
    expect(v.text).toMatch(/solo per il 4% del percorso/);
    expect(v.text).toMatch(/ostacoli non segnati/);
  });
});

describe('analisi su molti dati', () => {
  it('trova gli stessi elementi anche in mezzo a migliaia di elementi lontani', () => {
    const route: [number, number][] = [[43.716, 10.4], [43.716, 10.405]];
    const near: OsmFeature = { id: 'near', source: 'osm', kind: 'kerb', certainty: 'known_obstacle', scope: 'path', geometry: { type: 'point', coords: [43.716, 10.402] }, tags: {} };
    const far = Array.from({ length: 5000 }, (_, i): OsmFeature => ({
      id: `far-${i}`, source: 'osm', kind: 'surface', certainty: 'possible_issue', scope: 'path',
      geometry: { type: 'line', coords: [[43.72 + i * 1e-5, 10.4], [43.72 + i * 1e-5, 10.405]] }, tags: {},
    }));
    const a = analyzeRoute(route, [...far, near], []);
    expect(a.known.map((f) => f.id)).toEqual(['near']);
    expect(a.possible).toEqual([]);
  });
});
