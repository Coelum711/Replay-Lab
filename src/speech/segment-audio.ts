/**
 * Pure PCM helpers for segmented performances: each segment is synthesized on its own, trimmed,
 * time-stretched without changing pitch (WSOLA), then joined with short crossfades and pauses.
 */

export interface MonoPcm { sampleRate: number; samples: Float32Array; }

const toBytes = (audio: ArrayBuffer | Uint8Array): Uint8Array => audio instanceof Uint8Array ? audio : new Uint8Array(audio);

/** Reads PCM16/24/32 or float32 WAV and mixes it down to mono. */
export function decodeWav(audio: ArrayBuffer | Uint8Array): MonoPcm {
  const bytes = toBytes(audio);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
  if (bytes.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('分段配音需要 WAV 音频，但生成结果不是 WAV。');
  let at = 12, format = 0, channels = 0, sampleRate = 0, bits = 0, dataAt = -1, dataSize = 0;
  while (at + 8 <= bytes.byteLength) {
    const id = tag(at), size = view.getUint32(at + 4, true);
    if (id === 'fmt ') { format = view.getUint16(at + 8, true); channels = view.getUint16(at + 10, true); sampleRate = view.getUint32(at + 12, true); bits = view.getUint16(at + 22, true); if (format === 0xfffe) format = view.getUint16(at + 32, true); }
    if (id === 'data') { dataAt = at + 8; dataSize = Math.min(size, bytes.byteLength - dataAt); break; }
    at += 8 + size + (size % 2);
  }
  if (dataAt < 0 || !channels || !sampleRate) throw new Error('WAV 文件缺少音频数据。');
  const width = bits / 8, frames = Math.floor(dataSize / (width * channels));
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const p = dataAt + (i * channels + c) * width;
      if (format === 3 && bits === 32) sum += view.getFloat32(p, true);
      else if (bits === 16) sum += view.getInt16(p, true) / 32768;
      else if (bits === 24) { const v = bytes[p]! | (bytes[p + 1]! << 8) | (bytes[p + 2]! << 16); sum += ((v << 8) >> 8) / 8388608; }
      else if (bits === 32) sum += view.getInt32(p, true) / 2147483648;
      else if (bits === 8) sum += (bytes[p]! - 128) / 128;
      else throw new Error(`不支持 ${bits} 位 WAV。`);
    }
    samples[i] = sum / channels;
  }
  return { sampleRate, samples };
}

export function encodeWav({ sampleRate, samples }: MonoPcm): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer), bytes = new Uint8Array(buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i); };
  text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const x = Math.max(-1, Math.min(1, samples[i]!)); view.setInt16(44 + i * 2, Math.round(x * (x < 0 ? 32768 : 32767)), true); }
  return bytes;
}

/** Drops leading/trailing near-silence but keeps a small natural margin. */
export function trimSilence(pcm: MonoPcm, margin = 0.04): MonoPcm {
  const { samples, sampleRate } = pcm, window = Math.max(1, Math.round(sampleRate * 0.01));
  let peak = 0; for (const value of samples) peak = Math.max(peak, Math.abs(value));
  const threshold = Math.max(0.004, peak * 0.03);
  const loud = (from: number) => { let energy = 0; const to = Math.min(samples.length, from + window); for (let i = from; i < to; i++) energy = Math.max(energy, Math.abs(samples[i]!)); return energy > threshold; };
  let start = 0; while (start < samples.length && !loud(start)) start += window;
  let end = samples.length; while (end > start && !loud(Math.max(start, end - window))) end -= window;
  if (end <= start) return { sampleRate, samples: new Float32Array(0) };
  const pad = Math.round(sampleRate * margin);
  return { sampleRate, samples: samples.slice(Math.max(0, start - pad), Math.min(samples.length, end + pad)) };
}

/**
 * WSOLA time-stretch: speed > 1 is faster/shorter, pitch is unchanged.
 * Each output frame copies the input frame that best continues the previous one.
 */
export function timeStretch(pcm: MonoPcm, speed: number): MonoPcm {
  const rate = Math.max(0.5, Math.min(2, Number(speed) || 1));
  if (Math.abs(rate - 1) < 0.01 || pcm.samples.length < 4) return { sampleRate: pcm.sampleRate, samples: pcm.samples.slice() };
  const input = pcm.samples, sr = pcm.sampleRate;
  const frame = Math.round(sr * 0.04), synthesisHop = Math.round(frame / 2), analysisHop = synthesisHop * rate, tolerance = Math.round(sr * 0.012);
  const window = new Float32Array(frame);
  for (let i = 0; i < frame; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);
  const outLength = Math.ceil(input.length / rate) + frame;
  const output = new Float32Array(outLength), weight = new Float32Array(outLength);
  const at = (i: number) => (i >= 0 && i < input.length ? input[i]! : 0);
  let previous = 0; // input position whose natural continuation we try to match
  for (let k = 0, outPos = 0; outPos < outLength - frame; k++, outPos += synthesisHop) {
    const nominal = Math.round(k * analysisHop);
    if (nominal >= input.length) break;
    let best = nominal;
    if (k > 0) {
      const natural = previous + synthesisHop;
      let bestScore = -Infinity;
      for (let delta = -tolerance; delta <= tolerance; delta += 2) {
        const candidate = nominal + delta;
        if (candidate < 0) continue;
        let score = 0;
        for (let i = 0; i < synthesisHop; i += 4) score += at(natural + i) * at(candidate + i);
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
    }
    for (let i = 0; i < frame; i++) { output[outPos + i]! += at(best + i) * window[i]!; weight[outPos + i]! += window[i]!; }
    previous = best;
  }
  const length = Math.min(outLength, Math.round(input.length / rate));
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) samples[i] = weight[i]! > 1e-3 ? output[i]! / weight[i]! : 0;
  return { sampleRate: sr, samples };
}

/** Joins segments with a short crossfade (or a silent pause) between them. */
export function joinSegments(parts: Array<{ pcm: MonoPcm; pauseAfter?: number }>, crossfade = 0.015): MonoPcm {
  if (!parts.length) throw new Error('没有可拼接的分段。');
  const sampleRate = parts[0]!.pcm.sampleRate;
  if (parts.some(part => part.pcm.sampleRate !== sampleRate)) throw new Error('分段音频的采样率不一致，无法拼接。');
  const fade = Math.round(sampleRate * crossfade);
  const chunks: Float32Array[] = [];
  parts.forEach((part, index) => {
    const samples = part.pcm.samples.slice();
    const edge = Math.min(fade, Math.floor(samples.length / 2));
    for (let i = 0; i < edge; i++) { const g = i / edge; if (index > 0) samples[i]! *= g; if (index < parts.length - 1) samples[samples.length - 1 - i]! *= g; }
    chunks.push(samples);
    const pause = Math.max(0, Math.min(5, Number(part.pauseAfter) || 0));
    if (index < parts.length - 1 && pause > 0) chunks.push(new Float32Array(Math.round(sampleRate * pause)));
  });
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0), samples = new Float32Array(total);
  let cursor = 0; for (const chunk of chunks) { samples.set(chunk, cursor); cursor += chunk.length; }
  return { sampleRate, samples };
}
