import type { CameraTransform, StageProjectionMode, StageTransform } from './types.js';

export interface ProjectedStageTransform {
  x: number;
  y: number;
  scale: number;
  depth: number;
  /** Camera-relative distance used for painter ordering. */
  viewDepth?: number;
}

export const STAGE_25D = {
  horizonY: 0.40,
  farScale: 0.48,
  horizontalCompression: 0.18,
  verticalConvergence: 0.88,
  cameraParallax: 0.55
} as const;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Lightweight VN-style 2.5D projection. Authoring remains 2D sprite placement;
 * depth only changes apparent scale, floor position, horizontal convergence and
 * camera parallax. Orbit rotates these layered sprite anchors; artwork remains
 * camera-facing. A backdrop image is still a flat backdrop, not a 3D environment.
 */
export function projectStageTransform(
  transform: Pick<StageTransform, 'x' | 'y' | 'scale' | 'depth'>,
  projection: StageProjectionMode,
  camera?: Partial<CameraTransform> | null
): ProjectedStageTransform {
  const depth = clamp(Number(transform.depth) || 0, 0, 1);
  const x = Number.isFinite(Number(transform.x)) ? Number(transform.x) : 0.5;
  const y = Number.isFinite(Number(transform.y)) ? Number(transform.y) : 0.88;
  const scale = Number.isFinite(Number(transform.scale)) ? Number(transform.scale) : 1;
  if (projection !== '2.5d' || (depth === 0 && !camera?.yaw && !camera?.pitch)) return { x, y, scale, depth };

  const perspectiveScale = 1 - depth * (1 - STAGE_25D.farScale);
  const xCompression = 1 - depth * STAGE_25D.horizontalCompression;
  const yCompression = 1 - depth * STAGE_25D.verticalConvergence;
  const framingX = clamp(Number.isFinite(camera?.x) ? camera!.x! : 0.5, 0, 1);
  const framingY = clamp(Number.isFinite(camera?.y) ? camera!.y! : 0.5, 0, 1);

  // Far actors converge toward the visual vanishing region. Camera-pan
  // compensation makes distant actors travel less across the screen than near ones.
  const projectedX = 0.5 + (x - 0.5) * xCompression + (framingX - 0.5) * depth * STAGE_25D.cameraParallax;
  const projectedY = STAGE_25D.horizonY + (y - STAGE_25D.horizonY) * yCompression
    + (framingY - 0.5) * depth * STAGE_25D.cameraParallax * 0.4;
  const yaw = clamp(Number(camera?.yaw) || 0, -180, 180) * Math.PI / 180;
  const pitch = clamp(Number(camera?.pitch) || 0, -90, 90) * Math.PI / 180;
  if (!yaw && !pitch) return { x: projectedX, y: projectedY, scale: scale * perspectiveScale, depth };
  const orbit = orbitStagePoint({ x: projectedX, y: projectedY, depth }, yaw, pitch);
  return { x: orbit.x, y: orbit.y, scale: scale * perspectiveScale * orbit.scale, depth, viewDepth: orbit.viewDepth };
}

/** Shared orbit basis for stage anchors and the spatial inspection viewport. */
export function orbitStagePoint(point: { x: number; y: number; depth: number }, yaw: number, pitch: number): { x: number; y: number; scale: number; viewDepth: number } {
  const px = (point.x - 0.5) * 1.6, py = 0.65 - point.y, pz = (point.depth - 0.35) * 0.85;
  const rx = Math.cos(yaw) * px - Math.sin(yaw) * pz;
  const rz = Math.sin(yaw) * px + Math.cos(yaw) * pz;
  const ry = Math.cos(pitch) * py + Math.sin(pitch) * rz;
  const viewDepth = -Math.sin(pitch) * py + Math.cos(pitch) * rz;
  const perspective = (2.4 + pz) / Math.max(0.6, 2.4 + viewDepth);
  return { x: 0.5 + rx * perspective / 1.6, y: 0.65 - ry * perspective, scale: perspective, viewDepth };
}

/** Convert screen-space drag deltas back into the authored ground-plane transform. */
export function unprojectStageDragDelta(dx: number, dy: number, depth: number, projection: StageProjectionMode, camera?: Partial<CameraTransform> | null, anchor: { x: number; y: number } = { x: 0.5, y: 0.88 }): { dx: number; dy: number } {
  const zoom = clamp(Number(camera?.zoom) || 1, 1, 4);
  dx /= zoom; dy /= zoom;
  if (projection !== '2.5d') return { dx, dy };
  if (camera?.yaw || camera?.pitch) {
    const point = { ...anchor, depth, scale: 1 }, h = 0.00001;
    const p = projectStageTransform(point, projection, camera);
    const x = projectStageTransform({ ...point, x: point.x + h }, projection, camera);
    const y = projectStageTransform({ ...point, y: point.y + h }, projection, camera);
    const a = (x.x - p.x) / h, b = (y.x - p.x) / h, c = (x.y - p.y) / h, d = (y.y - p.y) / h;
    const determinant = a * d - b * c;
    // Edge-on planes are edited in the spatial overview instead of dividing by zero.
    if (Math.abs(determinant) < 0.04) return { dx: 0, dy: 0 };
    return { dx: clamp((d * dx - b * dy) / determinant, -1, 1), dy: clamp((a * dy - c * dx) / determinant, -1, 1) };
  }
  const d = clamp(depth, 0, 1);
  const xCompression = Math.max(0.35, 1 - d * STAGE_25D.horizontalCompression);
  const yCompression = Math.max(0.18, 1 - d * STAGE_25D.verticalConvergence);
  return { dx: dx / xCompression, dy: dy / yCompression };
}
