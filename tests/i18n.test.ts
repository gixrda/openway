import { readFile, mkdtemp } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPrompt, fallbackInterpret } from '../server/ai.ts';
import { createApi } from '../server/api.ts';
import { MESSAGES, m, withLang } from '../server/messages.ts';
import { langFromHeader } from '../shared/lang.ts';
import { classifyPath, featureLabel } from '../shared/osmClassify.ts';
import type { OsmDataset } from '../shared/types.ts';
import { en } from '../src/i18n/en.ts';
import { it as itStrings } from '../src/i18n/it.ts';
import { en as enCopy } from '../src/landing/copy.en.ts';
import { it as itCopy } from '../src/landing/copy.it.ts';
import { spokenPlaceQuery } from '../src/lib/speech.ts';

/** Tutte le stringhe di un dizionario, con il percorso della chiave (le funzioni si saltano: le controlla il compilatore). */
function leaves(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
}

// Testi che è giusto siano uguali nelle due lingue: nomi propri, sigle, indirizzi, parole internazionali.
const SAME_ON_PURPOSE = /^(OpenWay|Freedom to move.*|Menu|Privacy|AccessGo|Valhalla.*|Nominatim|Gemma 4|ElevenLabs|OpenStreetMap|No|#.*|https?:.*|[a-z-]+|\d+.*|Via .*|Lungarno .*|Piazza .*|Hacktoberfest.*)$/;

describe('dizionari it/en', () => {
  for (const [name, a, b] of [['app', itStrings, en], ['landing', itCopy, enCopy], ['server', MESSAGES.it, MESSAGES.en]] as const) {
    it(`${name}: stesse chiavi e nessun testo vuoto`, () => {
      const [x, y] = [leaves(a), leaves(b)];
      expect(y.map(([k]) => k)).toEqual(x.map(([k]) => k));
      for (const [k, v] of [...x, ...y]) expect(v.trim(), k).not.toBe('');
    });

    it(`${name}: nessun testo rimasto in italiano nella versione inglese`, () => {
      const italian = new Map(leaves(a));
      const untranslated = leaves(b).filter(([k, v]) => italian.get(k) === v && !SAME_ON_PURPOSE.test(v) && !k.startsWith('language.'));
      expect(untranslated).toEqual([]);
    });
  }

  it('la versione inglese non chiama mai un percorso "accessible" o "safe"', () => {
    // Regola del progetto: si dice solo ciò che i dati permettono di verificare.
    // Sono ammessi i casi in cui la parola è negata o riferita a un tag ("marked accessible", «never calls a route "accessible"»).
    const risky = [...leaves(en), ...leaves(enCopy), ...leaves(MESSAGES.en)]
      .filter(([, v]) => /\b(accessible|safe)\b/i.test(v))
      .filter(([, v]) => !/marked (not |only partly )?(wheelchair )?accessible|never calls a route/i.test(v));
    expect(risky).toEqual([]);
  });
});

describe('etichette OpenStreetMap', () => {
  it('in italiano coincidono con quelle salvate nello snapshot, in inglese sono tutte tradotte', async () => {
    const data = JSON.parse(await readFile(new URL('../server/data/osm-pisa.json', import.meta.url), 'utf8')) as OsmDataset;
    expect(data.features.length).toBeGreaterThan(1000);
    for (const f of data.features) {
      expect(featureLabel(f, 'it'), f.id).toBe(f.label);
      expect(featureLabel(f, 'en'), f.id).not.toBe(f.label);
    }
  });

  it('traduce anche le parti variabili', () => {
    expect(classifyPath({ highway: 'steps', step_count: '12' }, 'en')?.label).toBe('Steps (12 steps)');
    expect(classifyPath({ highway: 'footway', width: '0.8' }, 'en')?.label).toBe('Very narrow passage (80 cm)');
    expect(classifyPath({ kerb: 'raised' }, 'en')).toEqual({ kind: 'kerb', certainty: 'known_obstacle', label: 'Raised kerb, no ramp' });
  });
});

describe('lingua della richiesta', () => {
  it('riconosce solo la prima preferenza di Accept-Language', () => {
    expect(langFromHeader('en')).toBe('en');
    expect(langFromHeader('en-GB,en;q=0.9,it;q=0.8')).toBe('en');
    expect(langFromHeader('it-IT,it;q=0.9,en;q=0.8')).toBe('it');
    expect(langFromHeader('*')).toBe('it');
    expect(langFromHeader(undefined)).toBe('it');
  });

  it('i messaggi seguono la lingua anche dopo un await', async () => {
    expect(m().descShort).toBe(MESSAGES.it.descShort);
    await withLang('en', async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(m().descShort).toBe('Describe the problem in at least 10 characters.');
    });
    expect(m().descShort).toBe(MESSAGES.it.descShort);
  });

  describe('API', () => {
    let server: Server;
    afterEach(async () => { vi.unstubAllGlobals(); await new Promise((r) => server.close(r)); });

    it('risponde in inglese a chi lo chiede e salva la lingua della segnalazione', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'openway-i18n-'));
      const api = createApi({ env: {}, reportsFile: join(dir, 'reports.json'), osmDir: join(dir, 'osm') });
      server = createServer((req, res) => { void api(req, res); });
      await new Promise<void>((r) => server.listen(0, r));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const realFetch = globalThis.fetch;
      // Nessuna chiamata di rete reale: i servizi esterni rispondono "non disponibile".
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => url.startsWith(base) ? realFetch(url, init) : new Response('', { status: 503 }));
      const call = (path: string, lang: string | null, body?: unknown) => realFetch(`${base}${path}`, {
        method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
        headers: { 'Content-Type': 'application/json', ...(lang ? { 'Accept-Language': lang } : {}) },
      }).then((r) => r.json() as Promise<Record<string, unknown>>);

      expect((await call('/api/geocode?q=a', 'en')).error).toBe('Type at least 3 letters to search.');
      expect((await call('/api/geocode?q=a', null)).error).toBe('Scrivi almeno 3 lettere per cercare.');
      expect((await call('/api/route', 'en', { from: { lat: 0, lng: 0 }, to: { lat: 0, lng: 0 } })).error).toBe('The start and the destination must be in Italy.');

      const point = { lat: 43.7175, lng: 10.4005 };
      const english = await call('/api/reports', 'en', { ...point, description: 'There is a high step and I cannot get past.' });
      expect(english.lang).toBe('en');
      expect(english.category).toBe('steps');
      expect(english.blocking).toBe(true);
      const interpretation = english.interpretation as { note: string; question: { text: string } };
      expect(interpretation.note).toBe('Artificial intelligence is not active.');
      expect(interpretation.question.text).toBe('Roughly how high is it?');

      const italian = await call('/api/reports', null, { ...point, lat: 43.7176, description: 'Gradino alto davanti al portone, non riesco a passare.' });
      expect(italian.lang).toBe('it');
      expect((italian.interpretation as { note: string }).note).toBe("L'intelligenza artificiale non è attiva.");
    });
  });
});

describe('assistente segnalazioni in inglese', () => {
  it('chiede al modello di rispondere nella lingua di chi segnala', () => {
    const english = buildPrompt('High step at the entrance', false, 'en');
    expect(english).toContain('riassunto in inglese');
    expect(english).toContain('Non includere "I don\'t know"');
    expect(english).toContain('Scrivi in inglese tutti i testi');
    const italian = buildPrompt('Gradino alto', false, 'it');
    expect(italian).toContain('riassunto in italiano');
    expect(italian).not.toContain('Scrivi in');
  });

  it.each([
    ['The sidewalk is blocked by a parked car', 'obstructed_sidewalk'],
    ['Big pothole in the middle of the path', 'uneven_surface'],
    ['The kerb is too high to get up', 'kerb'],
    ['Very steep slope before the bridge', 'slope'],
    ['Nice sunny day in Pisa', 'other'],
  ] as const)('regole a parole chiave: %s → %s', (text, category) => {
    expect(fallbackInterpret(text, '').category).toBe(category);
  });

  it('le regole inglesi non cambiano la lettura di un testo italiano', () => {
    expect(fallbackInterpret("Un'auto blocca completamente il marciapiede", '').category).toBe('obstructed_sidewalk');
    expect(fallbackInterpret('Che bella giornata oggi a Pisa, il cielo è sereno.', '').category).toBe('other');
  });

  it('riconosce "non si passa" detto in inglese, senza inventarlo', () => {
    expect(fallbackInterpret('Stairs with no ramp, impossible to get through', '').blocking).toBe(true);
    expect(fallbackInterpret('The paving is a bit uneven but you can manage', '').blocking).toBeNull();
  });
});

describe('dettatura in inglese', () => {
  it.each([
    ['Take me to Piazza dei Cavalieri.', 'Piazza dei Cavalieri'],
    ['Please, go to Via Roma', 'Via Roma'],
    ['I want to go to the Leaning Tower please', 'the Leaning Tower'],
    ['Directions to Lungarno Mediceo', 'Lungarno Mediceo'],
    ['Piazza Garibaldi', 'Piazza Garibaldi'],
  ])('%s → %s', (said, place) => {
    expect(spokenPlaceQuery(said, 'en')).toBe(place);
  });

  it('in italiano resta com\'era', () => {
    expect(spokenPlaceQuery('Portami in Piazza dei Cavalieri.', 'it')).toBe('Piazza dei Cavalieri');
  });
});
