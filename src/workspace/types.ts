import type { ReplayProject } from '../core/types.js';

export type WorkspaceData = Blob | ArrayBuffer | Uint8Array | string;

export interface WorkspaceFileInfo {
  path: string;
  size?: number;
  mime?: string;
  modifiedAt?: number;
}

export interface ProjectWorkspace {
  readonly id: string;
  readonly label: string;
  readonly kind: 'memory' | 'filesystem';
  write(path: string, data: WorkspaceData, mime?: string): Promise<void>;
  read(path: string): Promise<Blob>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  list(prefix?: string): Promise<WorkspaceFileInfo[]>;
  /** Throws WorkspaceConflictError if the manifest changed since this context last loaded/saved it. */
  saveProject(project: ReplayProject): Promise<void>;
  /** Preflight the same optimistic-concurrency check before writing related assets. */
  assertProjectCurrent?(): Promise<void>;
  loadProject(): Promise<ReplayProject | null>;
  /** Optional direct streaming writer for large generated files. */
  createWritable?(path: string): Promise<WritableStream>;
}

export interface PersistedAssetResult {
  assetId: string;
  path: string;
}
