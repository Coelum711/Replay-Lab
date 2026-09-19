import type { TtsProvider } from './types.js';
import { ReplayLabFreeTtsProvider, type ReplayLabFreeTtsOptions } from './kokoro.js';

export class TtsRegistry {
  private readonly providers = new Map<string, TtsProvider>();
  register(provider: TtsProvider): this { this.providers.set(provider.id, provider); return this; }
  get(id: string): TtsProvider | undefined { return this.providers.get(id); }
  has(id: string): boolean { return this.providers.has(id); }
  all(): TtsProvider[] { return [...this.providers.values()]; }
}

export function createDefaultTtsRegistry(options: { replayLabFree?: ReplayLabFreeTtsOptions } = {}): TtsRegistry {
  return new TtsRegistry().register(new ReplayLabFreeTtsProvider(options.replayLabFree));
}
