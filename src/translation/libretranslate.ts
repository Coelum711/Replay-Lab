import type { TranslationProvider, TranslationRequest, TranslationResult } from './types.js';

export interface LibreTranslateOptions {
  endpoint?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Thin adapter for a LibreTranslate-compatible server.
 * No public endpoint or API key is hard-coded: callers may use a self-hosted
 * instance or any compatible service they are permitted to access.
 */
export class LibreTranslateProvider implements TranslationProvider {
  readonly id = 'libretranslate';
  readonly label = 'LibreTranslate';
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LibreTranslateOptions = {}) {
    this.endpoint = (options.endpoint ?? 'http://localhost:5000').replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    request.signal?.throwIfAborted();
    const body: Record<string, string> = {
      q: request.text,
      source: normalizeLanguage(request.sourceLanguage ?? 'auto'),
      target: normalizeLanguage(request.targetLanguage),
      format: 'text'
    };
    if (this.apiKey) body.api_key = this.apiKey;

    const response = await this.fetchImpl(`${this.endpoint}/translate`, {
      signal: request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000),
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`LibreTranslate ${response.status}: ${await response.text()}`);
    const json = await response.json() as { translatedText?: string; detectedLanguage?: { language?: string } | string };
    if (typeof json.translatedText !== 'string') throw new Error('LibreTranslate response did not contain translatedText');
    const detected = typeof json.detectedLanguage === 'string' ? json.detectedLanguage : json.detectedLanguage?.language;
    return { text: json.translatedText, detectedSourceLanguage: detected };
  }
}

function normalizeLanguage(language: string): string {
  if (!language || language === 'auto') return 'auto';
  return language.toLowerCase().split('-')[0]!;
}
