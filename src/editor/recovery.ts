import type { ReplayProject } from '../core/types.js';

export interface RecoverySnapshot {
  id: string;
  project: ReplayProject;
  updatedAt: number;
  label?: string;
  workspaceId?: string | null;
  workspaceLabel?: string | null;
}

export interface ProjectRecoveryStore {
  save(project: ReplayProject, metadata?: Omit<RecoverySnapshot, 'id' | 'project' | 'updatedAt'>): Promise<RecoverySnapshot>;
  latest(): Promise<RecoverySnapshot | null>;
  clear(): Promise<void>;
}

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryProjectRecoveryStore implements ProjectRecoveryStore {
  private snapshot: RecoverySnapshot | null = null;
  async save(project: ReplayProject, metadata = {}): Promise<RecoverySnapshot> {
    this.snapshot = { id: 'latest', project: clone(project), updatedAt: Date.now(), ...metadata };
    return clone(this.snapshot);
  }
  async latest(): Promise<RecoverySnapshot | null> { return this.snapshot ? clone(this.snapshot) : null; }
  async clear(): Promise<void> { this.snapshot = null; }
}

export interface IndexedDbRecoveryOptions {
  dbName?: string;
  storeName?: string;
}

/** Small standards-only crash-recovery store. It intentionally stores project JSON only, never binary assets. */
export class IndexedDbProjectRecoveryStore implements ProjectRecoveryStore {
  private readonly dbName: string;
  private readonly storeName: string;
  constructor(options: IndexedDbRecoveryOptions = {}) {
    this.dbName = options.dbName ?? 'replay-lab-recovery';
    this.storeName = options.storeName ?? 'snapshots';
  }

  private open(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open recovery database'));
    });
  }

  async save(project: ReplayProject, metadata = {}): Promise<RecoverySnapshot> {
    const snapshot: RecoverySnapshot = { id: 'latest', project: clone(project), updatedAt: Date.now(), ...metadata };
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).put(snapshot);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to save recovery snapshot'));
        tx.onabort = () => reject(tx.error ?? new Error('Recovery transaction aborted'));
      });
    } finally { db.close(); }
    return snapshot;
  }

  async latest(): Promise<RecoverySnapshot | null> {
    const db = await this.open();
    try {
      return await new Promise<RecoverySnapshot | null>((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readonly');
        const request = tx.objectStore(this.storeName).get('latest');
        request.onsuccess = () => resolve((request.result as RecoverySnapshot | undefined) ?? null);
        request.onerror = () => reject(request.error ?? new Error('Failed to load recovery snapshot'));
      });
    } finally { db.close(); }
  }

  async clear(): Promise<void> {
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).delete('latest');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Failed to clear recovery snapshot'));
      });
    } finally { db.close(); }
  }
}
