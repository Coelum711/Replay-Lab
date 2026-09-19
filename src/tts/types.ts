import type { TimedPhoneme } from '../lipsync/types.js';
import type { AccentSynthesisHint } from '../pronunciation/types.js';
import type { PunctuationPauseTiming } from '../core/types.js';

export interface TtsRequest {
  text: string;
  voiceId?: string;
  rate?: number;
  pitch?: number;
  language?: string;
  /** Accent intent. Providers may ignore it, use it to rank voices, or translate it to native controls. */
  accent?: AccentSynthesisHint;
  /** Replay Lab pause multiplier. Providers may ignore it; '/' in text is the manual pause marker. */
  pauseScale?: number;
  /** Exact per-punctuation timing authored in Replay Lab. Providers may ignore it. */
  punctuationPauses?: PunctuationPauseTiming;
}

export interface TtsResult {
  audio: Blob | ArrayBuffer | Uint8Array;
  mime: string;
  duration?: number;
  phonemes?: TimedPhoneme[];
  /** Untimed phoneme string when a provider exposes G2P but not alignment. */
  phonemeSequence?: string;
  words?: Array<{ start: number; end: number; text: string }>;
}

export type TtsCostModel = 'free-local' | 'user-supplied' | 'metered';

export interface TtsProviderCapabilities {
  costModel?: TtsCostModel;
  local?: boolean;
  exportableAudio?: boolean;
  listVoices?: boolean;
  phonemeTiming?: boolean;
  wordTiming?: boolean;
  ssml?: boolean;
  /** Languages/locales the provider can currently synthesize without another plugin. */
  supportedLanguages?: string[];
}

export interface TtsVoiceInfo {
  id: string;
  label: string;
  languages?: string[];
  gender?: string;
  tags?: string[];
  quality?: string;
  metadata?: Record<string, unknown>;
}

export interface TtsProvider {
  id: string;
  label: string;
  capabilities?: TtsProviderCapabilities;
  listVoices?(language?: string): Promise<TtsVoiceInfo[]>;
  synthesize(request: TtsRequest): Promise<TtsResult>;
}
