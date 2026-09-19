import type { PerformanceDocument, PerformanceLine } from '../core/types.js';
import { BrowserReplayPlayer } from '../renderers/browser-media.js';
import { CanvasStageRenderer } from '../renderers/canvas-stage.js';

export interface VNBacklogEntry {
  index: number;
  speaker: string;
  text: string;
  type: string;
}

export interface VNRuntimeCallbacks {
  onLine?: (index: number, line: PerformanceLine) => void;
  onMode?: (state: { auto: boolean; skip: boolean }) => void;
  onEnd?: () => void;
}

export interface VNRuntimeOptions {
  autoDelayMs?: number;
  skipDelayMs?: number;
}

/**
 * Small VN-style controller inspired by mature web VN runtimes: playback state
 * stays separate from rendering. The same CanvasStageRenderer is therefore used
 * for Studio preview, VN playtest and video export.
 */
export class VNReplayRuntime {
  private performance: PerformanceDocument;
  private renderer: CanvasStageRenderer;
  private player: BrowserReplayPlayer;
  private callbacks: VNRuntimeCallbacks;
  private autoDelayMs: number;
  private skipDelayMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private visited: number[] = [];
  private _index = 0;
  private _auto = false;
  private _skip = false;

  constructor(performance: PerformanceDocument, renderer: CanvasStageRenderer, player: BrowserReplayPlayer, callbacks: VNRuntimeCallbacks = {}, options: VNRuntimeOptions = {}) {
    this.performance = performance;
    this.renderer = renderer;
    this.player = player;
    this.callbacks = callbacks;
    this.autoDelayMs = Math.max(0, options.autoDelayMs ?? 520);
    this.skipDelayMs = Math.max(35, options.skipDelayMs ?? 110);
  }

  get index(): number { return this._index; }
  get auto(): boolean { return this._auto; }
  get skip(): boolean { return this._skip; }

  setPerformance(performance: PerformanceDocument): void {
    this.stop();
    this.performance = performance;
    this._index = Math.min(this._index, Math.max(0, performance.lines.length - 1));
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private notifyMode(): void { this.callbacks.onMode?.({ auto: this._auto, skip: this._skip }); }

  private remember(index: number): void {
    if (this.visited.at(-1) !== index) this.visited.push(index);
    if (this.visited.length > 500) this.visited.splice(0, this.visited.length - 500);
  }

  backlog(): VNBacklogEntry[] {
    const out: VNBacklogEntry[] = [];
    for (const index of this.visited) {
      const line = this.performance.lines[index];
      if (!line || line.type === 'command') continue;
      out.push({ index, speaker: line.speakerName, text: line.text, type: line.type });
    }
    return out;
  }

  async start(index = 0): Promise<void> {
    this.visited = [];
    this._index = Math.max(0, Math.min(index, Math.max(0, this.performance.lines.length - 1)));
    await this.showForwardSkippingCommands(this._index, true);
  }

  async restart(index = 0): Promise<void> {
    this.stop(false);
    this.visited = [];
    this._index = Math.max(0, Math.min(index, Math.max(0, this.performance.lines.length - 1)));
    await this.showForwardSkippingCommands(this._index, true);
  }

  async next(): Promise<void> {
    if (!this.performance.lines.length) return;
    if (this._index >= this.performance.lines.length - 1) {
      this.stop(false);
      this.callbacks.onEnd?.();
      return;
    }
    await this.showForwardSkippingCommands(this._index + 1, !this._skip);
  }

  async previous(): Promise<void> {
    if (!this.performance.lines.length) return;
    let target = Math.max(0, this._index - 1);
    while (target > 0 && this.performance.lines[target]?.type === 'command') target -= 1;
    this._index = target;
    await this.show(this._index, !this._skip);
  }

  /** Execute zero-UI director events in sequence, then stop on the next visible VN line. */
  private async showForwardSkippingCommands(index: number, playAnimation: boolean): Promise<void> {
    let target = Math.max(0, Math.min(index, Math.max(0, this.performance.lines.length - 1)));
    while (target < this.performance.lines.length && this.performance.lines[target]?.type === 'command') {
      this._index = target;
      const line = this.performance.lines[target]!;
      this.remember(target);
      this.player.stop();
      if (this._skip) await this.renderer.renderLine(target, line.duration);
      else if (line.duration > 0.06) await this.player.playLine(target);
      else await this.renderer.renderLine(target, line.duration);
      target += 1;
    }
    if (target >= this.performance.lines.length) {
      this._index = Math.max(0, this.performance.lines.length - 1);
      this.stop(false);
      this.callbacks.onEnd?.();
      return;
    }
    this._index = target;
    await this.show(target, playAnimation);
  }

  setAuto(on: boolean): void {
    this._auto = Boolean(on);
    if (this._auto) this._skip = false;
    this.notifyMode();
    void this.reschedule();
  }

  toggleAuto(): void { this.setAuto(!this._auto); }

  setSkip(on: boolean): void {
    this._skip = Boolean(on);
    if (this._skip) this._auto = false;
    this.notifyMode();
    void this.reschedule();
  }

  toggleSkip(): void { this.setSkip(!this._skip); }

  stop(resetModes = true): void {
    this.generation += 1;
    this.clearTimer();
    this.player.stop();
    if (resetModes) { this._auto = false; this._skip = false; this.notifyMode(); }
  }

  private async show(index: number, playAnimation: boolean): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.clearTimer();
    this.player.stop();
    const line = this.performance.lines[index];
    if (!line) return;
    this.remember(index);
    this.callbacks.onLine?.(index, line);
    if (this._skip) await this.renderer.renderLine(index, line.duration);
    else if (playAnimation) await this.player.playLine(index);
    else await this.renderer.renderLine(index, 0);
    if (generation === this.generation) await this.reschedule();
  }

  private async reschedule(): Promise<void> {
    this.clearTimer();
    const line = this.performance.lines[this._index];
    if (!line) return;
    const generation = this.generation;
    if (this._skip) {
      this.timer = setTimeout(() => { if (generation === this.generation) void this.next(); }, this.skipDelayMs);
      return;
    }
    if (!this._auto) return;
    if (line.wheel?.mode === 'interactive' || line.wheel?.blockingAuto) return;
    const hasInteractiveObject = Object.values(line.state.customObjects ?? {}).some(state => {
      if (!state?.visible) return false;
      const object = this.performance.customObjects?.find(item => item.id === state.objectId);
      return Boolean(object && object.interactionMode && object.interactionMode !== 'none');
    });
    if (hasInteractiveObject) return;
    const delay = Math.max(180, line.duration * 1000 + this.autoDelayMs);
    this.timer = setTimeout(() => { if (generation === this.generation) void this.next(); }, delay);
  }
}
