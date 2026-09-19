import type { ImportContext, ReplayImporter } from './types.js';

export class ImporterRegistry {
  private readonly importers = new Map<string, ReplayImporter>();

  register(importer: ReplayImporter): this {
    this.importers.set(importer.id, importer);
    return this;
  }

  get(id: string): ReplayImporter | undefined {
    return this.importers.get(id);
  }

  all(): ReplayImporter[] {
    return [...this.importers.values()];
  }

  choose(input: string, context: ImportContext = {}): ReplayImporter | undefined {
    const ext = context.sourceName?.toLowerCase().split('.').pop();
    return this.all()
      .map(importer => {
        const extensionBonus = ext && importer.extensions.includes(`.${ext}`) ? 0.2 : 0;
        return { importer, score: importer.sniff(input, context) + extensionBonus };
      })
      .sort((a, b) => b.score - a.score)[0]?.importer;
  }
}
