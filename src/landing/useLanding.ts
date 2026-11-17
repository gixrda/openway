import { useEffect, useMemo, useState } from 'react';
import type { LatLngTuple, OsmFeature, Report, RouteResult } from '../../shared/types.ts';
import { api } from '../api.ts';
import { routeAlerts, type RouteAlert } from '../lib/alerts.ts';
import { useLang } from '../i18n/index.ts';
import { analyzeRoute } from '../lib/analysis.ts';
import { useRouteFeatures } from '../lib/osmTiles.ts';
import { getCopy, SCENARIOS } from './copy.ts';
import { STATIC, staticRoutes } from './staticData.ts';

// I tragitti demo stanno tutti nella zona universitaria di Pisa: bastano le celle che attraversano.
const DEMO_LINES = SCENARIOS.map((s) => [s.from, s.to]);
const NO_FEATURES: OsmFeature[] = [];

/** Ostacoli OSM dei tragitti demo e segnalazioni, caricati una volta per tutta la pagina. Se mancano, la mappa resta usabile. */
export function useMapData() {
  const features = useRouteFeatures(DEMO_LINES) ?? NO_FEATURES;
  const [reports, setReports] = useState<Report[]>([]);
  useEffect(() => {
    if (!STATIC) api.reports().then(setReports).catch(() => setReports([])); // le segnalazioni vivono sul server
  }, []);
  return { features, reports };
}

export type RouteState =
  | { status: 'idle' | 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; route: RouteResult; recordedAt?: string };

// Un percorso contiene testi del server (motivo della scelta, indicazioni di svolta): la cache è separata per lingua.
const cacheKey = (lang: string, from: LatLngTuple, to: LatLngTuple) => `openway-route:${lang}:${from.join(',')}|${to.join(',')}`;

// Il calcolo usa istanze pubbliche gratuite: lo stesso tragitto si chiede una volta per sessione.
// Un ripiego a piedi non si conserva, così alla visita successiva si riprova il profilo per sedia a rotelle.
function readCache(key: string): RouteResult | null {
  try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') as RouteResult | null; } catch { return null; }
}
function writeCache(key: string, route: RouteResult) {
  try { sessionStorage.setItem(key, JSON.stringify(route)); } catch { /* storage pieno o bloccato: si ricalcola */ }
}

/** Percorso reale per sedia a rotelle tra due punti; `null` non calcola nulla. `attempt` forza un nuovo tentativo. */
export function useRoute(pair: { from: LatLngTuple; to: LatLngTuple } | null, attempt = 0): RouteState {
  const [state, setState] = useState<RouteState>({ status: 'idle' });
  const lang = useLang();
  const from = pair?.from.join(','), to = pair?.to.join(',');
  useEffect(() => {
    if (!pair) { setState({ status: 'idle' }); return; }
    const key = cacheKey(lang, pair.from, pair.to);
    const hit = readCache(key);
    if (hit) { setState({ status: 'ready', route: hit }); return; }
    let live = true;
    setState({ status: 'loading' });
    const [a, b] = [pair.from, pair.to];
    if (STATIC) {
      staticRoutes()
        .then((r) => {
          const saved = r.routes[`${a.join(',')}|${b.join(',')}`];
          if (!live) return;
          // L'avviso di ripiego è stato registrato in italiano: qui lo si ripete nella lingua della pagina.
          const route = saved?.mode === 'foot_fallback' && saved.notice ? { ...saved, notice: getCopy().routeCard.recordedFoot } : saved;
          setState(route ? { status: 'ready', route, recordedAt: r.recordedAt } : { status: 'error', message: getCopy().routeCard.notRecorded });
        })
        .catch((e: Error) => { if (live) setState({ status: 'error', message: e.message }); });
      return () => { live = false; };
    }
    api.route({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] })
      .then((route) => { if (route.mode === 'wheelchair') writeCache(key, route); if (live) setState({ status: 'ready', route }); })
      .catch((e: Error) => { if (live) setState({ status: 'error', message: e.message }); });
    return () => { live = false; };
  }, [from, to, attempt, lang]); // la coppia è confrontata per valore, non per riferimento; al cambio lingua si ricalcola
  return state;
}

/** Punti di attenzione con la stessa analisi dell'app, numerati nell'ordine di percorrenza. */
export function useAlerts(route: RouteResult | null, features: OsmFeature[], reports: Report[]): RouteAlert[] {
  return useMemo(() => route ? routeAlerts(route, analyzeRoute(route.coords, features, reports)) : [], [route, features, reports]);
}
