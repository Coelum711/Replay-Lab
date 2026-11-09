import type { ImportContext, ReplayImporter } from './types.js';

const GENERIC_TEXT_EXTENSIONS = new Set(['txt', 'log', 'md']);
/** Below this a format guess is noise; callers report the file as unrecognized instead of importing garbage. */
const MIN_SNIFF_SCORE = 0.3;

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
    // A specific extension (.rgl/.json/.html) decides the format family; generic text extensions only add a bonus.
    const claimed = ext && !GENERIC_TEXT_EXTENSIONS.has(ext) ? this.all().filter(importer => importer.extensions.includes(`.${ext}`)) : [];
    return (claimed.length ? claimed : this.all())
      .map(importer => {
        const raw = importer.sniff(input, context);
        const extensionBonus = ext && importer.extensions.includes(`.${ext}`) ? 0.2 : 0;
        return { importer, raw, score: raw + extensionBonus };
      })
      .filter(item => item.raw >= MIN_SNIFF_SCORE)
      .sort((a, b) => b.score - a.score)[0]?.importer;
  }
}
