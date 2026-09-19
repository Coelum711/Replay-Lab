import type { AccentSelection, AccentStrength } from '../core/types.js';

export type AccentRuleCategory = 'pronunciation' | 'prosody' | 'vocabulary';
export type AccentSupportLevel = 'native' | 'approximate' | 'locale-fallback' | 'unknown';

export interface AccentRegion {
  country?: string;
  region?: string;
  city?: string;
}

export interface AccentRule {
  id: string;
  category: AccentRuleCategory;
  label: string;
  description: string;
  /** Human-facing examples only. They are not deterministic rewrite rules. */
  examples?: string[];
  defaultEnabled?: boolean;
  /** Optional machine-readable hint for future G2P/prosody engines. */
  machine?: {
    kind: 'phoneme-rewrite' | 'lexical-set' | 'prosody-hint' | 'lexical-choice';
    input?: string;
    output?: string;
    environment?: string;
    value?: string | number | boolean;
  };
}

export interface AccentProfile {
  id: string;
  language: string;
  localeFallback: string;
  label: string;
  shortLabel?: string;
  aliases: string[];
  tags: string[];
  region?: AccentRegion;
  summary: string;
  /** Reminder shown in advanced UI; accent profiles describe tendencies, not every speaker. */
  variabilityNote?: string;
  rules: AccentRule[];
}

export interface AccentSearchResult {
  profile: AccentProfile;
  score: number;
  matchedBy: string[];
}

export interface ResolvedAccent {
  selection: AccentSelection;
  profile?: AccentProfile;
  language: string;
  strength: AccentStrength;
  localeFallback?: string;
}

export interface AccentSynthesisHint {
  id?: string;
  label?: string;
  query?: string;
  strength?: AccentStrength;
  localeFallback?: string;
  tags?: string[];
  pronunciationHints?: string[];
  prosodyHints?: string[];
}

export interface AccentTranslationHint {
  id?: string;
  label?: string;
  useRegionalVocabulary: boolean;
  vocabularyHints: string[];
}

export interface VoiceAccentCapability {
  voiceId: string;
  languages: string[];
  accentIds?: string[];
  accentTags?: string[];
  locales?: string[];
}

export interface AccentVoiceMatch {
  voiceId: string;
  support: AccentSupportLevel;
  reason: string;
}
