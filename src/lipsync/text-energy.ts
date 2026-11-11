/*
 * Text + audio energy → mouth timeline.
 *
 * Port of the user's Lip Studio (对口型1.0.html):
 *   analyzeAudio      → analyzeVoicedRegions (20 ms window, 10 ms hop RMS,
 *                       threshold = max(median × sensitivity, max × 0.005),
 *                       5-frame majority smoothing)
 *   generateTimeline  → distributeSyllables (syllables are spread over voiced
 *                       regions in proportion to region length; the last
 *                       region takes every remaining syllable)
 * Differences from the HTML tool, all to keep syllables on voiced audio:
 *   - voiced blips shorter than 60 ms do not take syllables;
 *   - an early region never takes so many syllables that a later region
 *     is left with none (when there are enough syllables to go round);
 *   - b/p/m and f/v get a short consonant shape at the start of the slot, and
 *     two identical vowels in a row get a brief gap so the mouth visibly beats.
 */
import type { MouthCue, Viseme } from '../core/types.js';
import { collapseMouthCues } from './viseme.js';
import { textToMouthSyllables, type MouthSyllable } from './syllables.js';

/** Lip Studio's 「人声灵敏度」 slider (1–10, default 5). */
export const LIP_STUDIO_THRESHOLD_MULTIPLIERS: Record<number, number> = {
  1: 0.01, 2: 0.02, 3: 0.04, 4: 0.06, 5: 0.08, 6: 0.12, 7: 0.18, 8: 0.25, 9: 0.35, 10: 0.50
};

export interface VoicedRegion { start: number; end: number; voiced: boolean; }

export function analyzeVoicedRegions(samples: Float32Array, sampleRate: number, sensitivity = 5): VoicedRegion[] {
  const duration = samples.length / sampleRate;
  const windowSize = Math.floor(sampleRate * 0.02);
  const hopSize = Math.floor(sampleRate * 0.01);
  if (windowSize < 1 || hopSize < 1 || samples.length <= windowSize) return duration > 0 ? [{ start: 0, end: duration, voiced: false }] : [];
  const energies: number[] = [];
  for (let i = 0; i < samples.length - windowSize; i += hopSize) {
    let sum = 0;
    for (let j = 0; j < windowSize; j += 1) sum += samples[i + j]! ** 2;
    energies.push(Math.sqrt(sum / windowSize));
  }
  const nonZero = energies.filter(e => e > 0).sort((a, b) => a - b);
  const median = nonZero[Math.floor(nonZero.length * 0.5)] ?? 0;
  const max = nonZero.at(-1) ?? 1;
  const multiplier = LIP_STUDIO_THRESHOLD_MULTIPLIERS[Math.round(sensitivity)] ?? 0.08;
  const threshold = Math.max(median * multiplier, max * 0.005);
  const voiced = energies.map(e => e > threshold);
  const smoothed = voiced.slice();
  for (let i = 2; i < voiced.length - 2; i += 1) {
    const count = Number(voiced[i - 2]) + Number(voiced[i - 1]) + Number(voiced[i]) + Number(voiced[i + 1]) + Number(voiced[i + 2]);
    smoothed[i] = count >= 3;
  }
  const regions: VoicedRegion[] = [];
  let regionStart = 0;
  let current = smoothed[0] ?? false;
  for (let i = 1; i < smoothed.length; i += 1) {
    if (smoothed[i] !== current) {
      regions.push({ start: regionStart * 0.01, end: i * 0.01, voiced: current });
      regionStart = i;
      current = smoothed[i]!;
    }
  }
  regions.push({ start: regionStart * 0.01, end: duration, voiced: current });
  for (const region of regions) { region.end = Math.min(region.end, duration); region.start = Math.min(region.start, duration); }
  return regions.filter(region => region.end > region.start);
}

export interface DistributeOptions {
  /** Voiced regions shorter than this take no syllables. Default 0.06 s. */
  minRegionSeconds?: number;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function distributeSyllables(syllables: MouthSyllable[], regions: VoicedRegion[], options: DistributeOptions = {}): MouthCue[] {
  const minRegion = options.minRegionSeconds ?? 0.06;
  let voicedRegions = regions.filter(r => r.voiced && r.end - r.start >= minRegion);
  if (!voicedRegions.length) voicedRegions = regions.filter(r => r.voiced);
  if (!syllables.length || !voicedRegions.length) return [];
  const totalVoiced = voicedRegions.reduce((sum, r) => sum + (r.end - r.start), 0);
  const perSyllable = totalVoiced / syllables.length;
  const slots: Array<{ start: number; end: number; syllable: MouthSyllable; region: number }> = [];
  let index = 0;
  voicedRegions.forEach((region, ri) => {
    const remaining = syllables.length - index;
    if (remaining <= 0) return;
    const regionsAfter = voicedRegions.length - ri - 1;
    let count: number;
    if (!regionsAfter) count = remaining;
    else {
      count = Math.max(1, Math.round((region.end - region.start) / perSyllable));
      if (remaining > regionsAfter) count = Math.min(count, remaining - regionsAfter);
      count = Math.min(count, remaining);
    }
    const slot = (region.end - region.start) / count;
    for (let i = 0; i < count; i += 1, index += 1) {
      const start = region.start + i * slot;
      slots.push({ start, end: Math.min(start + slot, region.end), syllable: syllables[index]!, region: ri });
    }
  });
  const cues: MouthCue[] = [];
  slots.forEach((slot, i) => {
    const { vowel, onset, text } = slot.syllable;
    if (!vowel) return;
    let start = slot.start, end = slot.end;
    const duration = end - start;
    if (onset && duration >= 0.08) {
      const onsetEnd = start + Math.min(0.06, duration * 0.3);
      cues.push({ start: round(start), end: round(onsetEnd), viseme: onset, phoneme: text });
      start = onsetEnd;
    }
    const next = slots[i + 1];
    if (next && next.region === slot.region && next.syllable.vowel === vowel && !next.syllable.onset) end -= Math.min(duration * 0.35, Math.max(0.025, duration * 0.2), 0.05);
    if (end > start) cues.push({ start: round(start), end: round(end), viseme: vowel as Viseme, phoneme: text });
  });
  return collapseMouthCues(cues);
}

export interface TextEnergyOptions extends DistributeOptions {
  language?: string;
  /** Lip Studio 「人声灵敏度」 1–10. Default 5. */
  sensitivity?: number;
}

/**
 * Builds raw (un-led) mouth cues from the spoken text and its audio.
 * Times are relative to the start of the audio, like TTS phoneme timing.
 */
export function alignTextToEnergy(text: string, pcm: { samples: Float32Array; sampleRate: number }, options: TextEnergyOptions = {}): MouthCue[] {
  const syllables = textToMouthSyllables(text, options.language);
  if (!syllables.length) return [];
  return distributeSyllables(syllables, analyzeVoicedRegions(pcm.samples, pcm.sampleRate, options.sensitivity ?? 5), options);
}
