import type { ReplayProject } from '../core/types.js';
import { normalizeReplayProject } from '../core/normalize.js';
import { serializeWorkspaceWrite } from './lock.js';
import { WorkspaceConflictError, workspaceManifestFingerprint } from './conflict.js';
import { PROJECT_MANIFEST_PATH, WORKSPACE_DIRECTORIES } from './layout.js';
import {desktopBridge,DesktopProjectWorkspace} from './desktop.js';
import type { ProjectWorkspace, WorkspaceData, WorkspaceFileInfo } from './types.js';

function normalizePath(path: string): string[] {
  return path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
}

async function dataToBlob(data: WorkspaceData, mime?: string): Promise<Blob> {
  if (data instanceof Blob) return data;
  if (typeof data === 'string') return new Blob([data], { type: mime || 'text/plain;charset=utf-8' });
  if (data instanceof ArrayBuffer) return new Blob([data], { type: mime || 'application/octet-stream' });
  return new Blob([data], { type: mime || 'application/octet-stream' });
}

/** Browser File System Access API workspace. Chrome/Edge provide showDirectoryPicker(). */
export class BrowserFileSystemWorkspace implements ProjectWorkspace {
  readonly kind = 'filesystem' as const;
  readonly id: string;
  readonly label: string;
  private lastProjectFingerprint: string | null | undefined = undefined;

  constructor(private readonly root: FileSystemDirectoryHandle) {
    this.label = root.name;
    this.id = `fs-${root.name}`;
  }

  static async choose(options: { mode?: 'read' | 'readwrite'; startIn?: string;recentId?:string } = {}): Promise<ProjectWorkspace> {
    if(desktopBridge())return DesktopProjectWorkspace.choose(options.recentId);
    const picker = (globalThis as typeof globalThis & { showDirectoryPicker?: (opts?: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) throw new Error('This browser does not support the File System Access directory picker. Use Chrome/Edge or export a project bundle instead.');
    const handle = await picker({ mode: options.mode ?? 'readwrite', startIn: options.startIn });
    const ws = new BrowserFileSystemWorkspace(handle);
    await ws.ensureLayout();
    return ws;
  }

  async ensureLayout(): Promise<void> {
    for (const dir of WORKSPACE_DIRECTORIES) await this.directory(dir, true);
  }

  private async directory(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let current = this.root;
    for (const part of normalizePath(path)) current = await current.getDirectoryHandle(part, { create });
    return current;
  }

  private async parentAndName(path: string, create = false): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
    const parts = normalizePath(path);
    const name = parts.pop();
    if (!name) throw new Error(`Invalid workspace path: ${path}`);
    return { parent: await this.directory(parts.join('/'), create), name };
  }

  async write(path: string, data: WorkspaceData, mime?: string): Promise<void> {
    const { parent, name } = await this.parentAndName(path, true);
    const file = await parent.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(await dataToBlob(data, mime));
      await writable.close();
    } catch(error) {
      try { await writable.abort(); } catch { /* Retain the original error. */ }
      throw error;
    }
  }

  async createWritable(path: string): Promise<WritableStream> {
    const { parent, name } = await this.parentAndName(path, true);
    const file = await parent.getFileHandle(name, { create: true });
    return await file.createWritable();
  }

  async read(path: string): Promise<Blob> {
    const { parent, name } = await this.parentAndName(path, false);
    const file = await parent.getFileHandle(name);
    return await file.getFile();
  }

  async exists(path: string): Promise<boolean> {
    try { await this.read(path); return true; } catch(error) {
      if ((error as Error)?.name === 'NotFoundError') return false;
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    const { parent, name } = await this.parentAndName(path, false);
    await parent.removeEntry(name, { recursive: true });
  }

  async list(prefix = ''): Promise<WorkspaceFileInfo[]> {
    const results: WorkspaceFileInfo[] = [];
    const prefixParts = normalizePath(prefix);
    const start = prefixParts.length ? await this.directory(prefixParts.join('/'), false) : this.root;
    const base = prefixParts.join('/');
    async function walk(dir: FileSystemDirectoryHandle, path: string): Promise<void> {
      for await (const [name, handle] of (dir as any).entries()) {
        const child = path ? `${path}/${name}` : name;
        if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, child);
        else {
          const file = await (handle as FileSystemFileHandle).getFile();
          results.push({ path: child, size: file.size, mime: file.type, modifiedAt: file.lastModified });
        }
      }
    }
    await walk(start, base);
    return results.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
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
    const text = JSON.stringify(project, null, 2);
    await serializeWorkspaceWrite(this, async () => {
      await this.assertProjectCurrent();
      await this.write(PROJECT_MANIFEST_PATH, text, 'application/json');
      this.lastProjectFingerprint = workspaceManifestFingerprint(text);
    });
  }

  async loadProject(): Promise<ReplayProject | null> {
    if (!(await this.exists(PROJECT_MANIFEST_PATH))) { this.lastProjectFingerprint = null; return null; }
    const text = await (await this.read(PROJECT_MANIFEST_PATH)).text();
    this.lastProjectFingerprint = workspaceManifestFingerprint(text);
    return normalizeReplayProject(JSON.parse(text));
  }
}
