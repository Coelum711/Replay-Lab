/*
 * Animation easing functions adapted from RplGenStudio / TRPG-Replay-Generator
 * core/Formulas.py (GPL-3.0).
 * Original copyright/license retained through Replay Lab's GPL-3.0 distribution
 * and THIRD_PARTY_NOTICES.md attribution.
 */
import type { AnimationCurve } from '../core/types.js';
export type ReplayEasingName = AnimationCurve;

function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function normalizeLogistic(value: number, low: number, high: number): number {
  return high === low ? value : (value - low) / (high - low);
}

export function replayEase(name: ReplayEasingName, progress: number): number {
  const t = clamp01(progress);
  switch (name) {
    case 'quadratic': return t * t;
    case 'quadraticR': return 1 - (1 - t) * (1 - t);
    case 'sigmoid': {
      const k = 5;
      const start = 1 / (1 + Math.exp(k));
      const end = 1 / (1 + Math.exp(-k));
      const value = 1 / (1 + Math.exp(k - 2 * k * t));
      return clamp01(normalizeLogistic(value, start, end));
    }
    case 'right': {
      const k = 4;
      const q = k + (-2 * k) * (t * t);
      const value = 1 / (1 + Math.exp(q));
      const start = 1 / (1 + Math.exp(k));
      const end = 1 / (1 + Math.exp(-k));
      return clamp01(normalizeLogistic(value, start, end));
    }
    case 'left': {
      const k = 4;
      const reverseQuadratic = 1 - (1 - t) * (1 - t);
      const q = k + (-2 * k) * reverseQuadratic;
      const value = 1 / (1 + Math.exp(q));
      const start = 1 / (1 + Math.exp(k));
      const end = 1 / (1 + Math.exp(-k));
      return clamp01(normalizeLogistic(value, start, end));
    }
    case 'sincurve': return (Math.sin(-Math.PI / 2 + Math.PI * t) + 1) / 2;
    case 'linear':
    default: return t;
  }
}

export function interpolateReplay(begin: number, end: number, progress: number, easing: ReplayEasingName = 'linear'): number {
  return begin + (end - begin) * replayEase(easing, progress);
}
