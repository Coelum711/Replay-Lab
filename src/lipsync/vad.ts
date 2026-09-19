import type { MouthCue } from '../core/types.js';

export interface VadOptions {
  thresholdLevel?: number;
  visualLeadMs?: number;
}

const THRESHOLD_MULTIPLIERS: Record<number, number> = {1:.03,2:.045,3:.06,4:.07,5:.08,6:.095,7:.11,8:.13,9:.16};

export function rmsVadToMouthCues(samples: Float32Array, sampleRate: number, options: VadOptions = {}): MouthCue[] {
  const windowSize = Math.floor(sampleRate * 0.02);
  const hopSize = Math.floor(sampleRate * 0.01);
  if (windowSize < 1 || hopSize < 1 || samples.length < windowSize) return [];

  const energies: number[] = [];
  for (let i = 0; i <= samples.length - windowSize; i += hopSize) {
    let sum = 0;
    for (let j = 0; j < windowSize; j += 1) sum += samples[i + j]! ** 2;
    energies.push(Math.sqrt(sum / windowSize));
  }

  const nonZero = energies.filter(x => x > 0).sort((a,b) => a-b);
  const globalMax = nonZero.at(-1) ?? 1;
  const globalMedian = nonZero[Math.floor(nonZero.length * 0.5)] ?? 0;
  const multiplier = THRESHOLD_MULTIPLIERS[options.thresholdLevel ?? 5] ?? .08;
  const hardFloor = globalMax * .003;
  const globalThreshold = Math.max(globalMedian * multiplier, globalMax * .005);
  const localWindow = Math.floor(1.5 / .01);

  const voiced = energies.map((energy, index) => {
    if (energy < hardFloor) return false;
    const from = Math.max(0, index - localWindow);
    const to = Math.min(energies.length - 1, index + localWindow);
    let localMax = 0;
    for (let k = from; k <= to; k += 1) localMax = Math.max(localMax, energies[k]!);
    return energy > Math.min(localMax * multiplier, globalThreshold);
  });

  const smooth = [...voiced];
  for (let i = 2; i < voiced.length - 2; i += 1) {
    const count = Number(voiced[i-2]) + Number(voiced[i-1]) + Number(voiced[i]) + Number(voiced[i+1]) + Number(voiced[i+2]);
    smooth[i] = count >= 3;
  }

  const regions: Array<{start:number;end:number;voiced:boolean}> = [];
  let current = smooth[0] ?? false;
  let startIndex = 0;
  for (let i = 1; i < smooth.length; i += 1) {
    if (smooth[i] !== current) {
      regions.push({ start: startIndex * .01, end: i * .01, voiced: current });
      startIndex = i; current = smooth[i]!;
    }
  }
  regions.push({ start: startIndex * .01, end: samples.length / sampleRate, voiced: current });

  const lead = Math.max(0, options.visualLeadMs ?? 66) / 1000;
  return regions
    .filter(region => region.voiced && region.end - region.start >= .04)
    .map(region => ({ start: Math.max(0, region.start - lead), end: Math.max(0, region.end - lead), viseme: 'OPEN' as const }));
}
