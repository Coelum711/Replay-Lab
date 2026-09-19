import { makeId } from '../core/id.js';
import type {
  CustomObjectHotspot,
  CustomObjectInteractionStep,
  CustomObjectInteractionTake,
  CustomObjectRuntimeState,
  CustomObjectTransform,
  PerformanceDocument
} from '../core/types.js';
import type { CanvasStageRenderer, CustomObjectHitResult } from '../renderers/canvas-stage.js';

export interface CustomObjectInteractionEvent {
  kind: 'inspect-open' | 'inspect-close' | 'state' | 'hide' | 'note' | 'pan' | 'zoom' | 'hotspot';
  objectId: string;
  hotspotId?: string | null;
  stateId?: string | null;
  note?: string | null;
  transform?: Partial<CustomObjectTransform>;
}

export interface CustomObjectInteractionCallbacks {
  onInteraction?: (event: CustomObjectInteractionEvent) => void;
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }

export class CustomObjectInteractionController {
  private performance: PerformanceDocument;
  private renderer: CanvasStageRenderer;
  private callbacks: CustomObjectInteractionCallbacks;
  private lineIndex = 0;
  private baseStates = new Map<string, CustomObjectRuntimeState>();
  private inspectOrigins = new Map<string, CustomObjectTransform>();
  private recording: { take: CustomObjectInteractionTake; startedAt: number } | null = null;

  constructor(performance: PerformanceDocument, renderer: CanvasStageRenderer, callbacks: CustomObjectInteractionCallbacks = {}) {
    this.performance = performance;
    this.renderer = renderer;
    this.callbacks = callbacks;
  }

  setPerformance(performance: PerformanceDocument): void {
    this.performance = performance;
    this.lineIndex = Math.min(this.lineIndex, Math.max(0, performance.lines.length - 1));
    this.inspectOrigins.clear();
    this.baseStates.clear();
  }

  setLine(index: number): void {
    const nextIndex = Math.max(0, Math.min(index, Math.max(0, this.performance.lines.length - 1)));
    const nextStates = this.performance.lines[nextIndex]?.state.customObjects ?? {};
    for (const [objectId, previousBase] of this.baseStates) {
      const nextBase = nextStates[objectId];
      if (!nextBase || previousBase.visible !== nextBase.visible || previousBase.stateId !== nextBase.stateId || JSON.stringify(previousBase.transform) !== JSON.stringify(nextBase.transform)) {
        this.renderer.clearCustomObjectInteractionOverrides(objectId);
        this.inspectOrigins.delete(objectId);
      }
    }
    this.baseStates = new Map(Object.entries(nextStates).map(([id, state]) => [id, { ...state, transform: { ...state.transform } }]));
    this.lineIndex = nextIndex;
  }

  private definition(objectId: string) { return this.performance.customObjects?.find(object => object.id === objectId) ?? null; }

  private runtimeState(objectId: string): CustomObjectRuntimeState | null {
    const base = this.performance.lines[this.lineIndex]?.state.customObjects?.[objectId];
    if (!base) return null;
    const override = this.renderer.customObjectInteractionOverride(objectId);
    return {
      ...base,
      visible: override?.visible ?? base.visible,
      stateId: override && Object.prototype.hasOwnProperty.call(override, 'stateId') ? (override.stateId ?? null) : base.stateId,
      transform: { ...base.transform, ...(override?.transform ?? {}) }
    };
  }

  private emit(event: CustomObjectInteractionEvent): CustomObjectInteractionEvent {
    this.callbacks.onInteraction?.(event);
    if (this.recording && this.recording.take.objectId === event.objectId) {
      const step: CustomObjectInteractionStep = {
        id: makeId('objstep'),
        at: Math.max(0, (performance.now() - this.recording.startedAt) / 1000),
        kind: event.kind === 'inspect-open' || event.kind === 'inspect-close' ? 'transform' : event.kind === 'note' ? 'hotspot' : event.kind,
        objectId: event.objectId,
        stateId: event.stateId ?? null,
        hotspotId: event.hotspotId ?? null,
        transform: event.transform ? { ...event.transform } : undefined,
        note: event.note ?? null
      };
      this.recording.take.steps.push(step);
      this.recording.take.duration = Math.max(this.recording.take.duration, step.at);
    }
    return event;
  }

  private hotspotFor(hit: CustomObjectHitResult): CustomObjectHotspot | null {
    const object = this.definition(hit.objectId);
    if (!object || !hit.hotspotId) return null;
    return object.hotspots.find(hotspot => hotspot.id === hit.hotspotId) ?? null;
  }

  interactAt(x: number, y: number): CustomObjectInteractionEvent | null {
    const hit = this.renderer.customObjectHitTest(x, y);
    if (!hit) return null;
    const object = this.definition(hit.objectId);
    const state = this.runtimeState(hit.objectId);
    if (!object || !state) return null;
    const hotspot = object.interactionMode === 'hotspots' ? this.hotspotFor(hit) : null;
    if (hotspot) {
      const action = hotspot.action ?? (hotspot.targetStateId ? 'state' : 'none');
      if (action === 'state' && hotspot.targetStateId) {
        this.renderer.setCustomObjectInteractionOverride(object.id, { stateId: hotspot.targetStateId, visible: true });
        return this.emit({ kind: 'state', objectId: object.id, hotspotId: hotspot.id, stateId: hotspot.targetStateId });
      }
      if (action === 'hide') {
        this.renderer.setCustomObjectInteractionOverride(object.id, { visible: false });
        return this.emit({ kind: 'hide', objectId: object.id, hotspotId: hotspot.id });
      }
      if (action === 'note') return this.emit({ kind: 'note', objectId: object.id, hotspotId: hotspot.id, note: hotspot.note ?? hotspot.label });
      return this.emit({ kind: 'hotspot', objectId: object.id, hotspotId: hotspot.id, note: hotspot.note ?? null });
    }
    if (object.interactionMode === 'stateful' && object.states.length > 1) {
      const index = Math.max(0, object.states.findIndex(item => item.id === state.stateId));
      const next = object.states[(index + 1) % object.states.length]!;
      this.renderer.setCustomObjectInteractionOverride(object.id, { stateId: next.id, visible: true });
      return this.emit({ kind: 'state', objectId: object.id, stateId: next.id });
    }
    if (object.interactionMode === 'inspect') {
      const origin = this.inspectOrigins.get(object.id);
      if (origin) {
        this.renderer.setCustomObjectInteractionOverride(object.id, { transform: { ...origin } });
        this.inspectOrigins.delete(object.id);
        return this.emit({ kind: 'inspect-close', objectId: object.id, transform: { ...origin } });
      }
      this.inspectOrigins.set(object.id, { ...state.transform });
      const next = { x: 0.5, y: 0.46, scale: clamp(Math.max(state.transform.scale * 1.35, 0.82), 0.2, 1.25), rotation: 0 };
      this.renderer.setCustomObjectInteractionOverride(object.id, { transform: next });
      return this.emit({ kind: 'inspect-open', objectId: object.id, transform: next });
    }
    return null;
  }

  panBy(objectId: string, dxNormalized: number, dyNormalized: number): CustomObjectInteractionEvent | null {
    const object = this.definition(objectId), state = this.runtimeState(objectId);
    if (!object || !state || object.interactionMode !== 'pan-zoom') return null;
    const next = {
      x: clamp(state.transform.x + dxNormalized, -0.25, 1.25),
      y: clamp(state.transform.y + dyNormalized, -0.25, 1.25)
    };
    this.renderer.setCustomObjectInteractionOverride(objectId, { transform: next });
    return this.emit({ kind: 'pan', objectId, transform: next });
  }

  zoomBy(objectId: string, factor: number): CustomObjectInteractionEvent | null {
    const object = this.definition(objectId), state = this.runtimeState(objectId);
    if (!object || !state || object.interactionMode !== 'pan-zoom') return null;
    const next = { scale: clamp(state.transform.scale * factor, 0.12, 2.4) };
    this.renderer.setCustomObjectInteractionOverride(objectId, { transform: next });
    return this.emit({ kind: 'zoom', objectId, transform: next });
  }

  beginRecording(objectId: string, name = '对象交互录制'): CustomObjectInteractionTake | null {
    const object = this.definition(objectId);
    if (!object) return null;
    const take: CustomObjectInteractionTake = { id: makeId('objtake'), name, objectId, duration: 0, steps: [] };
    this.recording = { take, startedAt: performance.now() };
    return take;
  }

  stopRecording(): CustomObjectInteractionTake | null {
    if (!this.recording) return null;
    this.recording.take.duration = Math.max(this.recording.take.duration, (performance.now() - this.recording.startedAt) / 1000);
    const take = { ...this.recording.take, steps: this.recording.take.steps.map(step => ({ ...step, transform: step.transform ? { ...step.transform } : undefined })) };
    this.recording = null;
    return take;
  }

  get isRecording(): boolean { return Boolean(this.recording); }
}
