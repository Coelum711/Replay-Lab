import type { ReplayProject } from '../core/types.js';
import { WorkspaceConflictError, workspaceManifestFingerprint } from './conflict.js';
import { PROJECT_MANIFEST_PATH } from './layout.js';
import type { ProjectWorkspace, WorkspaceData, WorkspaceFileInfo } from './types.js';

function toBlob(data: WorkspaceData, mime?: string): Blob {
  if (data instanceof Blob) return data;
  if (typeof data === 'string') return new Blob([data], { type: mime || 'text/plain;charset=utf-8' });
  if (data instanceof ArrayBuffer) return new Blob([data], { type: mime || 'application/octet-stream' });
  return new Blob([data], { type: mime || 'application/octet-stream' });
}

export class MemoryProjectWorkspace implements ProjectWorkspace {
  readonly kind = 'memory' as const;
  readonly id: string;
  readonly label: string;
  private files = new Map<string, { blob: Blob; modifiedAt: number }>();
  private lastProjectFingerprint: string | null | undefined = undefined;

  constructor(label = 'Memory workspace', id = `memory-${Math.random().toString(36).slice(2, 10)}`) {
    this.label = label;
    this.id = id;
  }

  async write(path: string, data: WorkspaceData, mime?: string): Promise<void> {
    this.files.set(path.replace(/^\/+/, ''), { blob: toBlob(data, mime), modifiedAt: Date.now() });
  }

  async read(path: string): Promise<Blob> {
    const item = this.files.get(path.replace(/^\/+/, ''));
    if (!item) throw new Error(`Workspace file not found: ${path}`);
    return item.blob;
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path.replace(/^\/+/, ''));
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path.replace(/^\/+/, ''));
  }

  async list(prefix = ''): Promise<WorkspaceFileInfo[]> {
    const p = prefix.replace(/^\/+/, '');
    return [...this.files.entries()]
      .filter(([path]) => path.startsWith(p))
      .map(([path, item]) => ({ path, size: item.blob.size, mime: item.blob.type, modifiedAt: item.modifiedAt }))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }

  private async currentProjectFingerprint(): Promise<string | null> {
    if (!(await this.exists(PROJECT_MANIFEST_PATH))) return null;
    return workspaceManifestFingerprint(await (await this.read(PROJECT_MANIFEST_PATH)).text());
  }

  async assertProjectCurrent(): Promise<void> {
    const current = await this.currentProjectFingerprint();
    if (this.lastProjectFingerprint === undefined) {
      if (current !== null) throw new WorkspaceConflictError('工程目录已有未在本页加载的 project.replaylab.json；为避免覆盖，请先重新载入目录工程。');
      return;
    }
    if (current !== this.lastProjectFingerprint) throw new WorkspaceConflictError('project.replaylab.json 已被另一个窗口或程序修改；已停止保存以避免覆盖。');
  }

  async saveProject(project: ReplayProject): Promise<void> {
    await this.assertProjectCurrent();
    const text = JSON.stringify(project, null, 2);
    await this.write(PROJECT_MANIFEST_PATH, text, 'application/json');
    this.lastProjectFingerprint = workspaceManifestFingerprint(text);
  }

  async loadProject(): Promise<ReplayProject | null> {
    if (!(await this.exists(PROJECT_MANIFEST_PATH))) { this.lastProjectFingerprint = null; return null; }
    const text = await (await this.read(PROJECT_MANIFEST_PATH)).text();
    this.lastProjectFingerprint = workspaceManifestFingerprint(text);
    return JSON.parse(text) as ReplayProject;
  }
}
