import type { ReplayProject } from '../core/types.js';

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  length: number;
  cursor: number;
}

interface Entry {
  /** Serialized snapshot is the single retained copy; materialize only on undo/redo. */
  serialized: string;
  bytes: number;
  label: string;
  coalesceKey?: string;
  time: number;
}

export interface HistoryOptions {
  limit?: number;
  coalesceMs?: number;
  /** Approximate retained UTF-16 snapshot budget. At least two snapshots are kept. */
  maxBytes?: number;
}

function snapshotBytes(serialized: string): number {
  // JS strings are commonly UTF-16 internally. This intentionally errs high for
  // ASCII-heavy projects so the history budget acts as a safety rail.
  return serialized.length * 2;
}

function materialize(entry: Entry): ReplayProject {
  return JSON.parse(entry.serialized) as ReplayProject;
}

export class ProjectHistory {
  private readonly limit: number;
  private readonly coalesceMs: number;
  private readonly maxBytes: number;
  private entries: Entry[] = [];
  private cursor = -1;
  private retainedBytes = 0;

  constructor(options: HistoryOptions = {}) {
    this.limit = Math.max(2, options.limit ?? 100);
    this.coalesceMs = Math.max(0, options.coalesceMs ?? 700);
    this.maxBytes = Math.max(1, options.maxBytes ?? 96 * 1024 * 1024);
  }

  private removeFrom(index: number): void {
    const removed = this.entries.splice(index);
    for (const entry of removed) this.retainedBytes -= entry.bytes;
  }

  private trim(): void {
    while (this.entries.length > this.limit) {
      const removed = this.entries.shift()!;
      this.retainedBytes -= removed.bytes;
    }
    // Always retain current + one previous snapshot so Undo remains useful even
    // when a single very large project is larger than the configured budget.
    while (this.entries.length > 2 && this.retainedBytes > this.maxBytes) {
      const removed = this.entries.shift()!;
      this.retainedBytes -= removed.bytes;
    }
    this.retainedBytes = Math.max(0, this.retainedBytes);
    this.cursor = this.entries.length - 1;
  }

  reset(project: ReplayProject, label = '打开工程'): void {
    const serialized = JSON.stringify(project);
    const bytes = snapshotBytes(serialized);
    this.entries = [{ serialized, bytes, label, time: Date.now() }];
    this.retainedBytes = bytes;
    this.cursor = 0;
  }

  capture(project: ReplayProject, label = '编辑', coalesceKey?: string, now = Date.now()): boolean {
    const serialized = JSON.stringify(project);
    const current = this.entries[this.cursor];
    if (current?.serialized === serialized) return false;

    if (this.cursor < this.entries.length - 1) this.removeFrom(this.cursor + 1);

    const bytes = snapshotBytes(serialized);
    const last = this.entries[this.entries.length - 1];
    if (
      last && coalesceKey && last.coalesceKey === coalesceKey &&
      now - last.time <= this.coalesceMs && this.cursor === this.entries.length - 1
    ) {
      this.retainedBytes -= last.bytes;
      this.entries[this.entries.length - 1] = { serialized, bytes, label, coalesceKey, time: now };
      this.retainedBytes += bytes;
      this.trim();
      return true;
    }

    this.entries.push({ serialized, bytes, label, coalesceKey, time: now });
    this.retainedBytes += bytes;
    this.trim();
    return true;
  }

  undo(): ReplayProject | null {
    if (this.cursor <= 0) return null;
    this.cursor -= 1;
    return materialize(this.entries[this.cursor]!);
  }

  redo(): ReplayProject | null {
    if (this.cursor < 0 || this.cursor >= this.entries.length - 1) return null;
    this.cursor += 1;
    return materialize(this.entries[this.cursor]!);
  }

  state(): HistoryState {
    return {
      canUndo: this.cursor > 0,
      canRedo: this.cursor >= 0 && this.cursor < this.entries.length - 1,
      undoLabel: this.cursor > 0 ? this.entries[this.cursor]!.label : undefined,
      redoLabel: this.cursor >= 0 && this.cursor < this.entries.length - 1 ? this.entries[this.cursor + 1]!.label : undefined,
      length: this.entries.length,
      cursor: this.cursor
    };
  }
}
