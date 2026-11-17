// Versione statica della landing (GitHub Pages): niente server, quindi niente /api.
// I percorsi registrati vengono serviti come file (come le celle dei dati OSM, vedi src/lib/osmTiles.ts);
// la ricerca va direttamente a Nominatim.
import { inTuscany, REGION_BOUNDS } from '../../shared/area.ts';
import type { GeocodeResult, RouteResult } from '../../shared/types.ts';
import { getLang, t } from '../i18n/index.ts';
import { getCopy } from './copy.ts';
import { BASE, STATIC } from './env.ts';

export { BASE, STATIC };

export interface RecordedRoutes { recordedAt: string; routes: Record<string, RouteResult> }

let recorded: Promise<RecordedRoutes> | null = null;
async function json<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`).catch(() => { throw new Error(t().api.offline); });
  if (!res.ok) throw new Error(getCopy().routeCard.dataUnavailable);
  return res.json() as Promise<T>;
}

export const staticRoutes = () => (recorded ??= json<RecordedRoutes>('data/routes-recorded.json'));

// Policy Nominatim: al massimo 1 richiesta al secondo, solo all'invio (niente autocompletamento), risultati in cache.
const cache = new Map<string, GeocodeResult[]>();
let last = 0;
export async function geocodeDirect(q: string): Promise<GeocodeResult[]> {
  // I nomi dei luoghi arrivano nella lingua dell'interfaccia: la cache è separata per lingua.
  const lang = getLang();
  const key = `${lang}:${q.trim().toLowerCase()}`;
  if (q.trim().length < 3) throw new Error(getCopy().hero.tooShort);
  const hit = cache.get(key);
  if (hit) return hit;
  const wait = last + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const [s, w, n, e] = REGION_BOUNDS; // riquadro per Nominatim; il confine vero si applica ai risultati
  const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    q: q.trim().slice(0, 200), format: 'jsonv2', limit: '8', viewbox: `${w},${n},${e},${s}`, bounded: '1', 'accept-language': lang,
  })}`;
  const res = await fetch(url, { referrerPolicy: 'strict-origin-when-cross-origin' }).catch(() => null);
  if (!res?.ok) throw new Error(getCopy().routeCard.searchDown);
  const data = await res.json() as { display_name?: unknown; lat?: unknown; lon?: unknown }[];
  // I dati arrivano da un servizio esterno: si tengono solo campi del tipo atteso, mai HTML.
  const results = (Array.isArray(data) ? data : [])
    .filter((r) => typeof r.display_name === 'string' && Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon)))
    .map((r) => ({ label: String(r.display_name).slice(0, 300), lat: Number(r.lat), lng: Number(r.lon) }))
    .filter((r) => inTuscany(r.lat, r.lng)).slice(0, 5);
  cache.set(key, results);
  return results;
}
