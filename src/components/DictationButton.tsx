import { useId } from 'react';
import { useDictation } from '../hooks/useDictation.ts';
import { useT } from '../i18n/index.ts';
import { Icon } from './Icon.tsx';

/** Registra fino a 30 secondi, poi invia a ElevenLabs solo quando chi parla preme "Trascrivi". Il testo resta modificabile. */
export function DictationButton({ onTranscript, disabled, label, maxLength, value }: {
  onTranscript: (text: string) => void; disabled?: boolean; label?: string; maxLength?: number; value?: string;
}) {
  const s = useT();
  const x = s.dictation;
  const d = useDictation({ onTranscript, disabled, maxLength, value });
  const helpId = useId();
  const canTranscribe = d.phase === 'recording' || d.phase === 'ready';
  const busy = ['requesting', 'stopping', 'transcribing'].includes(d.phase);
  const hint = !d.supported ? x.micUnsupported
    : d.configuration === 'checking' ? x.checking
    : d.configuration !== 'ready' ? x.notActive
    : d.phase === 'recording' ? x.recording
    : d.phase === 'ready' ? x.ready
    : d.phase === 'transcribing' ? x.transcribingHint
    : null;
  return (
    <div className="dictation">
      <div className="row">
        <button type="button" className={`btn btn--ghost btn--sm dictation__button${d.listening ? ' is-active' : ''}`}
          disabled={disabled || !d.supported || d.configuration !== 'ready' || busy}
          aria-pressed={d.listening} aria-describedby={hint ? helpId : undefined} aria-busy={busy}
          onClick={canTranscribe ? d.transcribe : d.start}>
          <Icon name={d.listening ? 'stop' : 'mic'} />
          {d.phase === 'requesting' ? x.allowMic : d.phase === 'stopping' ? x.moment
            : d.phase === 'transcribing' ? x.transcribing : canTranscribe ? x.transcribe : label ?? x.label}
        </button>
        {d.phase !== 'idle' && !busy && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={d.cancel}>{s.common.cancel}</button>
        )}
      </div>
      {hint && <p id={helpId} className="dictation__hint" role="status">{hint}</p>}
      {d.error && <p className="msg msg--error" role="alert">{d.error}</p>}
    </div>
  );
}
