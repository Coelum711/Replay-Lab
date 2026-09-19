import type { PerformanceDocument } from '../core/types.js';

export interface AssetResolver {
  resolve(source: string): string | undefined;
}

export interface Renderer<TOutput = Blob | ArrayBuffer | Uint8Array> {
  id: string;
  label: string;
  render(performance: PerformanceDocument): Promise<TOutput>;
}
