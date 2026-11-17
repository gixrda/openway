import type { LatLngTuple, RouteResult } from '../../shared/types.ts';
import { useT } from '../i18n/index.ts';
import { formatDistance } from '../lib/analysis.ts';
import { useVoiceNavigation } from '../hooks/useVoiceNavigation.ts';

export function NavigationPanel({ route, onPosition }: { route: RouteResult; onPosition?: (coordinate: LatLngTuple) => void }) {
  const n = useT().nav;
  const navigation = useVoiceNavigation(route, onPosition);
  const multiLeg = navigation.instructions.some((step) => step.legIndex > 0);
  return (
    <section className="voice-navigation" aria-labelledby="voice-navigation-title">
      <h3 id="voice-navigation-title">{n.title}</h3>
      <p className="hint">{n.hint}</p>
      {!navigation.available && <p className="msg msg--warn">{route.mode !== 'wheelchair'
        ? n.notWheelchair
        : n.noManeuvers}</p>}
      {!navigation.supported && <p className="msg">{n.audioUnsupported}</p>}
      {navigation.checking && <p className="hint">{n.checking}</p>}
      {navigation.supported && !navigation.gpsSupported && <p className="msg">{n.needGps}</p>}
      <div className="voice-navigation__actions">
        <button type="button" className="btn btn--ghost" onClick={navigation.testVoice} disabled={!navigation.supported || !navigation.configured}>{n.testVoice}</button>
        <button type="button" className="btn btn--ghost" onClick={() => navigation.preview()}
          disabled={!navigation.supported || !navigation.configured || !navigation.available}>{n.listenNext}</button>
        <button type="button" className={`btn ${navigation.active ? 'btn--ghost' : 'btn--primary'}`}
          disabled={!navigation.supported || !navigation.configured || !navigation.gpsSupported || !navigation.available}
          onClick={navigation.active ? navigation.stop : navigation.start}>
          {navigation.active ? n.stop : n.start}
        </button>
      </div>
      <p className="voice-navigation__status" role="status">{navigation.status}</p>
      {navigation.audioLoading && <p className="hint" role="status">{n.preparing}</p>}
      {navigation.audioPlaying && <p className="hint" role="status">{n.playing}</p>}
      {(navigation.audioLoading || navigation.audioPlaying) && (
        <button type="button" className="btn btn--ghost" onClick={navigation.stopAudio}>{n.stopAudio}</button>
      )}
      {navigation.voiceError && <p className="msg msg--error" role="alert">{navigation.voiceError}</p>}
      {navigation.active && navigation.readyPosition && navigation.upcoming && (
        <div className="voice-navigation__next">
          <strong>{n.nextIn(formatDistance(navigation.upcomingDistanceM ?? 0))}</strong>
          <p>{navigation.upcomingInstruction}</p>
          <span className="hint">{n.remaining(formatDistance(navigation.remainingM))}</span>
        </div>
      )}
      {navigation.instructions.length > 0 && (
        <details className="voice-navigation__instructions">
          <summary>{n.instructions(navigation.instructions.length)}</summary>
          <ol>
            {navigation.instructions.map((step, index) => (
              <li key={`${step.legIndex}-${step.shapeIndex}-${index}`}>
                {multiLeg && <span className="hint">{n.leg} {String.fromCharCode(65 + step.legIndex)} → {String.fromCharCode(66 + step.legIndex)}</span>}
                <p>{step.instruction}</p>
                <button type="button" className="btn btn--ghost" disabled={!navigation.supported || !navigation.configured}
                  onClick={() => navigation.preview(index)} aria-label={n.listenN(index + 1)}>
                  {n.listenPreview}
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
      <p className="hint">{n.disclaimer}</p>
    </section>
  );
}
