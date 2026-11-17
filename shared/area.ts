// Area in cui OpenWay funziona: l'Italia. Il confine è un insieme di poligoni semplificati (shared/region.ts),
// non un rettangolo: un riquadro attorno all'Italia includerebbe la Corsica, la Slovenia e mezza Croazia.
import { REGION_BOUNDS, REGION_RINGS } from './region.ts';
import type { LatLngTuple } from './types.ts';

export { REGION_BOUNDS, REGION_RINGS };

/** Margine oltre il confine semplificato: copre la semplificazione (800 m), le isole minori vicine a terra e chi sta proprio sul confine. */
export const REGION_MARGIN_M = 2000;

const KY = 110_540;
const kx = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180);
const PAD = 0.03; // ~3 km in gradi: più del margine, per scartare subito i contorni lontani

// Riquadro di ogni contorno [sud, ovest, nord, est]: un punto si confronta solo con i contorni che gli stanno attorno.
const BOXES = REGION_RINGS.map((ring) => {
  let [s, w, n, e] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lat, lng] of ring) { s = Math.min(s, lat); w = Math.min(w, lng); n = Math.max(n, lat); e = Math.max(e, lng); }
  return [s - PAD, w - PAD, n + PAD, e + PAD];
});

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

/**
 * true se il punto è in Italia (isole comprese) o entro REGION_MARGIN_M dal confine.
 * La Città del Vaticano, chiusa dentro il Lazio, conta come interna (i contorni non hanno buchi);
 * San Marino no: sta tra due regioni, non dentro una.
 */
export function inArea(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const close: LatLngTuple[][] = [];
  for (let i = 0; i < REGION_RINGS.length; i++) {
    const [s, w, n, e] = BOXES[i];
    if (lat < s || lat > n || lng < w || lng > e) continue;
    if (insideRing(lat, lng, REGION_RINGS[i])) return true;
    close.push(REGION_RINGS[i]);
  }
  return close.some((r) => nearRing(lat, lng, r, REGION_MARGIN_M));
}

/** Distanza in linea d'aria in metri (formula dell'emisenoverso). */
export function straightDistanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
