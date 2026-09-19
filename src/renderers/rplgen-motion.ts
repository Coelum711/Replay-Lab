/*
 * RplGen-compatible switch/motion evaluator.
 * Adapted from TRPG-Replay-Generator core/Motion.py (GPL-3.0),
 * upstream revision 89e65b63c97a74ebff665be038e6dea2a700ec14.
 *
 * Replay Lab keeps RplGen's method vocabulary and core math, but evaluates
 * continuously in seconds rather than producing NumPy frame timelines.
 */
import type { AnimationCurve, RplGenMethodSpec } from '../core/types.js';
import { replayEase } from './easing.js';

export interface ParsedRplGenMotion {
  raw: string;
  alpha: 'replace' | 'delay' | 'cross' | 'black';
  motion: 'static' | 'pass' | 'leap' | 'circular' | 'retreat' | 'approach' | `shake${string}`;
  directionDeg: number;
  scale: 'major' | 'minor' | 'entire' | number;
  cutIn: boolean;
  cutOut: boolean;
}

export interface MotionEvaluation {
  alpha: number;
  dx: number;
  dy: number;
  /** Transient 2.5D depth offset; positive moves farther, negative moves nearer. */
  dz: number;
}

const SCALE = { major: 0.3, minor: 0.12, entire: 1 } as const;
const DIRECTION: Record<string, number> = { up: 0, down: 180, left: 90, right: 270 };

export function parseRplGenMethodLabel(label: string): ParsedRplGenMotion {
  const parsed: ParsedRplGenMotion = {
    raw: label || 'replace',
    alpha: 'replace',
    motion: 'static',
    directionDeg: 0,
    scale: 'major',
    cutIn: true,
    cutOut: true
  };
  for (const key of (label || 'replace').split('_').filter(Boolean)) {
    if (key === 'replace' || key === 'delay' || key === 'cross' || key === 'black') parsed.alpha = key;
    else if (key === 'pass' || key === 'leap' || key === 'static' || key === 'circular' || key === 'retreat' || key === 'approach' || key.startsWith('shake')) parsed.motion = key as ParsedRplGenMotion['motion'];
    else if (key in DIRECTION) parsed.directionDeg = DIRECTION[key]!;
    else if (key === 'major' || key === 'minor' || key === 'entire') parsed.scale = key;
    else if (key === 'in') { parsed.cutIn = true; parsed.cutOut = false; }
    else if (key === 'out') { parsed.cutIn = false; parsed.cutOut = true; }
    else if (key === 'both') { parsed.cutIn = true; parsed.cutOut = true; }
    else if (/^DG-?\d+(?:\.\d+)?$/i.test(key)) parsed.directionDeg = Number(key.slice(2));
    else if (/^-?\d+(?:\.\d+)?$/.test(key)) parsed.scale = Number(key);
  }
  return parsed;
}

export function parseRplGenMethodToken(token: string | null | undefined, defaultDurationSeconds = 0.5): RplGenMethodSpec | null {
  if (!token) return null;
  const match = token.trim().match(/^<([^=>]+)(?:=(\d+(?:\.\d+)?))?>$/);
  if (!match) return null;
  return {
    name: match[1] || 'replace',
    duration: match[2] ? Math.max(0, Number(match[2]) / 30) : defaultDurationSeconds
  };
}

function curve(name: AnimationCurve, t: number): number { return replayEase(name, Math.max(0, Math.min(1, t))); }

function scalePixels(scale: ParsedRplGenMotion['scale'], directionDeg: number, width: number, height: number): number {
  if (typeof scale === 'number') return scale;
  const theta = directionDeg * Math.PI / 180;
  const axis = Math.sqrt((Math.cos(theta) * height) ** 2 + (Math.sin(theta) * width) ** 2);
  return axis * SCALE[scale];
}

/**
 * Continuous-time adaptation of RplGen MotionMethod.alpha()/motion().
 * The original works with a frame timeline; Replay Lab uses localTime seconds.
 */
export function evaluateRplGenMotion(
  spec: RplGenMethodSpec | null | undefined,
  localTime: number,
  lineDuration: number,
  viewport: { width: number; height: number },
  formula: AnimationCurve = 'linear'
): MotionEvaluation {
  if (!spec) return { alpha: 1, dx: 0, dy: 0, dz: 0 };
  const parsed = parseRplGenMethodLabel(spec.name);
  const d = Math.max(0.001, Math.min(spec.duration || 0.5, lineDuration / 2 || 0.5));
  const inT = Math.max(0, Math.min(1, localTime / d));
  const outT = Math.max(0, Math.min(1, (lineDuration - localTime) / d));
  const inProgress = curve(formula, inT);
  const outProgress = curve(formula, outT);

  let alpha = 1;
  if (parsed.alpha === 'delay' && parsed.cutIn && localTime < d) alpha = 0;
  else if ((parsed.alpha === 'cross' || parsed.alpha === 'black') && parsed.cutIn && localTime < d) alpha *= inProgress;
  if ((parsed.alpha === 'cross' || parsed.alpha === 'black') && parsed.cutOut && lineDuration - localTime < d) alpha *= outProgress;

  const theta = parsed.directionDeg * Math.PI / 180;
  const distance = scalePixels(parsed.scale, parsed.directionDeg, viewport.width, viewport.height);
  const ux = Math.sin(theta);
  const uy = Math.cos(theta);
  let dx = 0, dy = 0, dz = 0;

  if (parsed.motion === 'pass' || parsed.motion === 'leap') {
    if (parsed.cutIn && localTime < d) {
      const p = 1 - inProgress;
      dx += distance * ux * p;
      dy += distance * uy * p;
    }
    if (parsed.cutOut && lineDuration - localTime < d) {
      const p = 1 - outProgress;
      const sign = parsed.motion === 'pass' ? -1 : 1;
      dx += sign * distance * ux * p;
      dy += sign * distance * uy * p;
    }
  } else if (parsed.motion === 'retreat' || parsed.motion === 'approach') {
    // VN-style depth gesture. The actor reaches the target depth during the
    // motion duration, then stays there for the remainder of this authored beat.
    // Persistent blocking still belongs to StageTransform.depth; combine this
    // with a moved Stage snapshot when the character should remain far away.
    const amount = parsed.scale === 'entire' ? 0.9 : parsed.scale === 'minor' ? 0.28 : parsed.scale === 'major' ? 0.58 : Math.max(0, Math.min(1, Math.abs(Number(parsed.scale))));
    const reached = localTime < d ? inProgress : 1;
    dz = (parsed.motion === 'retreat' ? 1 : -1) * amount * reached;
  } else if (parsed.motion.startsWith('shake')) {
    if (parsed.cutIn && localTime < d) {
      const digits = parsed.motion.slice(5);
      const frequency = digits ? Number(digits) / 10 || 1 : 1;
      const x = inT * 10;
      const wave = Math.exp(-0.5 * x) * Math.sin(frequency * 2 * Math.PI * x);
      dx += distance * ux * wave;
      dy += distance * uy * wave;
    }
  } else if (parsed.motion === 'circular') {
    const p = curve(formula, Math.max(0, Math.min(1, localTime / Math.max(0.001, lineDuration))));
    const a = -theta + Math.PI * 2 * p;
    dx += Math.sin(a) * distance;
    dy += -Math.cos(a) * distance;
  }

  return { alpha: Math.max(0, Math.min(1, alpha)), dx, dy, dz };
}
