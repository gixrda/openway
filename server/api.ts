import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { langFromHeader } from '../shared/lang.ts';
import { inTuscany, REGION_BOUNDS, straightDistanceM } from '../shared/area.ts';
import { RULES } from '../shared/rules.ts';
import { TILE_ZOOM } from '../shared/tiles.ts';
import type { GeocodeResult, ServerStatus } from '../shared/types.ts';
import { aiProvider } from './ai.ts';
import { HttpError, USER_AGENT, type Env } from './errors.ts';
import { currentLang, m, withLang } from './messages.ts';
import { createReportStore } from './reports.ts';
import { getFootRoute, getRoute } from './routing.ts';
import { synthesizeSpeech, transcribeAudio, voiceStatus } from './voice.ts';

export interface ApiOptions {
  env: Env;
  reportsFile: string;
  /** Cartella della griglia dei dati OSM (index.json e una cella per file), vedi server/tiles.ts */
  osmDir: string;
}

const gzipAsync = promisify(gzip);
// Una cella della griglia: /api/osm/<zoom>/<x>/<y>.json. Solo numeri: il percorso del file non si costruisce mai da testo libero.
const TILE_PATH = new RegExp(`^/api/osm/${TILE_ZOOM}/(\\d{1,6})/(\\d{1,6})\\.json$`);

/** Restituisce un handler che gestisce /api/* e risponde false per tutto il resto. */
export function createApi({ env, reportsFile, osmDir }: ApiOptions) {
  const reports = createReportStore(reportsFile);
  const geocodeCache = new Map<string, GeocodeResult[]>();
  let lastNominatim = 0;

  async function geocode(q: string): Promise<GeocodeResult[]> {
    // I nomi dei luoghi arrivano nella lingua della richiesta: la cache è separata per lingua.
    const lang = currentLang();
    const key = `${lang}:${q.trim().toLowerCase()}`;
    if (q.trim().length < 3) throw new HttpError(400, m().geocodeShort);
    const hit = geocodeCache.get(key);
    if (hit) return hit;
    // Policy Nominatim: massimo 1 richiesta al secondo, User-Agent identificativo, niente autocompletamento.
    const wait = lastNominatim + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastNominatim = Date.now();
    // Nominatim accetta solo un riquadro: i risultati fuori dal confine regionale si scartano dopo.
    const [s, w, n, e] = REGION_BOUNDS;
    const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
      q, format: 'jsonv2', limit: '8', viewbox: `${w},${n},${e},${s}`, bounded: '1', 'accept-language': lang,
    })}`;
    const down = m().geocodeDown;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) })
      .catch(() => { throw new HttpError(503, down); });
    if (!res.ok) throw new HttpError(503, down);
    const json = await res.json() as { display_name: string; lat: string; lon: string }[];
    const results = json.map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }))
      .filter((r) => inTuscany(r.lat, r.lng)).slice(0, 5);
    geocodeCache.set(key, results);
    return results;
  }

  /** Ogni richiesta gira nella lingua chiesta dall'interfaccia (Accept-Language): la leggono i messaggi in server/messages.ts. */
  return function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return Promise.resolve(false);
    return withLang(langFromHeader(req.headers['accept-language']), () => route(req, res, url));
  };

  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    const method = req.method ?? 'GET';
    try {
      if (method === 'GET' && path === '/api/status') {
        const ai = aiProvider(env);
        const status: ServerStatus = {
          routing: env.ORS_API_KEY ? 'openrouteservice' : 'valhalla',
          ai: ai.kind, ...(ai.model ? { aiModel: ai.model } : {}),
          admin: Boolean(env.ADMIN_TOKEN),
        };
        return send(res, 200, status);
      }
      if (method === 'GET' && path === '/api/voice/status') return send(res, 200, voiceStatus(env));
      if (method === 'POST' && path === '/api/voice/transcribe') {
        // Il modulo voce lavora su Request/FormData standard: la richiesta Node viene incapsulata senza copiarla.
        const headers: Record<string, string> = {};
        for (const h of ['content-type', 'content-length'] as const) if (req.headers[h]) headers[h] = String(req.headers[h]);
        const request = new Request(`http://localhost${path}`, { method: 'POST', headers, body: Readable.toWeb(req) as ReadableStream, duplex: 'half' } as RequestInit);
        return send(res, 200, await transcribeAudio(request, env));
      }
      if (method === 'POST' && path === '/api/voice/speak') {
        const audio = await synthesizeSpeech(await body(req), env);
        res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(Buffer.from(audio));
        return true;
      }
      // Dati OSM: l'indice delle celle e le singole celle, mai l'intera regione in una risposta.
      const tile = TILE_PATH.exec(path);
      if (method === 'GET' && (path === '/api/osm/index.json' || tile)) {
        const file = tile ? join(osmDir, String(TILE_ZOOM), tile[1], `${tile[2]}.json`) : join(osmDir, 'index.json');
        const data = await readFile(file).catch(() => { throw new HttpError(404, m().notFound); });
        const zip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
        res.writeHead(200, {
          'Content-Type': 'application/json', 'Cache-Control': 'max-age=300', Vary: 'Accept-Encoding',
          ...(zip ? { 'Content-Encoding': 'gzip' } : {}),
        });
        res.end(zip ? await gzipAsync(data) : data);
        return true;
      }
      if (method === 'GET' && path === '/api/reports') return send(res, 200, await reports.all());
      if (method === 'POST' && path === '/api/reports/draft') return send(res, 200, await reports.createDraft(await body(req, PHOTO_BODY), env));
      if (method === 'POST' && path === '/api/reports') return send(res, 201, await reports.create(await body(req), env));
      const photo = /^\/api\/reports\/([\w-]+)\/photo$/.exec(path);
      if (method === 'GET' && photo) {
        const img = await reports.photo(photo[1]);
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=3600' });
        res.end(img);
        return true;
      }

      const single = /^\/api\/reports\/([\w-]+)$/.exec(path);
      if (method === 'PATCH' && single) {
        if (!env.ADMIN_TOKEN) throw new HttpError(403, m().statusDisabled);
        if (!sameSecret(req.headers['x-admin-token'], env.ADMIN_TOKEN)) throw new HttpError(401, m().badModeratorCode);
        const { status } = (await body(req) ?? {}) as { status?: unknown };
        return send(res, 200, await reports.setStatus(single[1], status));
      }
      if (method === 'POST' && path === '/api/route') {
        const { from, to, profile = 'wheelchair' } = (await body(req) ?? {}) as {
          from?: { lat?: unknown; lng?: unknown }; to?: { lat?: unknown; lng?: unknown }; profile?: unknown;
        };
        if (!from || !to || !inTuscany(from.lat, from.lng) || !inTuscany(to.lat, to.lng)) {
          throw new HttpError(400, m().routeOutside);
        }
        if (profile !== 'wheelchair' && profile !== 'foot') throw new HttpError(400, m().badProfile);
        const [a, b] = [from as { lat: number; lng: number }, to as { lat: number; lng: number }];
        // Limite controllato prima di chiamare i servizi di routing: una richiesta troppo lunga non parte nemmeno.
        if (straightDistanceM(a, b) > RULES.MAX_ROUTE_M) throw new HttpError(400, m().routeTooLong(RULES.MAX_ROUTE_M / 1000));
        if (profile === 'foot') return send(res, 200, await getFootRoute(a, b));
        // Segnalazioni da evitare (regole in shared/rules.ts) non risolte, nella zona del percorso (riquadro allargato di ~1 km).
        const pad = 0.01;
        const [s, n] = [Math.min(a.lat, b.lat) - pad, Math.max(a.lat, b.lat) + pad];
        const [w, e] = [Math.min(a.lng, b.lng) - pad, Math.max(a.lng, b.lng) + pad];
        const avoid = (await reports.all())
          .filter((r) => r.impact === 'avoid' && r.status !== 'resolved' && r.lat >= s && r.lat <= n && r.lng >= w && r.lng <= e)
          .slice(-20)
          // impact 'avoid' implica un aggancio entro la soglia (o nessun aggancio disponibile)
          .map((r) => (r.snap ? { lat: r.snap.lat, lng: r.snap.lng } : { lat: r.lat, lng: r.lng }));
        return send(res, 200, await getRoute(a, b, env, avoid));
      }
      if (method === 'GET' && path === '/api/geocode') return send(res, 200, await geocode(url.searchParams.get('q') ?? ''));
      throw new HttpError(404, m().notFound);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      return send(res, 500, { error: m().generic });
    }
  }
}

/** Confronto a tempo costante: la durata della risposta non rivela quanti caratteri del codice sono giusti. */
function sameSecret(given: string | string[] | undefined, expected: string): boolean {
  if (typeof given !== 'string') return false;
  const [a, b] = [Buffer.from(given), Buffer.from(expected)];
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res: ServerResponse, status: number, data: unknown): true {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
  return true;
}

const PHOTO_BODY = 2_200_000; // foto JPEG fino a 1,5 MB in base64

async function body(req: IncomingMessage, limit = 16_384): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, m().tooLarge);
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, m().badJson); }
}
