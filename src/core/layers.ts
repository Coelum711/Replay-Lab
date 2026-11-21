/**
 * Stage layers: images (later GIFs and video) placed on a timeline that is cut into scenes and lines.
 * Every time is stored as "line + seconds into that line", so re-rolled voice or edited pauses move
 * the layer with its lines instead of leaving it at a stale absolute second.
 */
import { moveCurveValue } from './move-curves.js';

/** A moment on the script: `offset` seconds into line `lineId`; `offset: null` means the end of that line. */
export interface LayerAnchor { lineId: string; offset: number | null }

/** Values a keyframe sets; anything left out keeps the previous value. */
export interface LayerPose {
  /** Centre, as a fraction of the stage width / height. */
  x: number;
  y: number;
  /** Width as a fraction of the stage width (height follows the image's aspect ratio). */
  width: number;
  opacity: number;
  /** Degrees, clockwise. */
  rotation: number;
}

export interface LayerKeyframe extends Partial<LayerPose> {
  id: string;
  at: LayerAnchor;
  /** Speed curve used to arrive at this keyframe from the previous one. */
  curve: string;
}

export interface LayerFrame {
  /** Corner radius in stage pixels (1280-wide stage). */
  radius: number;
  borderWidth: number;
  borderColor: string;
  shadow: boolean;
  /** Crop shape. */
  mask: 'rect' | 'circle';
}

export type LayerKind = 'image';
/** `characters`: above the characters, under the textbox. `top`: over everything, textbox included. */
export type LayerZ = 'characters' | 'top';

export interface StageLayer {
  id: string;
  name: string;
  kind: LayerKind;
  assetId: string | null;
  /** Timeline row the clip sits on (purely organisational). */
  track: string;
  z: LayerZ;
  start: LayerAnchor;
  end: LayerAnchor;
  base: LayerPose;
  frame: LayerFrame;
  /** Seconds of fade at the start / end. */
  fadeIn: number;
  fadeOut: number;
  keyframes: LayerKeyframe[];
  hidden?: boolean;
}

export interface ResolvedLayer extends Omit<StageLayer, 'start' | 'end' | 'keyframes'> {
  start: number;
  end: number;
  keyframes: Array<Partial<LayerPose> & { time: number; curve: string }>;
}

export const DEFAULT_LAYER_POSE: LayerPose = { x: 0.72, y: 0.3, width: 0.34, opacity: 1, rotation: 0 };
export const DEFAULT_LAYER_FRAME: LayerFrame = { radius: 10, borderWidth: 3, borderColor: '#ffffff', shadow: true, mask: 'rect' };
export const LAYER_TRACKS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'pip', label: '画中画' }, { key: 'image', label: '图片' }, { key: 'extra', label: '更多' }
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const finite = (v: unknown, fallback: number) => Number.isFinite(Number(v)) ? Number(v) : fallback;

export function normalizeLayer(raw: Partial<StageLayer> & { id: string }): StageLayer {
  const anchor = (a: Partial<LayerAnchor> | undefined, fallbackEnd: boolean): LayerAnchor => ({
    lineId: String(a?.lineId ?? ''),
    offset: a?.offset === null || (a?.offset === undefined && fallbackEnd) ? null : Math.max(0, finite(a?.offset, 0))
  });
  const base = { ...DEFAULT_LAYER_POSE, ...(raw.base ?? {}) };
  const frame = { ...DEFAULT_LAYER_FRAME, ...(raw.frame ?? {}) };
  return {
    id: raw.id,
    name: String(raw.name ?? '图层'),
    kind: 'image',
    assetId: raw.assetId ?? null,
    track: String(raw.track ?? 'pip'),
    z: raw.z === 'top' ? 'top' : 'characters',
    start: anchor(raw.start, false),
    end: anchor(raw.end, true),
    base: { x: clamp(finite(base.x, 0.5), -1, 2), y: clamp(finite(base.y, 0.5), -1, 2), width: clamp(finite(base.width, 0.3), 0.01, 3), opacity: clamp(finite(base.opacity, 1), 0, 1), rotation: finite(base.rotation, 0) },
    frame: { radius: clamp(finite(frame.radius, 0), 0, 400), borderWidth: clamp(finite(frame.borderWidth, 0), 0, 60), borderColor: /^#[0-9a-f]{6}$/i.test(String(frame.borderColor)) ? String(frame.borderColor) : '#ffffff', shadow: !!frame.shadow, mask: frame.mask === 'circle' ? 'circle' : 'rect' },
    fadeIn: clamp(finite(raw.fadeIn, 0), 0, 10),
    fadeOut: clamp(finite(raw.fadeOut, 0), 0, 10),
    keyframes: (raw.keyframes ?? []).map(k => ({ ...k, id: String(k.id), at: anchor(k.at, false), curve: typeof k.curve === 'string' ? k.curve : 'easeInOut' })),
    ...(raw.hidden ? { hidden: true } : {})
  };
}

/** Absolute seconds of an anchor, or null when its line no longer exists. */
export function anchorTime(anchor: LayerAnchor, lines: ReadonlyArray<{ lineId: string; start: number; duration: number }>): number | null {
  const line = lines.find(item => item.lineId === anchor.lineId);
  if (!line) return null;
  return line.start + (anchor.offset === null ? line.duration : clamp(anchor.offset, 0, line.duration));
}

/** The anchor for an absolute time: the line that is showing then, and the seconds into it. */
export function anchorAt(time: number, lines: ReadonlyArray<{ lineId: string; start: number; duration: number }>, snapToEnd = false): LayerAnchor | null {
  const shown = lines.filter(line => line.duration > 0);
  if (!shown.length) return null;
  const line = shown.find(item => time >= item.start && time < item.start + item.duration) ?? (time < shown[0]!.start ? shown[0]! : shown[shown.length - 1]!);
  const offset = clamp(time - line.start, 0, line.duration);
  if (snapToEnd && offset >= line.duration - 1e-6) return { lineId: line.lineId, offset: null };
  return { lineId: line.lineId, offset: Math.round(offset * 1000) / 1000 };
}

/** Layers with times resolved; layers whose lines were deleted are dropped (and reported by the editor). */
export function resolveLayers(layers: readonly StageLayer[] | undefined, lines: ReadonlyArray<{ lineId: string; start: number; duration: number }>): ResolvedLayer[] {
  const out: ResolvedLayer[] = [];
  for (const raw of layers ?? []) {
    const layer = normalizeLayer(raw);
    if (layer.hidden || !layer.assetId) continue;
    const start = anchorTime(layer.start, lines), end = anchorTime(layer.end, lines);
    if (start === null || end === null || end <= start) continue;
    const keyframes = layer.keyframes
      .map(k => ({ ...pick(k), time: anchorTime(k.at, lines), curve: k.curve }))
      .filter((k): k is Partial<LayerPose> & { time: number; curve: string } => k.time !== null && k.time >= start && k.time <= end)
      .sort((a, b) => a.time - b.time);
    out.push({ ...layer, start, end, keyframes });
  }
  return out;
}

function pick(k: Partial<LayerPose>): Partial<LayerPose> {
  const out: Partial<LayerPose> = {};
  for (const key of ['x', 'y', 'width', 'opacity', 'rotation'] as const) if (Number.isFinite(Number(k[key]))) out[key] = Number(k[key]);
  return out;
}

/**
 * Pose of a layer at absolute `time`, or null when it is not on screen. Between keyframes each value
 * eases with the later keyframe's curve (overshoot curves may pass the target); fades scale opacity.
 */
export function layerPoseAt(layer: ResolvedLayer, time: number): LayerPose | null {
  if (time < layer.start || time >= layer.end) return null;
  const pose: LayerPose = { ...layer.base };
  let from: LayerPose = { ...layer.base }, fromTime = layer.start;
  for (const key of layer.keyframes) {
    const target: LayerPose = { ...from, ...pick(key) };
    if (time >= key.time) { from = target; fromTime = key.time; Object.assign(pose, target); continue; }
    const span = key.time - fromTime;
    const p = span > 0 ? moveCurveValue(key.curve, (time - fromTime) / span) : 1;
    for (const field of ['x', 'y', 'width', 'opacity', 'rotation'] as const) pose[field] = from[field] + (target[field] - from[field]) * p;
    break;
  }
  const fadeIn = layer.fadeIn > 0 ? clamp((time - layer.start) / layer.fadeIn, 0, 1) : 1;
  const fadeOut = layer.fadeOut > 0 ? clamp((layer.end - time) / layer.fadeOut, 0, 1) : 1;
  pose.opacity = clamp(pose.opacity, 0, 1) * fadeIn * fadeOut;
  pose.width = Math.max(0.005, pose.width);
  return pose;
}
