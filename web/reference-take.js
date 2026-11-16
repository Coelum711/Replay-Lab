/**
 * Re-record a line from one of its own takes: the take (with the intonation curve already applied)
 * becomes a temporary Voicebox profile, ordinary cloning voices the line again in that delivery,
 * and the profile is removed afterwards so Voicebox does not fill up with one-off voices.
 */
import { decodeRecording, fineTuneRecording } from './prosody-audio.js';

/** Voicebox samples are 24 kHz mono PCM WAV; long references made a voice stop early, so keep 30 s at most. */
export async function toReferenceWav(file, minSeconds = 3) {
  const context = new AudioContext({ sampleRate: 24000 });
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration < minSeconds) throw new Error(`录音太短，至少需要 ${minSeconds} 秒。`);
    const frames = Math.min(decoded.length, 30 * 24000), pcm = new Int16Array(frames);
    for (let i = 0; i < frames; i += 1) {
      let mixed = 0;
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) mixed += decoded.getChannelData(channel)[i];
      pcm[i] = Math.max(-1, Math.min(1, mixed / decoded.numberOfChannels)) * 32767;
    }
    const buffer = new ArrayBuffer(44 + pcm.byteLength), view = new DataView(buffer);
    const text = (at, value) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 36 + pcm.byteLength, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, pcm.byteLength, true);
    new Int16Array(buffer, 44).set(pcm);
    return new File([buffer], 'reference.wav', { type: 'audio/wav' });
  } finally { void context.close(); }
}

const PROFILE_LANGUAGES = new Set(['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it']);
/** Voicebox profiles take a bare language code; anything it does not know falls back to Japanese like the other helpers. */
export function profileLanguage(language) {
  const base = String(language || '').toLowerCase().split(/[-_]/)[0];
  return PROFILE_LANGUAGES.has(base) ? base : 'ja';
}

/**
 * The audio to imitate: the take as it is when the curve is flat (or the take already carries the curve),
 * otherwise the take with the curve bent in locally first.
 */
export async function referenceAudio(blob, curve, { curveApplied = false, flat = true, decode = decodeRecording, fineTune = fineTuneRecording, signal } = {}) {
  if (!blob) throw new Error('当前版本的音频读取失败');
  if (flat || curveApplied) return blob;
  const decoded = await decode(blob);
  return fineTune(blob, decoded, curve, { signal });
}

/**
 * Makes a hidden Voicebox profile from `audio`, runs `use(voiceId)`, then deletes the profile again.
 * A failed delete does not fail the take; it is reported through `onLeftover` so the author can tidy up by hand.
 */
export async function withTemporaryReference({ audio, text, name, language, baseUrl, fetchImpl, signal, onLeftover = () => {}, toWav = toReferenceWav }, use) {
  const json = async (path, options) => {
    const response = await fetchImpl(`${baseUrl}${path}`, { ...options, signal });
    if (!response.ok) throw new Error(`Voicebox 返回 HTTP ${response.status}`);
    return response.json();
  };
  const wav = await toWav(audio, 1);
  const profile = await json('/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, language: profileLanguage(language), description: 'Replay Lab 临时参考，用完会自动删除' }) });
  try {
    const sample = new FormData();
    sample.append('file', wav); sample.append('reference_text', text || '');
    await json(`/profiles/${encodeURIComponent(profile.id)}/samples`, { method: 'POST', body: sample });
    return await use(profile.id);
  } finally {
    try {
      const response = await fetchImpl(`${baseUrl}/profiles/${encodeURIComponent(profile.id)}`, { method: 'DELETE' });
      if (!response.ok) onLeftover(name);
    } catch { onLeftover(name); }
  }
}
