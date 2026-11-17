import type { LatLngTuple, OsmFeature, RouteResult } from '../../shared/types.ts';
import type { Selection } from '../components/MapView.tsx';
import { distanceAlong, formatDistance, routeObstacles, type RouteAnalysis } from './analysis.ts';
import type { IconName } from './icons.ts';
import { osmLabel, t } from '../i18n/index.ts';
import { CATEGORY_ICON } from './labels.ts';

/** Un punto a cui fare attenzione lungo il percorso: ostacolo noto, segnalazione o tratto senza marciapiede. */
export interface RouteAlert {
  key: string;
  kind: 'obstacle' | 'report' | 'road';
  icon: IconName;
  title: string;
  detail: string;
  alongM: number;
  /** Dove mostrare il numero sulla mappa */
  anchor: LatLngTuple;
  focus: LatLngTuple[];
  selection?: NonNullable<Selection>;
}

/** Spiegazione in parole semplici, per chi non conosce i termini tecnici (testi in src/i18n, chiave alerts.plain). */
export const plainHint = (kind: OsmFeature['kind']): string | undefined => t().alerts.plain[kind];

const coordsOf = (f: OsmFeature): LatLngTuple[] => f.geometry.type === 'point' ? [f.geometry.coords] : f.geometry.coords;

/** Tutti i punti di attenzione, nell'ordine in cui si incontrano: numerati allo stesso modo nel pannello e sulla mappa. */
export function routeAlerts(route: RouteResult, analysis: RouteAnalysis): RouteAlert[] {
  const s = t();
  const a = s.alerts;
  const alerts: RouteAlert[] = routeObstacles(analysis).map((o): RouteAlert => {
    if (o.type === 'report') {
      const r = o.report;
      return {
        key: r.id, kind: 'report', icon: r.blocking ? 'block' : CATEGORY_ICON[r.category] as IconName,
        title: r.blocking ? a.reportBlocked(s.labels.category[r.category]) : s.labels.category[r.category],
        detail: r.status === 'unverified' ? a.reportedUnverified : a.reportedVerified,
        alongM: o.alongM, anchor: [r.lat, r.lng], focus: [[r.lat, r.lng]], selection: { type: 'report', report: r },
      };
    }
    const f = o.feature;
    const coords = coordsOf(f);
    return {
      key: f.id, kind: 'obstacle', icon: f.kind,
      title: osmLabel(f), detail: [plainHint(f.kind), f.name].filter(Boolean).join(' · '),
      alongM: o.alongM, anchor: coords[0], focus: coords, selection: { type: 'feature', feature: f },
    };
  });
  for (const [i, seg] of (route.safety?.segments ?? []).entries()) {
    if (!seg.coords.length) continue;
    alerts.push({
      key: `segment-${i}`, kind: 'road', icon: seg.kind === 'steps' ? 'steps' : 'road',
      title: seg.kind === 'main_road' ? a.mainRoad : seg.kind === 'steps' ? a.steps : a.carriageway,
      detail: a.roadDetail(seg.name ?? a.unnamed, formatDistance(seg.lengthM)),
      alongM: distanceAlong(route.coords, seg.coords[0]), anchor: seg.coords[Math.floor(seg.coords.length / 2)], focus: seg.coords,
    });
  }
  return alerts.sort((x, y) => x.alongM - y.alongM);
}
