import type { Lang } from '../../shared/lang.ts';
import { langHeaders, t } from '../i18n/index.ts';

export interface VoiceStatus {
  provider: 'elevenlabs'; configured: boolean; sttModel: string; ttsModel: string;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
  } catch { /* A gateway may return HTML; never show it as an app message. */ }
  return t().voice.serviceUnavailable;
}

let cachedStatus: { value: VoiceStatus; expires: number } | null = null;
let pendingStatus: Promise<VoiceStatus> | null = null;

/** Public provider availability only; the API key is never exposed to the browser. */
export async function getVoiceStatus(signal?: AbortSignal): Promise<VoiceStatus> {
  if (!signal && cachedStatus && cachedStatus.expires > Date.now()) return cachedStatus.value;
  if (!signal && pendingStatus) return pendingStatus;
  const fetchStatus = async () => {
    const response = await fetch('/api/voice/status', { signal, cache: 'no-store', headers: langHeaders() });
    if (!response.ok) throw new Error(await errorMessage(response));
    const status = await response.json() as VoiceStatus;
    if (status.provider !== 'elevenlabs' || typeof status.configured !== 'boolean') throw new Error(t().voice.invalidStatus);
    cachedStatus = { value: status, expires: Date.now() + 15_000 };
    return status;
  };
  if (signal) return fetchStatus();
  pendingStatus = fetchStatus();
  try { return await pendingStatus; } finally { pendingStatus = null; }
}

/** `language` è la lingua parlata attesa (quella dell'interfaccia), oppure 'auto' per farla riconoscere al servizio. */
export async function transcribeAudio(audio: Blob, signal?: AbortSignal, language: Lang | 'auto' = 'it'): Promise<string> {
  const type = audio.type.split(';')[0].trim();
  const extension = type === 'audio/mp4' ? 'm4a' : type === 'audio/ogg' ? 'ogg'
    : type === 'audio/wav' ? 'wav' : type === 'audio/mpeg' ? 'mp3' : 'webm';
  const body = new FormData();
  body.append('audio', audio, `dettatura.${extension}`);
  if (language !== 'it') body.append('language', language);
  const response = await fetch('/api/voice/transcribe', { method: 'POST', body, signal, cache: 'no-store', headers: langHeaders() });
  if (!response.ok) throw new Error(await errorMessage(response));
  const result = await response.json() as { text?: unknown; provider?: unknown };
  if (result.provider !== 'elevenlabs' || typeof result.text !== 'string') throw new Error(t().voice.invalidTranscript);
  return result.text;
}

export async function requestVoiceAudio(text: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch('/api/voice/speak', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...langHeaders() }, body: JSON.stringify({ text }), signal, cache: 'no-store',
  });
  if (!response.ok) throw new Error(await errorMessage(response));
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('audio/')) throw new Error(t().voice.invalidAudio);
  return response.blob();
}
