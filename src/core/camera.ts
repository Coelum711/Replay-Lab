import type { CameraTransform } from './types.js';

export const DEFAULT_CAMERA_TRANSFORM: CameraTransform = { x: 0.5, y: 0.5, zoom: 1 };

/** One normalization path for imports, compilation and both visual editors. */
export function cleanCameraTransform(value: Partial<CameraTransform> | null | undefined): CameraTransform {
  const finite = (input: unknown, fallback: number) => Number.isFinite(Number(input)) ? Number(input) : fallback;
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  const zoom = clamp(finite(value?.zoom, 1), 1, 4), half = 0.5 / zoom;
  const yaw = clamp(finite(value?.yaw, 0), -180, 180);
  const pitch = clamp(finite(value?.pitch, 0), -90, 90);
  return {
    x: clamp(finite(value?.x, 0.5), half, 1 - half),
    y: clamp(finite(value?.y, 0.5), half, 1 - half), zoom,
    ...(yaw ? { yaw } : {}), ...(pitch ? { pitch } : {})
  };
}
