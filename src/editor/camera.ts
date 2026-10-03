import type { CameraTransform, PerformanceLine, ReplayLine } from '../core/types.js';
import { cleanCameraTransform, DEFAULT_CAMERA_TRANSFORM } from '../core/camera.js';
export { cleanCameraTransform, DEFAULT_CAMERA_TRANSFORM } from '../core/camera.js';

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
