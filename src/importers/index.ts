export * from './types.js';
export * from './registry.js';
export * from './text.js';
export * from './ccfolia.js';
export * from './rplgen.js';
export * from './rplgen-mediadef.js';
export * from './json.js';
export * from './folder.js';

import { ImporterRegistry } from './registry.js';
import { TextImporter } from './text.js';
import { StoryScriptImporter } from './story-script.js';
import { CocofoliaImporter } from './ccfolia.js';
import { RplGenImporter } from './rplgen.js';
import { GenericJsonImporter } from './json.js';

export function createDefaultImporterRegistry(): ImporterRegistry {
  return new ImporterRegistry()
    .register(RplGenImporter)
    .register(CocofoliaImporter)
    .register(GenericJsonImporter)
    .register(StoryScriptImporter)
    .register(TextImporter);
}
export * from './story-script.js';
export * from './wheel-history.js';
