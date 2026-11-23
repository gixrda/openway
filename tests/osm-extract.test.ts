import { describe, expect, it, vi } from 'vitest';
import { failureReason, PermanentError, withRetries } from '../scripts/osm-extract.ts';

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
