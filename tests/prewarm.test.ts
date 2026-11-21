import { describe, expect, it, vi } from 'vitest';
import { PREWARM_EVERY_MS, prewarmDemo } from '../src/landing/prewarm.ts';

const DEMO = 'https://demo.example/';

function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}
const ok = () => vi.fn(async () => new Response(''));

describe('risveglio anticipato della demo', () => {
  it('manda una sola richiesta leggera, senza cookie e senza referrer', () => {
    const send = ok();
    expect(prewarmDemo(DEMO, { fetch: send })).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('https://demo.example/api/status',
      { mode: 'no-cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  });

  it('non fa nulla se la demo non esiste o se chi visita risparmia dati', () => {
    const send = ok();
    expect(prewarmDemo('', { fetch: send })).toBe(false);
    expect(prewarmDemo(DEMO, { fetch: send, saveData: true })).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('non ripete la richiesta finché la demo è ancora sveglia', () => {
    const send = ok();
    const storage = memory();
    expect(prewarmDemo(DEMO, { fetch: send, storage, now: 1_000_000 })).toBe(true);
    expect(prewarmDemo(DEMO, { fetch: send, storage, now: 1_000_000 + PREWARM_EVERY_MS - 1 })).toBe(false);
    expect(prewarmDemo(DEMO, { fetch: send, storage, now: 1_000_000 + PREWARM_EVERY_MS })).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('una demo irraggiungibile o uno storage bloccato non producono errori', async () => {
    const send = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(prewarmDemo(DEMO, { fetch: send, storage: blocked })).toBe(true);
    await Promise.resolve(); // il rifiuto della richiesta viene assorbito
    expect(send).toHaveBeenCalledTimes(1);
  });
});
