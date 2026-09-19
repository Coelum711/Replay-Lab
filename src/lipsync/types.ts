import type { MouthCue, Viseme } from '../core/types.js';

export interface TimedPhoneme {
  start: number;
  end: number;
  phoneme: string;
}

export interface VisemeOptions {
  visualLeadMs?: number;
  /** Optional BCP-47 language. en-* uses the old LipSync Studio ARPABET rules; other explicit languages use the universal articulatory fallback before A/I/U/E/O. */
  language?: string;
  consonants?: 'open-closed' | 'closed' | 'open';
}

export type { MouthCue, Viseme };
