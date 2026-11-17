import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { inArea, straightDistanceM } from '../shared/area.ts';
import { RULES } from '../shared/rules.ts';
import { cellsInBounds, dataLevel, type OsmIndex } from '../shared/tiles.ts';
import type { OsmFeature, Report, RouteResult, ServerStatus } from '../shared/types.ts';
import { api } from './api.ts';
import { DetailPanel } from './components/DetailPanel.tsx';
import { setLang, t, useLang } from './i18n/index.ts';
import { MapControls } from './components/MapControls.tsx';
import { MapView, type Focus, type Layers, type MapViewState, type PickMode, type Selection } from './components/MapView.tsx';
import { ReportPanel } from './components/ReportPanel.tsx';
import { RoutePanel } from './components/RoutePanel.tsx';
import { routeAlerts } from './lib/alerts.ts';
import { analyzeRoute } from './lib/analysis.ts';
import { dataInBounds, FEATURE_ZOOM, useOsmIndex, useRouteFeatures, useViewFeatures } from './lib/osmTiles.ts';
import { avoids, rerouteDecision, type Recalc } from './lib/reroute.ts';

type Place = { lat: number; lng: number; label: string };
type Tab = 'route' | 'report';

function placeFromUrl(key: string): Place | null {
  const [lat, lng] = (new URLSearchParams(window.location.search).get(key) ?? '').split(',').map(Number);
  return inArea(lat, lng) ? { lat, lng, label: t().app.linkPoint } : null;
}

/**
 * Dice a parole quanti dati OpenStreetMap ci sono nella zona guardata: è l'equivalente testuale del tratteggio sulla mappa.
 * Pochi dati non vuol dire pochi ostacoli: lo si scrive, invece di lasciare una mappa vuota che sembra una buona notizia.
 */
function DataNote({ index, view }: { index: OsmIndex; view: MapViewState }) {
  const m = t().map;
  let text: string;
  if (view.zoom < FEATURE_ZOOM) text = m.dataZoomIn;
  else {
    const count = dataInBounds(index, view.bounds);
    const level = dataLevel(Math.round(count / cellsInBounds(view.bounds).length));
    text = level === 'none' ? m.dataNone : level === 'few' ? m.dataFew(count) : m.dataSome(count);
  }
  return <p className="data-note glass" role="status">{text}</p>;
}

export default function App() {
  const lang = useLang();
  const s = t();
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [view, setView] = useState<MapViewState | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('route');
  const [sheetOpen, setSheetOpen] = useState(true);
  const [layers, setLayers] = useState<Layers>({ known: true, possible: true, positive: true, info: false, places: false, reports: true });
  const [pickMode, setPickModeRaw] = useState<PickMode>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [focus, setFocus] = useState<Focus>(null);

  // ?from=lat,lng&to=lat,lng precompila partenza e arrivo (link ripetibili per la demo).
  const [from, setFrom] = useState<Place | null>(() => placeFromUrl('from'));
  const [to, setTo] = useState<Place | null>(() => placeFromUrl('to'));
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [footRoute, setFootRoute] = useState<RouteResult | null>(null);
  const [showFoot, setShowFoot] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [reportPoint, setReportPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const requestId = useRef(0);
  const [recalc, setRecalc] = useState<Recalc | null>(null);

  // La descrizione della pagina segue la lingua scelta.
  useEffect(() => {
    document.querySelector('meta[name="description"]')?.setAttribute('content', s.meta.description);
  }, [s]);

  // Su smartphone il pannello copre la parte bassa della mappa: la sua altezza sposta l'attribuzione e i controlli in basso.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--sheet-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    // Ogni sorgente fallisce in modo indipendente: la mappa resta utilizzabile anche senza dati OSM o segnalazioni.
    api.status().then(setStatus).catch(() => setStatus(null));
    api.reports().then(setReports).catch(() => setLoadError(t().app.loadReportsError));
  }, []);

  // Dati OSM a celle: l'indice dice quanti dati ci sono zona per zona; gli elementi arrivano solo per la zona guardata
  // e per le celle attraversate dai percorsi. Se non arrivano lo si dice, e la mappa resta utilizzabile.
  const osmFailed = useCallback(() => setLoadError(t().app.loadOsmError), []);
  const osmIndex = useOsmIndex(osmFailed);
  const viewFeatures = useViewFeatures(view, osmFailed);
  const routeFeatures = useRouteFeatures([route?.coords, footRoute?.coords], osmFailed);
  // Finché i dati lungo il percorso non sono arrivati non c'è un esito: "nessun ostacolo" si dice solo dopo averli letti.
  const analysis = useMemo(() => route && routeFeatures ? analyzeRoute(route.coords, routeFeatures, reports) : null, [route, routeFeatures, reports]);
  const footAnalysis = useMemo(() => footRoute && routeFeatures ? analyzeRoute(footRoute.coords, routeFeatures, reports) : null, [footRoute, routeFeatures, reports]);
  // Sulla mappa: la zona guardata, più gli ostacoli noti del percorso e l'elemento selezionato (visibili anche da lontano).
  const features = useMemo(() => {
    const extra = [...(analysis?.known ?? []), ...(selection?.type === 'feature' ? [selection.feature] : [])];
    const seen = new Set(viewFeatures.map((f) => f.id));
    return [...viewFeatures, ...extra.filter((f: OsmFeature) => !seen.has(f.id) && seen.add(f.id))];
  }, [viewFeatures, analysis, selection]);

  const setPickMode = useCallback((m: PickMode) => {
    setPickModeRaw(m);
    if (m && window.matchMedia('(max-width: 759px)').matches) setSheetOpen(false); // libera la mappa su smartphone
  }, []);

  // Un nuovo punto invalida il percorso precedente.
  const changeFrom = (p: Place | null) => { setFrom(p); setRoute(null); setFootRoute(null); setRouteError(null); setRecalc(null); };
  const changeTo = (p: Place | null) => { setTo(p); setRoute(null); setFootRoute(null); setRouteError(null); setRecalc(null); };

  function onPick(p: { lat: number; lng: number }) {
    const label = s.common.mapPoint;
    if (pickMode === 'from') changeFrom({ ...p, label });
    if (pickMode === 'to') changeTo({ ...p, label });
    if (pickMode === 'report') setReportPoint(p);
    setPickModeRaw(null);
    setGeoError(null);
    setSheetOpen(true);
  }

  function locate(target: 'from' | 'report' | 'view') {
    if (!('geolocation' in navigator)) { setGeoError(s.app.geoUnsupported); return; }
    setLocating(true); setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocating(false);
        const p = { lat: coords.latitude, lng: coords.longitude };
        if (!inArea(p.lat, p.lng)) { setGeoError(t().app.geoOutside); return; }
        setUserPos(p);
        setFocus({ coords: [[p.lat, p.lng]], nonce: Date.now() });
        if (target === 'from') changeFrom({ ...p, label: t().common.myPosition });
        else if (target === 'report') setReportPoint(p);
      },
      (err) => {
        setLocating(false);
        setGeoError(err.code === err.PERMISSION_DENIED ? t().app.geoDenied : t().app.geoFailed);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  /**
   * Calcola il percorso tra partenza e arrivo. Con keep=true (ricalcolo dopo una segnalazione) il percorso attuale
   * resta visibile finché arriva il nuovo e un errore non lo cancella. Le risposte superate da una richiesta
   * più recente vengono scartate.
   */
  async function calculate(opts: { keep?: boolean } = {}): Promise<{ ok: true; route: RouteResult } | { ok: false; message: string } | { stale: true }> {
    if (!from || !to) return { ok: false, message: t().app.chooseEndpoints };
    // Stesso limite del server (shared/rules.ts): una richiesta troppo lunga non parte nemmeno.
    if (straightDistanceM(from, to) > RULES.MAX_ROUTE_M) {
      const message = t().app.routeTooLong(RULES.MAX_ROUTE_M / 1000);
      if (!opts.keep) { setRoute(null); setFootRoute(null); setRouteError(message); }
      return { ok: false, message };
    }
    const id = ++requestId.current;
    setRouteLoading(true); setRouteError(null);
    if (!opts.keep) { setRoute(null); setFootRoute(null); setSelection(null); setRecalc(null); }
    // Il percorso a piedi serve solo al confronto: se non arriva, il percorso principale resta valido.
    const [main, foot] = await Promise.allSettled([api.route(from, to), api.route(from, to, 'foot')]);
    if (id !== requestId.current) return { stale: true };
    setRouteLoading(false);
    if (main.status === 'rejected') {
      const message = (main.reason as Error).message;
      if (!opts.keep) setRouteError(message);
      return { ok: false, message };
    }
    const footR = foot.status === 'fulfilled' ? foot.value : null;
    setRoute(main.value);
    setFootRoute(footR);
    setFocus({ coords: [...main.value.coords, ...(footR?.coords ?? [])], nonce: Date.now() });
    return { ok: true, route: main.value };
  }

  // Avvisi, motivi della scelta e indicazioni di svolta arrivano dal server nella lingua della richiesta:
  // al cambio lingua il percorso attivo viene ricalcolato, restando visibile nel frattempo.
  const routeLang = useRef(lang);
  useEffect(() => {
    if (routeLang.current === lang) return;
    routeLang.current = lang;
    if (route && from && to) void calculate({ keep: true });
  }, [lang]); // eslint-disable-line react-hooks/exhaustive-deps

  function select(sel: Selection) {
    setSelection(sel);
    setSheetOpen(true);
    if (!sel) return;
    const coords = sel.type === 'report' ? [[sel.report.lat, sel.report.lng] as [number, number]]
      : sel.feature.geometry.type === 'point' ? [sel.feature.geometry.coords] : sel.feature.geometry.coords;
    setFocus({ coords, nonce: Date.now() });
  }

  function upsertReport(r: Report) {
    setReports((rs) => rs.some((x) => x.id === r.id) ? rs.map((x) => x.id === r.id ? r : x) : [...rs, r]);
    if (selection?.type === 'report' && selection.report.id === r.id) setSelection({ type: 'report', report: r });
  }

  /** Dopo una segnalazione: si ricalcola solo se l'ostacolo va evitato ed è davvero sul percorso attivo. */
  async function onReportCreated(r: Report) {
    upsertReport(r);
    if (!route || !from || !to) { setRecalc(null); return; }
    const decision = rerouteDecision(r, route.coords);
    if (decision !== 'reroute') { setRecalc({ kind: decision }); return; }
    setRecalc({ kind: 'running' });
    const res = await calculate({ keep: true });
    if ('stale' in res) return;
    if (!res.ok) { setRecalc({ kind: 'error', message: res.message }); return; }
    if (res.route.mode !== 'wheelchair') { setRecalc({ kind: 'error', message: res.route.notice ?? t().app.wheelchairDown }); return; }
    // Si dichiara "aggiornato" solo se la geometria del nuovo percorso non passa più dall'ostacolo.
    setRecalc({ kind: avoids(res.route.coords, r) ? 'updated' : 'no-alternative' });
  }

  function startReport() {
    setTab('report'); setSelection(null); setSheetOpen(true);
    if (!reportPoint) setPickMode('report');
  }

  return (
    <div className="app">
      <MapView features={features} index={osmIndex} onView={setView} reports={reports} layers={layers} route={route} from={from} to={to}
        compareRoute={route?.mode === 'wheelchair' && showFoot ? footRoute : null}
        alerts={route && analysis ? routeAlerts(route, analysis) : []}
        onAlert={(a) => (a.selection ? select(a.selection) : setFocus({ coords: a.focus, nonce: Date.now() }))}
        reportPoint={reportPoint} userPos={userPos} pickMode={pickMode} selection={selection} focus={focus}
        onPick={onPick} onSelect={select} />

      <p className="brand-pill glass" aria-hidden="true"><img className="brand__mark" src="/logo.png" alt="" />OpenWay</p>

      <MapControls layers={layers} onLayers={setLayers} osmDate={osmIndex?.fetchedAt} demoOnly={osmIndex?.scope === 'demo'}
        onLocate={() => locate('view')} locating={locating} onLanguage={() => setLang(lang === 'it' ? 'en' : 'it')} />

      {osmIndex && view && !pickMode && <DataNote index={osmIndex} view={view} />}

      {pickMode && (
        <div className="pickbar" role="status">
          <span>{s.app.pick[pickMode]}</span>
          <button type="button" className="btn btn--sm pickbar__cancel" onClick={() => { setPickModeRaw(null); setSheetOpen(true); }}>{s.common.cancel}</button>
        </div>
      )}

      <aside ref={sheetRef} className={`sheet glass${sheetOpen ? '' : ' sheet--collapsed'}`} aria-label={s.app.panelLabel}>
        <button type="button" className="sheet__handle" onClick={() => setSheetOpen(!sheetOpen)} aria-expanded={sheetOpen}>
          <span aria-hidden="true" className="sheet__grip" />
          <span className="sr-only">{sheetOpen ? s.app.collapse : s.app.expand}</span>
        </button>
        <header className="sheet__header">
          <div className="brand">
            <img className="brand__mark" src="/logo.png" alt="" width="34" height="34" />
            <div>
              <h1 className="brand__name">OpenWay</h1>
              <p className="brand__place">{s.app.place}</p>
            </div>
          </div>
          <div className="tabs" role="group" aria-label={s.app.sections}>
            <button type="button" aria-pressed={tab === 'route' && !selection} className="tab"
              onClick={() => { setTab('route'); setSelection(null); setSheetOpen(true); }}>{s.app.tabRoute}</button>
            <button type="button" aria-pressed={tab === 'report' && !selection} className="tab"
              onClick={startReport}>{s.app.tabReport}</button>
          </div>
        </header>
        <div className="sheet__body">
          {loadError && <p className="msg msg--warn" role="status">{loadError}</p>}
          {geoError && <p className="msg msg--error" role="alert">{geoError}</p>}
          {selection ? (
            <DetailPanel selection={selection} status={status} onClose={() => setSelection(null)} onUpdated={upsertReport} />
          ) : tab === 'route' ? (
            <RoutePanel from={from} to={to} setFrom={changeFrom} setTo={changeTo} pickMode={pickMode} setPickMode={setPickMode}
              onLocate={locate} locating={locating} onCalculate={() => void calculate()}
              loading={routeLoading || (route !== null && analysis === null)} error={routeError}
              recalc={recalc} onDismissRecalc={() => setRecalc(null)}
              onPosition={(c) => setUserPos({ lat: c[0], lng: c[1] })}
              route={route} analysis={analysis} footRoute={footRoute} footAnalysis={footAnalysis}
              showFoot={showFoot} setShowFoot={setShowFoot} onSelect={select}
              onFocus={(coords) => setFocus({ coords, nonce: Date.now() })} />
          ) : (
            <ReportPanel point={reportPoint} setPoint={setReportPoint} pickMode={pickMode} setPickMode={setPickMode}
              onLocate={locate} locating={locating} status={status}
              onCreated={onReportCreated} onShow={(r) => select({ type: 'report', report: r })}
              hasRoute={route !== null} recalc={recalc} onShowRoute={() => { setTab('route'); setSelection(null); }} />
          )}
        </div>
      </aside>
    </div>
  );
}
