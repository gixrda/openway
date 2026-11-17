import { useState, type ChangeEvent, type FormEvent } from 'react';
import { notSure, REPORT_CATEGORIES, type Report, type ReportCategory, type ReportDraft, type ServerStatus } from '../../shared/types.ts';
import { api } from '../api.ts';
import { getLang, useT } from '../i18n/index.ts';
import type { Recalc } from '../lib/reroute.ts';
import { recalcText } from './RoutePanel.tsx';
import { toJpegDataUrl } from '../lib/photo.ts';
import { DictationButton } from './DictationButton.tsx';
import { Icon } from './Icon.tsx';
import { Interpretation } from './DetailPanel.tsx';
import type { PickMode } from './MapView.tsx';

interface Props {
  point: { lat: number; lng: number } | null;
  setPoint: (p: { lat: number; lng: number } | null) => void;
  pickMode: PickMode;
  setPickMode: (m: PickMode) => void;
  onLocate: (target: 'report') => void;
  locating: boolean;
  status: ServerStatus | null;
  onCreated: (r: Report) => void;
  onShow: (r: Report) => void;
  /** C'è un percorso calcolato: una segnalazione bloccante lo farà ricalcolare */
  hasRoute: boolean;
  /** Esito del ricalcolo del percorso dopo l'invio */
  recalc: Recalc | null;
  onShowRoute: () => void;
}

const PASSABLE = [
  { value: true, key: 'blocks' },
  { value: false, key: 'hard' },
  { value: null, key: 'unknown' },
] as const;

/** Segnalazione in due tempi con un solo bottone che avanza: "Continua" fa leggere la descrizione, "Invia" la salva. */
export function ReportPanel(p: Props) {
  const s = useT();
  const rp = s.report;
  const [description, setDescriptionRaw] = useState('');
  const [photo, setPhotoRaw] = useState<string | null>(null);
  const [category, setCategory] = useState<ReportCategory | ''>('');
  const [draft, setDraft] = useState<ReportDraft | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  // Si passa? Proposto dall'analisi, confermato o corretto da chi segnala.
  const [blocking, setBlocking] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<'analyze' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Report | null>(null);
  const tooShort = description.trim().length < 10;
  
  // Cambiare testo o foto annulla la lettura: quella salvata deve corrispondere a ciò che si invia.
  const resetDraft = () => { setDraft(null); setAnswer(null); setCategory(''); };
  const setDescription = (v: string) => { setDescriptionRaw(v); if (draft) resetDraft(); };
  const setPhoto = (v: string | null) => { setPhotoRaw(v); if (draft) resetDraft(); };

  async function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setPhoto(await toJpegDataUrl(file));
    } catch {
      setError(rp.photoError);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (tooShort) { setError(rp.tooShortError); return; }
    setError(null);
    if (!draft) {
      setBusy('analyze');
      try {
        const d = await api.draftReport({ description, ...(photo ? { photo } : {}) });
        setDraft(d);
        setBlocking(d.interpretation.blocking);
      } catch (ex) {
        setError((ex as Error).message);
      } finally { setBusy(null); }
      return;
    }
    if (!p.point) { setError(rp.needPoint); return; }
    setBusy('send');
    try {
      const r = await api.createReport({
        ...p.point, description, draftId: draft.draftId, blocking,
        ...(category ? { category } : {}),
        ...(answer ? { answer } : {}),
      });
      setCreated(r);
      p.onCreated(r);
      p.setPoint(null);
      setDescriptionRaw(''); setPhotoRaw(null); resetDraft();
    } catch (ex) {
      setError((ex as Error).message);
    } finally { setBusy(null); }
  }

  if (created) {
    // Con un percorso attivo l'esito arriva dal ricalcolo; senza, dipende solo dalle regole sull'ostacolo.
    const outcome = p.hasRoute && p.recalc ? recalcText(s, p.recalc.kind) : null;
    const text = outcome ? `${outcome.title}. ${outcome.text}`
      : created.impact === 'avoid' ? rp.avoidFromNow
      : created.impact === 'unlocated' ? s.route.recalc.unlocated.text
      : rp.onMapSymbol(s.labels.category[created.category]);
    return (
      <section className="panel" aria-labelledby="done-title">
        <div className="verdict verdict--calm" role="status" aria-live="polite">
          <Icon name="check" size={22} />
          <div>
            <h2 id="done-title" className="verdict__title">{rp.thanks}</h2>
            <p className="verdict__text">{text} {rp.stillToCheck}</p>
          </div>
        </div>
        <div className="row">
          {p.hasRoute && <button type="button" className="btn btn--primary" onClick={p.onShowRoute}>{rp.viewRoute}</button>}
          <button type="button" className={`btn ${p.hasRoute ? 'btn--ghost' : 'btn--primary'}`} onClick={() => p.onShow(created)}>{rp.viewOnMap}</button>
          <button type="button" className="btn btn--ghost" onClick={() => setCreated(null)}>{rp.newReport}</button>
        </div>
      </section>
    );
  }

  const q = draft?.interpretation.question;
  const cta = busy === 'analyze' ? rp.analyzing
    : busy === 'send' ? rp.sending
    : draft ? rp.send : rp.next;
  // "Non so" è quello della lingua in cui la domanda è stata scritta, cioè la lingua della bozza.
  const unsure = notSure(getLang());

  return (
    <section className="panel" aria-labelledby="report-title">
      <h2 id="report-title" className="panel__title">{rp.title}</h2>
      <form onSubmit={submit} noValidate className="panel">
        <fieldset className="field">
          <legend className="field__label">{rp.where}</legend>
          {p.point ? (
            <div className="place">
              <Icon name="pin" />
              <span className="place__text">{s.common.mapPoint}</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => p.setPickMode('report')}>{rp.move}</button>
            </div>
          ) : (
            <div className="row">
              <button type="button" className={`btn btn--secondary btn--sm${p.pickMode === 'report' ? ' is-active' : ''}`}
                aria-pressed={p.pickMode === 'report'} onClick={() => p.setPickMode(p.pickMode === 'report' ? null : 'report')}>
                <Icon name="pin" /> {p.pickMode === 'report' ? rp.tapPoint : s.common.pickOnMap}
              </button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => p.onLocate('report')} disabled={p.locating}>
                <Icon name="locate" /> {p.locating ? s.common.locating : s.common.myPosition}
              </button>
            </div>
          )}
        </fieldset>

        <div className="field">
          <label htmlFor="desc" className="field__label">{rp.whatFound}</label>
          <textarea id="desc" rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder={rp.placeholder}
            aria-invalid={error !== null && tooShort} />
          <DictationButton label={rp.dictateDescription} value={description} maxLength={1000 - description.length}
            onTranscript={(text) => setDescription(description.trim() ? `${description.trim()} ${text}` : text)} />
          {photo ? (
            <div className="photo">
              <img src={photo} alt={rp.photoAlt} />
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPhoto(null)}>{rp.removePhoto}</button>
            </div>
          ) : (
            <label className="btn btn--ghost btn--sm file">
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pickPhoto} />
              <Icon name="camera" /> {rp.addPhoto} <span className="muted">{rp.optional}</span>
            </label>
          )}
        </div>

        {draft && (
          <div className="field" aria-live="polite">
            <h3 className="section-title">{rp.understood}</h3>
            <p className="field__help">{rp.understoodHelp}</p>
            <Interpretation
              interpretation={draft.interpretation}
              category={
                <select aria-label={rp.obstacleType} value={category || draft.interpretation.category}
                  onChange={(e) => setCategory(e.target.value as ReportCategory)}>
                  {REPORT_CATEGORIES.map((c) => <option key={c} value={c}>{s.labels.category[c]}</option>)}
                </select>
              }
            />
            <fieldset className="question">
              <legend className="question__text">{rp.passableQuestion}</legend>
              <div className="row">
                {PASSABLE.map((o) => (
                  <button key={o.key} type="button" className={`btn btn--ghost btn--sm${blocking === o.value ? ' is-active' : ''}`}
                    aria-pressed={blocking === o.value} onClick={() => setBlocking(o.value)}>{rp.passable[o.key]}</button>
                ))}
              </div>
              {blocking === true && <p className="field__help">{rp.routesWillAvoid}</p>}
            </fieldset>
            {q && (
              <fieldset className="question">
                <legend className="question__text">{q.text}</legend>
                <div className="row">
                  {[...q.options, unsure].map((o) => (
                    <button key={o} type="button" className={`btn btn--ghost btn--sm${answer === o ? ' is-active' : ''}`}
                      aria-pressed={answer === o} onClick={() => setAnswer(answer === o ? null : o)}>{o}</button>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        )}

        {error && <p className="msg msg--error" role="alert">{error}</p>}
        <button type="submit" className="btn btn--accent btn--block" disabled={busy !== null || tooShort || (draft !== null && !p.point)}>
          {cta}
        </button>
        {!busy && (tooShort || (draft && !p.point)) && (
          <p className="field__help">{tooShort ? rp.minChars : rp.needPointHelp}</p>
        )}
      </form>
    </section>
  );
}
