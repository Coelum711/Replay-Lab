import type { AccentTranslationHint } from '../pronunciation/types.js';

export interface TranslationRequest {
  signal?: AbortSignal;
  text: string;
  sourceLanguage?: string;
  targetLanguage: string;
  /** Optional regional-language style intent; literal translation providers may ignore it. */
  accent?: AccentTranslationHint;
}

export interface TranslationResult {
  text: string;
  detectedSourceLanguage?: string;
  providerMetadata?: Record<string, unknown>;
}

export interface TranslationProvider {
  id: string;
  label: string;
  translate(request: TranslationRequest): Promise<TranslationResult>;
}
