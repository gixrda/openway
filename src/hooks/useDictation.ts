import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lang } from '../../shared/lang.ts';
import { getLang, t } from '../i18n/index.ts';
import { getVoiceStatus, transcribeAudio } from '../lib/voiceApi.ts';

type Phase = 'idle' | 'requesting' | 'recording' | 'stopping' | 'ready' | 'transcribing';
type Configuration = 'checking' | 'ready' | 'missing' | 'failed';
interface Capture {
  source: string | undefined;
  language: Lang | 'auto';
  stream?: MediaStream;
  recorder?: MediaRecorder;
  chunks: Blob[];
  bytes: number;
  blob?: Blob;
  uploadOnStop: boolean;
  controller?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}
let activeDictation: { capture: Capture; cancel: () => void } | null = null;
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;
const MAX_RECORDING_MS = 30_000;

function recordingAvailable() {
  return typeof window !== 'undefined' && window.isSecureContext
    && typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof MediaRecorder === 'function';
}
function releaseMicrophone(capture: Capture) {
  if (capture.timer) clearTimeout(capture.timer);
  capture.timer = undefined;
  capture.stream?.getTracks().forEach((track) => track.stop());
  capture.stream = undefined;
}

/**
 * Local bounded recording followed by an explicit ElevenLabs transcription request.
 * Unless told otherwise, the expected spoken language is the interface language.
 */
export function useDictation({ onTranscript, value, disabled = false, maxLength = 1000, language = getLang(), onRecordingStart }: {
  onTranscript: (text: string) => void; value?: string; disabled?: boolean; maxLength?: number;
  language?: Lang | 'auto'; onRecordingStart?: () => void;
}) {
  const [supported, setSupported] = useState(false);
  const [configuration, setConfiguration] = useState<Configuration>('checking');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const capture = useRef<Capture | null>(null);
  const latest = useRef({ onTranscript, value, disabled, maxLength, language, onRecordingStart });
  latest.current = { onTranscript, value, disabled, maxLength, language, onRecordingStart };

  const discard = useCallback(() => {
    const current = capture.current;
    capture.current = null;
    if (!current) return;
    if (activeDictation?.capture === current) activeDictation = null;
    current.controller?.abort();
    const recorder = current.recorder;
    if (recorder) {
      recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* Browser already stopped. */ }
    }
    releaseMicrophone(current);
    current.chunks = []; current.blob = undefined;
  }, []);
  const cancel = useCallback(() => { discard(); setPhase('idle'); }, [discard]);

  useEffect(() => {
    setSupported(Boolean(recordingAvailable()));
    let live = true;
    getVoiceStatus().then((status) => {
      if (live) setConfiguration(status.configured ? 'ready' : 'missing');
    }).catch(() => { if (live) setConfiguration('failed'); });
    return () => { live = false; };
  }, []);
  useEffect(() => { cancel(); }, [value, disabled, language, cancel]);
  useEffect(() => {
    const hidden = () => { if (document.hidden) cancel(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', cancel);
    return () => {
      discard();
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', cancel);
    };
  }, [discard, cancel]);

  const isCurrent = (current: Capture) => capture.current === current
    && !latest.current.disabled && latest.current.value === current.source && latest.current.language === current.language;

  async function upload(current: Capture) {
    if (!isCurrent(current) || current.controller) return;
    const audio = current.blob;
    if (!audio?.size || audio.size > MAX_AUDIO_BYTES) {
      cancel(); setError(t().dictation.emptyOrLarge); return;
    }
    current.controller = new AbortController();
    setPhase('transcribing');
    try {
      const text = (await transcribeAudio(audio, current.controller.signal, current.language)).trim();
      if (!isCurrent(current)) return;
      cancel();
      if (!text) { setError(t().dictation.noWords); return; }
      const remaining = Math.max(0, latest.current.maxLength);
      if (text.length > remaining) {
        setError(t().dictation.tooLong(text.length, remaining));
        return;
      }
      latest.current.onTranscript(text);
    } catch (reason) {
      if (!isCurrent(current)) return;
      cancel();
      setError(reason instanceof Error ? reason.message : t().dictation.unavailable);
    }
  }

  function finishRecording(current: Capture, uploadOnStop: boolean) {
    if (!isCurrent(current) || !current.recorder || current.recorder.state === 'inactive') return;
    current.uploadOnStop = uploadOnStop;
    if (current.timer) clearTimeout(current.timer);
    current.timer = undefined;
    setPhase('stopping');
    try { current.recorder.stop(); } catch {
      cancel(); setError(t().dictation.cannotComplete);
    }
  }

  async function start() {
    if (!recordingAvailable() || configuration !== 'ready' || latest.current.disabled || capture.current) return;
    activeDictation?.cancel();
    const current: Capture = { source: latest.current.value, language: latest.current.language, chunks: [], bytes: 0, uploadOnStop: false };
    capture.current = current;
    activeDictation = { capture: current, cancel };
    setPhase('requesting'); setError(null);
    try {
      latest.current.onRecordingStart?.();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isCurrent(current)) { stream.getTracks().forEach((track) => track.stop()); return; }
      current.stream = stream;
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined);
      current.recorder = recorder;
      recorder.ondataavailable = ({ data }) => {
        if (!isCurrent(current) || !data.size) return;
        current.bytes += data.size;
        if (current.bytes > MAX_AUDIO_BYTES) {
          cancel(); setError(t().dictation.tooLarge); return;
        }
        current.chunks.push(data);
      };
      recorder.onerror = () => {
        if (!isCurrent(current)) return;
        cancel(); setError(t().dictation.interrupted);
      };
      recorder.onstop = () => {
        releaseMicrophone(current);
        if (!isCurrent(current)) return;
        current.blob = new Blob(current.chunks, { type: recorder.mimeType || current.chunks[0]?.type || 'audio/webm' });
        current.chunks = [];
        if (!current.blob.size) { cancel(); setError(t().dictation.empty); return; }
        setPhase('ready');
        // The 30-second cutoff never uploads audio. Only the explicit transcription button does.
        if (current.uploadOnStop) void upload(current);
      };
      recorder.start(1000);
      setPhase('recording');
      current.timer = setTimeout(() => finishRecording(current, false), MAX_RECORDING_MS);
    } catch (reason) {
      if (!isCurrent(current)) return;
      cancel();
      setError(reason && typeof reason === 'object' && 'name' in reason && reason.name === 'NotAllowedError'
        ? t().dictation.micDenied
        : t().dictation.micUnavailable);
    }
  }

  function transcribe() {
    const current = capture.current;
    if (!current || !isCurrent(current)) return;
    if (current.blob) void upload(current);
    else finishRecording(current, true);
  }

  return { supported, configuration, phase, listening: phase === 'recording', error, start, transcribe, cancel, stop: cancel };
}
