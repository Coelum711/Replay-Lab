import type { ReplayProject, PerformanceDocument } from '../core/types.js';
import type { ReplayImporter } from '../importers/types.js';
import type { TtsProvider } from '../tts/types.js';

export interface ReplayRenderer {
  id: string;
  label: string;
  render(performance: PerformanceDocument): Promise<Blob | ArrayBuffer | Uint8Array>;
}

export interface ReplayExporter {
  id: string;
  label: string;
  export(project: ReplayProject): Promise<string | Blob | ArrayBuffer | Uint8Array> | string | Blob | ArrayBuffer | Uint8Array;
}

export interface ReplayPlugin {
  id: string;
  label: string;
  importers?: ReplayImporter[];
  ttsProviders?: TtsProvider[];
  renderers?: ReplayRenderer[];
  exporters?: ReplayExporter[];
}
