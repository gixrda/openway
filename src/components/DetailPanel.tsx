import { useState, type ReactNode } from 'react';
import {
  VERIFICATION_STATUSES, type Interpretation as InterpretationData, type OsmFeature, type Report, type ServerStatus, type VerificationStatus,
} from '../../shared/types.ts';
import { api } from '../api.ts';
import { formatDate, osmLabel, useLang, useT } from '../i18n/index.ts';
import { plainHint } from '../lib/alerts.ts';
import { Icon } from './Icon.tsx';
import type { Selection } from './MapView.tsx';

const CERTAINTY_CLASS = { known_obstacle: 'known', possible_issue: 'possible', positive_info: 'positive', info: 'info' } as const;

/**
 * Cosa ha capito l'analisi (Gemma o regole), con la risposta di chi segnala tenuta separata.
 * `category` permette di mostrare un controllo per correggere la categoria (modulo di segnalazione).
 */
export function Interpretation({ interpretation: i, category, followUp }: {
  interpretation: InterpretationData;
  category?: ReactNode;
  followUp?: Report['followUp'];
}) {
  const s = useT();
  const d = s.detail;
  return (
    <div className="interp">
      <dl className="kv">
        {category !== null && <><dt>{d.type}</dt><dd>{category ?? s.labels.category[i.category]}</dd></>}
        <dt>{d.summary}</dt><dd>{i.summary}</dd>
        {i.photo_note && <><dt>{d.inPhoto}</dt><dd>{i.photo_note}</dd></>}
        {i.severity !== 'unknown' && <><dt>{d.severity}</dt><dd>{s.labels.severity[i.severity]}</dd></>}
      </dl>
      {followUp && (
        <p className="answer"><span>{followUp.question}</span><strong>{followUp.answer}</strong></p>
      )}
      <p className="interp__engine" title={i.model}>
        {i.engine === 'gemma' ? d.engineGemma : d.engineFallback}{i.note ? ` ${i.note}` : ''}
      </p>
    </div>
  );
}

function ReportDetail({ report, status, onUpdated }: { report: Report; status: ServerStatus | null; onUpdated: (r: Report) => void }) {
  const s = useT();
  const d = s.detail;
  const lang = useLang();
  // Le segnalazioni restano nella lingua in cui sono state scritte: se è diversa da quella dell'interfaccia lo si dice.
  const writtenIn = report.lang ?? 'it';
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem('openway-admin') ?? ''; } catch { return ''; } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(s: VerificationStatus) {
    setBusy(true); setError(null);
    try {
      onUpdated(await api.setStatus(report.id, s, token));
      try { sessionStorage.setItem('openway-admin', token); } catch { /* storage non disponibile: nessun problema */ }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <>
      <h2 className="panel__title">{s.labels.category[report.category]}</h2>
      <p className="badge-line">
        <span className={`status status--${report.status}`}>{s.labels.status[report.status]}</span>
        <span className="muted">{d.reportedOn(formatDate(report.createdAt))}</span>
      </p>
      {report.blocking === true && (
        <p className="msg msg--warn"><strong>{d.notPassable}</strong>{d.notPassableRest(report.blockingSource === 'user')}</p>
      )}
      {report.status === 'unverified' && (
        <p className="msg msg--warn">{d.unverifiedNote}</p>
      )}
      <blockquote className="quote" lang={writtenIn}>{report.description}</blockquote>
      {writtenIn !== lang && <p className="field__help">{d.writtenIn(s.language.name[writtenIn])}</p>}
      {report.hasPhoto && <img className="report-photo" src={`/api/reports/${report.id}/photo`} alt={d.photoAlt} />}
      <Interpretation interpretation={report.interpretation} category={null} followUp={report.followUp} />
      {status?.admin && (
        <details className="admin">
          <summary>{d.moderatorActions}</summary>
          <p className="field__help">{d.moderatorHelp}</p>
          <label htmlFor="admin-token" className="field__label">{d.moderatorCode}</label>
          <input id="admin-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          <div className="row">
            {VERIFICATION_STATUSES.map((st) => (
              <button key={st} type="button" className="btn btn--secondary btn--sm" disabled={busy || !token || st === report.status} onClick={() => change(st)}>
                {s.labels.status[st]}
              </button>
            ))}
          </div>
          {error && <p className="msg msg--error" role="alert">{error}</p>}
          {report.statusUpdatedAt && <p className="field__help">{d.statusUpdated(formatDate(report.statusUpdatedAt))}</p>}
        </details>
      )}
    </>
  );
}

function FeatureDetail({ feature }: { feature: OsmFeature }) {
  const s = useT();
  const d = s.detail;
  const tone = CERTAINTY_CLASS[feature.certainty];
  const plain = feature.scope === 'path' ? plainHint(feature.kind) : undefined;
  return (
    <>
      <h2 className="panel__title">{osmLabel(feature)}</h2>
      {(plain || feature.name) && <p className="muted">{[plain, feature.name].filter(Boolean).join(' · ')}</p>}
      <p className="badge-line"><span className={`mk mk--${tone} mk--inline`} aria-hidden="true" /> <strong>{s.labels.certainty[feature.certainty]}</strong></p>
      <p>{s.labels.certaintyHint[feature.certainty]}</p>
      <details className="more">
        <summary>{d.technical}</summary>
        <dl className="kv">
          {Object.entries(feature.tags).filter(([k]) => k !== 'name').map(([k, v]) => (
            <div key={k} className="kv__row"><dt>{d.tag[k] ?? k}</dt><dd><code>{k}={v}</code></dd></div>
          ))}
        </dl>
        <p className="field__help">
          {d.source} <a href={`https://www.openstreetmap.org/${feature.id}`} target="_blank" rel="noreferrer">OpenStreetMap {feature.id}</a>.
          {' '}{d.mayBeOutdated}
        </p>
      </details>
    </>
  );
}

export function DetailPanel({ selection, status, onClose, onUpdated }: {
  selection: NonNullable<Selection>; status: ServerStatus | null; onClose: () => void; onUpdated: (r: Report) => void;
}) {
  const s = useT();
  return (
    <section className="panel detail" aria-label={s.detail.label}>
      <button type="button" className="btn btn--ghost btn--sm back" onClick={onClose}><Icon name="back" /> {s.common.back}</button>
      {selection.type === 'report'
        ? <ReportDetail report={selection.report} status={status} onUpdated={onUpdated} />
        : <FeatureDetail feature={selection.feature} />}
    </section>
  );
}
