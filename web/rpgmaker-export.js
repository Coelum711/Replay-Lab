/**
 * Export chosen voice takes as Ogg Vorbis, the only format RPG Maker MZ's vorbisdecoder plays,
 * with names that are easy to pick out in the "Play SE" list.
 */
import { createOggEncoder } from './vendor/wasm-media-encoders/index.js';

/** `伊万_第20行_你听过潜鸟吗.ogg`: speaker, row and the first few words, safe on every OS. */
export function rpgMakerFileName(speaker, lineNumber, text, words = 8) {
  const clean = value => String(value ?? '').replace(/\{\/?[^{}\s]{0,12}\}/g, '').replace(/[\\/:*?"<>|\u0000-\u001f\s。，、！？!?,.…～~「」『』（）()【】\[\]]+/g, '');
  const snippet = Array.from(clean(text)).slice(0, words).join('');
  return `${clean(speaker) || '台词'}_第${lineNumber}行${snippet ? `_${snippet}` : ''}.ogg`;
}

/** Mono-or-stereo PCM → Ogg Vorbis bytes. Chunks are copied because the encoder reuses its buffer. */
export async function encodeOggVorbis(channels, sampleRate, { quality = 5 } = {}) {
  const encoder = await createOggEncoder();
  encoder.configure({ channels: channels.length, sampleRate, vbrQuality: quality });
  const parts = [];
  const step = 4096;
  for (let at = 0; at < channels[0].length; at += step) parts.push(encoder.encode(channels.map(channel => channel.subarray(at, at + step))).slice());
  parts.push(encoder.finalize().slice());
  const total = parts.reduce((sum, part) => sum + part.length, 0), out = new Uint8Array(total);
  let cursor = 0; for (const part of parts) { out.set(part, cursor); cursor += part.length; }
  return out;
}

async function decodeToPcm(blob) {
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: Math.min(2, audio.numberOfChannels) }, (_, i) => audio.getChannelData(i).slice());
    return { channels, sampleRate: audio.sampleRate, duration: audio.duration };
  } finally { void context.close(); }
}

/**
 * Encodes each line's current take and hands the files to the desktop folder export
 * (or downloads them in a plain browser). Returns what was written and what was skipped.
 */
export async function exportLinesForRpgMaker({ project, lines, resolveAsset, onProgress }) {
  const files = [], skipped = [];
  let index = 0;
  for (const line of lines) {
    index += 1;
    const number = project.lines.indexOf(line) + 1;
    if (!line.audioAssetId) { skipped.push(`第 ${number} 行没有配音`); continue; }
    onProgress?.(`正在转换 ${index} / ${lines.length}`);
    const source = await resolveAsset(line.audioAssetId);
    const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
    if (!blob) { skipped.push(`第 ${number} 行的音频读取失败`); continue; }
    const pcm = await decodeToPcm(blob);
    const data = await encodeOggVorbis(pcm.channels, pcm.sampleRate);
    const speaker = project.characters.find(character => character.id === line.speakerId)?.name;
    files.push({ name: rpgMakerFileName(speaker, number, line.text), data });
  }
  if (!files.length) return { written: [], skipped, directory: null };
  const desktop = globalThis.replayDesktop;
  if (desktop?.exportToFolder) {
    const result = await desktop.exportToFolder({ title: '选择 RPG Maker 工程的 audio/se 文件夹', files });
    if (!result) return { written: [], skipped, directory: null, cancelled: true };
    return { ...result, skipped };
  }
  for (const file of files) {
    const url = URL.createObjectURL(new Blob([file.data], { type: 'audio/ogg' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: file.name });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return { written: files.map(file => file.name), skipped, directory: null };
}
