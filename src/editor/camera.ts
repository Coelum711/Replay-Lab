import type { CameraTransform, PerformanceLine, ReplayLine } from '../core/types.js';

export const DEFAULT_CAMERA_TRANSFORM: CameraTransform = { x: 0.5, y: 0.5, zoom: 1 };

export function cleanCameraTransform(value: CameraTransform): CameraTransform {
  const finite = (input: number, fallback: number) => Number.isFinite(Number(input)) ? Number(input) : fallback;
  const zoom = Math.max(1, Math.min(4, finite(value.zoom, 1)));
  const half = 0.5 / zoom;
  return {
    x: Math.max(half, Math.min(1 - half, finite(value.x, 0.5))),
    y: Math.max(half, Math.min(1 - half, finite(value.y, 0.5))),
    zoom
  };
}

export function effectiveCameraTransform(line: ReplayLine, performanceLine?: Pick<PerformanceLine, 'cameraTransform'> | null): CameraTransform {
  if (line.cameraTransform && line.cameraTransform !== null) return cleanCameraTransform(line.cameraTransform);
  return cleanCameraTransform(performanceLine?.cameraTransform ?? DEFAULT_CAMERA_TRANSFORM);
}

export function setCameraTransform(line: ReplayLine, transform: CameraTransform): void {
  line.cameraTransform = cleanCameraTransform(transform);
}

/** Missing means inherit the previous framing inside this Scene. */
export function inheritCameraTransform(line: ReplayLine): void {
  delete line.cameraTransform;
}

/** null is an explicit full-frame reset and stops inherited framing. */
export function resetCameraTransform(line: ReplayLine): void {
  line.cameraTransform = null;
}
