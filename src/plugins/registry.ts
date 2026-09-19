import type { ReplayPlugin } from './types-internal.js';

export class PluginRegistry {
  private readonly plugins = new Map<string, ReplayPlugin>();
  register(plugin: ReplayPlugin): this { this.plugins.set(plugin.id, plugin); return this; }
  get(id: string): ReplayPlugin | undefined { return this.plugins.get(id); }
  all(): ReplayPlugin[] { return [...this.plugins.values()]; }
}
