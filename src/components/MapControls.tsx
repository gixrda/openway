import { useEffect, useRef, useState } from 'react';
import { formatDate, useT } from '../i18n/index.ts';
import { Icon } from './Icon.tsx';
import type { Layers } from './MapView.tsx';

const ITEMS: { key: keyof Layers; tone: string }[] = [
  { key: 'known', tone: 'known' },
  { key: 'reports', tone: 'report' },
  { key: 'possible', tone: 'possible' },
  { key: 'positive', tone: 'positive' },
  { key: 'info', tone: 'info' },
  { key: 'places', tone: 'place' },
];

/** Capsula di controlli flottante sulla mappa: cosa mostrare, dove sono e in che lingua leggere. */
export function MapControls({ layers, onLayers, osmDate, demoOnly, onLocate, locating, onLanguage }: {
  layers: Layers; onLayers: (l: Layers) => void; osmDate?: string;
  /** true se sono caricati solo i dati demo di Pisa (mancano quelli regionali) */
  demoOnly?: boolean;
  onLocate: () => void; locating: boolean; onLanguage: () => void;
}) {
  const s = useT();
  const m = s.map;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Il pannello dei livelli si chiude con Esc o toccando fuori.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [open]);

  return (
    <div className="controls" ref={root}>
      <div className="controls__capsule glass">
        <button type="button" className="btn btn--icon" aria-expanded={open} aria-controls="layers-body"
          aria-label={m.whatShows} title={m.whatShows} onClick={() => setOpen(!open)}>
          <Icon name="layers" size={20} />
        </button>
        <span className="controls__sep" aria-hidden="true" />
        <button type="button" className="btn btn--icon" onClick={onLocate} disabled={locating}
          aria-label={m.showWhere} title={m.showWhere}>
          <Icon name="locate" size={20} />
        </button>
        <span className="controls__sep" aria-hidden="true" />
        {/* Il bottone mostra la lingua a cui si passa, scritta in quella lingua: la trova anche chi non legge quella corrente. */}
        <button type="button" className="btn btn--icon controls__lang" onClick={onLanguage}
          aria-label={s.language.switchTo} title={s.language.switchTo} lang={s.language.switchCode.toLowerCase()}>
          {s.language.switchCode}
        </button>
      </div>
      {open && (
        <div id="layers-body" className="layers glass" role="dialog" aria-label={m.whatShows}>
          <h2 className="layers__title">{m.whatShows}</h2>
          <fieldset>
            <legend className="sr-only">{m.visibleLayers}</legend>
            {ITEMS.map((it) => (
              <label key={it.key} className="layer">
                <span className={`mk mk--${it.tone} mk--inline`} aria-hidden="true" />
                <span className="layer__label">{m.layers[it.key]}</span>
                <input type="checkbox" className="switch" checked={layers[it.key]}
                  onChange={(e) => onLayers({ ...layers, [it.key]: e.target.checked })} />
              </label>
            ))}
          </fieldset>
          <p className="layers__legend">
            <span className="pin-mini" aria-hidden="true">?</span> {m.legendToCheck}
            <span className="pin-mini pin-mini--ok" aria-hidden="true">✓</span> {m.legendChecked}
            <span className="pin-mini pin-mini--block" aria-hidden="true" /> {m.legendBlocks}
          </p>
          <p className="layers__legend"><span className="hatch-key hatch-key--none" aria-hidden="true" /> {m.legendNoData}</p>
          <p className="layers__legend"><span className="hatch-key hatch-key--few" aria-hidden="true" /> {m.legendFewData}</p>
          <p className="layers__legend">
            {m.legendNote(osmDate ? formatDate(osmDate, { dateStyle: 'short' }) : null)}
            {demoOnly && ` ${m.legendDemoOnly}`}
          </p>
        </div>
      )}
    </div>
  );
}
