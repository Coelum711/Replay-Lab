import type { ReplayProject } from '../core/types.js';

export interface ImportContext {
  title?: string;
  sourceName?: string;
  mime?: string;
}

export interface ReplayImporter {
  id: string;
  label: string;
  extensions: string[];
  sniff(input: string, context?: ImportContext): number;
  parse(input: string, context?: ImportContext): ReplayProject;
}

export interface VirtualFile {
  name: string;
  relativePath: string;
  type?: string;
  text(): Promise<string>;
  arrayBuffer?(): Promise<ArrayBuffer>;
}
