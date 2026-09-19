import type { CameraTransform, StageProjectionMode, StageTransform } from './types.js';

export interface ProjectedStageTransform {
  x: number;
  y: number;
  scale: number;
  depth: number;
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
 * camera parallax. No mesh/perspective camera is involved.
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
  if (projection !== '2.5d' || depth <= 0) return { x, y, scale, depth };

  const perspectiveScale = 1 - depth * (1 - STAGE_25D.farScale);
  const xCompression = 1 - depth * STAGE_25D.horizontalCompression;
  const yCompression = 1 - depth * STAGE_25D.verticalConvergence;
  const framingX = clamp(Number(camera?.x) || 0.5, 0, 1);
  const framingY = clamp(Number(camera?.y) || 0.5, 0, 1);

  // Far actors converge toward the visual vanishing region. Camera-pan
  // compensation makes distant actors travel less across the screen than near ones.
  const projectedX = 0.5 + (x - 0.5) * xCompression + (framingX - 0.5) * depth * STAGE_25D.cameraParallax;
  const projectedY = STAGE_25D.horizonY + (y - STAGE_25D.horizonY) * yCompression
    + (framingY - 0.5) * depth * STAGE_25D.cameraParallax * 0.4;
  return { x: projectedX, y: projectedY, scale: scale * perspectiveScale, depth };
}

/** Convert screen-space drag deltas back into the authored ground-plane transform. */
export function unprojectStageDragDelta(dx: number, dy: number, depth: number, projection: StageProjectionMode): { dx: number; dy: number } {
  if (projection !== '2.5d') return { dx, dy };
  const d = clamp(depth, 0, 1);
  const xCompression = Math.max(0.35, 1 - d * STAGE_25D.horizontalCompression);
  const yCompression = Math.max(0.18, 1 - d * STAGE_25D.verticalConvergence);
  return { dx: dx / xCompression, dy: dy / yCompression };
}
