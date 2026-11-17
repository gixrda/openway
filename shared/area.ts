// Area in cui OpenWay funziona: la regione Toscana. Il confine è un poligono semplificato (shared/region.ts),
// non un rettangolo: un riquadro attorno alla Toscana includerebbe La Spezia, Perugia e mezza Emilia.
import { REGION_BOUNDS, REGION_RINGS } from './region.ts';
import type { LatLngTuple } from './types.ts';

export { REGION_BOUNDS, REGION_RINGS };

/** Margine oltre il confine semplificato: copre la semplificazione (300 m) e chi sta proprio sul confine. */
export const REGION_MARGIN_M = 1000;

const KY = 110_540;
const kx = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);

function insideRing(lat: number, lng: number, ring: LatLngTuple[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [la, lo] = ring[i], [lb, lob] = ring[j];
    if ((la > lat) !== (lb > lat) && lng < ((lob - lo) * (lat - la)) / (lb - la) + lo) inside = !inside;
  }
  return inside;
}

function nearRing(lat: number, lng: number, ring: LatLngTuple[], maxM: number): boolean {
  const k = kx(lat);
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = [(ring[j][1] - lng) * k, (ring[j][0] - lat) * KY];
    const [bx, by] = [(ring[i][1] - lng) * k, (ring[i][0] - lat) * KY];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    if (Math.hypot(ax + t * dx, ay + t * dy) <= maxM) return true;
  }
  return false;
}

/** true se il punto è in Toscana (isole comprese) o entro REGION_MARGIN_M dal confine. */
export function inTuscany(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const [s, w, n, e] = REGION_BOUNDS;
  const pad = 0.02; // ~2 km: scarta subito i punti lontani
  if (lat < s - pad || lat > n + pad || lng < w - pad || lng > e + pad) return false;
  return REGION_RINGS.some((r) => insideRing(lat, lng, r)) || REGION_RINGS.some((r) => nearRing(lat, lng, r, REGION_MARGIN_M));
}

/** Distanza in linea d'aria in metri (formula dell'emisenoverso). */
export function straightDistanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
