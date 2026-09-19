import type { TranslationProvider } from './types.js';

export class TranslationRegistry {
  private readonly providers = new Map<string, TranslationProvider>();
  register(provider: TranslationProvider): this { this.providers.set(provider.id, provider); return this; }
  get(id: string): TranslationProvider | undefined { return this.providers.get(id); }
  all(): TranslationProvider[] { return [...this.providers.values()]; }
}
