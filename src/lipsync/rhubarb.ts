import type { MouthCue, Viseme } from '../core/types.js';

const RHUBARB_TO_VISEME: Record<string, Viseme> = {
  X: 'CLOSED', A: 'CLOSED', B: 'OPEN', C: 'E', D: 'A', E: 'O', F: 'U', G: 'I', H: 'OPEN'
};

export function parseRhubarbJson(input: string, visualLeadMs = 66): MouthCue[] {
  const data = JSON.parse(input) as { mouthCues?: Array<{ start: number; end: number; value: string }> };
  const lead = Math.max(0, visualLeadMs) / 1000;
  return (data.mouthCues ?? [])
    .map(cue => ({
      start: Math.max(0, Number(cue.start) - lead),
      end: Math.max(0, Number(cue.end) - lead),
      viseme: RHUBARB_TO_VISEME[String(cue.value).toUpperCase()] ?? 'OPEN'
    }))
    .filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start);
}
