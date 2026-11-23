import { describe, expect, it, vi } from 'vitest';
import { EXTRACT_SOURCES, failureReason, firstWorking, PermanentError, stateTimestamp, withRetries } from '../scripts/osm-extract.ts';

// Errore come lo produce fetch quando il server rifiuta la connessione: il codice utile è dentro `cause`.
const refused = () => Object.assign(new TypeError('fetch failed'), {
  cause: { code: 'ECONNREFUSED', errors: [{ code: 'ECONNREFUSED' }, { code: 'ENETUNREACH' }] },
});

describe('download con nuovi tentativi', () => {
  it('riprova dopo un rifiuto di connessione e poi riesce', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const log = vi.fn((_message: string) => {});
    const run = vi.fn(async (attempt: number) => { if (attempt < 3) throw refused(); return 'ok'; });
    await expect(withRetries(run, { delaysMs: [10, 20, 30], sleep, log })).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([10, 20]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0][0]).toMatch(/Tentativo 1 non riuscito \(fetch failed · ECONNREFUSED · ENETUNREACH\)/);
  });

  it('esauriti i tentativi rilancia l\'ultimo errore', async () => {
    const sleep = vi.fn(async () => {});
    const run = vi.fn(async () => { throw refused(); });
    await expect(withRetries(run, { delaysMs: [1, 2], sleep, log: () => {} })).rejects.toThrow('fetch failed');
    expect(run).toHaveBeenCalledTimes(3); // il primo tentativo più due nuovi
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('non riprova quando l\'errore è definitivo', async () => {
    const sleep = vi.fn(async () => {});
    const run = vi.fn(async () => { throw new PermanentError('Geofabrik: HTTP 404.'); });
    await expect(withRetries(run, { delaysMs: [1, 2], sleep, log: () => {} })).rejects.toThrow('HTTP 404');
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('descrive un errore anche senza dettagli di rete', () => {
    expect(failureReason(new Error('Geofabrik: HTTP 503.'))).toBe('Geofabrik: HTTP 503.');
    expect(failureReason('boh')).toBe('boh');
  });
});

describe('sorgenti dell\'estratto', () => {
  const quiet = { delaysMs: [1], sleep: async () => {}, log: () => {} };
  const A = { name: 'A' }, B = { name: 'B' };

  it('ha Geofabrik per prima e una seconda sorgente di riserva', () => {
    expect(EXTRACT_SOURCES.map((s) => s.name)).toEqual(['Geofabrik', 'OpenStreetMap France']);
    for (const s of EXTRACT_SOURCES) expect(s.url).toMatch(/^https:\/\/.+italy-latest\.osm\.pbf$/);
  });

  it('usa la prima sorgente quando risponde', async () => {
    const run = vi.fn(async (s: { name: string }) => `dati di ${s.name}`);
    await expect(firstWorking([A, B], run, quiet)).resolves.toEqual({ source: A, result: 'dati di A' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('passa alla seconda dopo aver esaurito i tentativi sulla prima, e lo scrive nel log', async () => {
    const log = vi.fn((_message: string) => {});
    const run = vi.fn(async (s: { name: string }) => { if (s === A) throw refused(); return 'dati di B'; });
    await expect(firstWorking([A, B], run, { ...quiet, log })).resolves.toEqual({ source: B, result: 'dati di B' });
    expect(run.mock.calls.map((c) => c[0].name)).toEqual(['A', 'A', 'B']); // un tentativo, un nuovo tentativo, poi la riserva
    expect(log.mock.calls.at(-1)?.[0]).toBe('A non disponibile (fetch failed · ECONNREFUSED · ENETUNREACH): passo a B.');
  });

  it('se nessuna sorgente risponde rilancia l\'errore dell\'ultima', async () => {
    const run = vi.fn(async (s: { name: string }) => { throw new Error(`${s.name} giù`); });
    await expect(firstWorking([A, B], run, quiet)).rejects.toThrow('B giù');
  });

  it('legge la data dei dati dal file di stato della replica', () => {
    expect(stateTimestamp('sequenceNumber=7384478\ntimestamp=2026-11-23T02\\:19\\:24Z\n')).toBe('2026-11-23T02:19:24Z');
    expect(stateTimestamp('sequenceNumber=1\n')).toBeUndefined();
    expect(stateTimestamp('timestamp=boh')).toBeUndefined();
  });
});
