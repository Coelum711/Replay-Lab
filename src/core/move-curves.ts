/**
 * How a character gets from where they stood on the previous line to where they stand now:
 * a cut (the old behaviour) or a move with a duration, a delay and a speed curve.
 * Curves are cubic Béziers like CSS / After Effects (y may leave 0..1 for overshoot),
 * plus a spring that settles with a wobble.
 */
export interface StageMove {
  mode: 'cut' | 'move';
  /** Seconds the move takes. */
  duration: number;
  /** Seconds into the line before the move starts. */
  delay: number;
  /** A preset key (`easeOut`, `snap` …) or `bezier(x1,y1,x2,y2)`. */
  curve: string;
}

export type Bezier = [number, number, number, number];

export const MOVE_CURVE_PRESETS: ReadonlyArray<{ key: string; label: string; bezier: Bezier | null; hint: string }> = [
  { key: 'linear', label: '线性', bezier: [0, 0, 1, 1], hint: '匀速' },
  { key: 'easeIn', label: '缓入', bezier: [0.42, 0, 1, 1], hint: '慢慢起步，越来越快' },
  { key: 'easeOut', label: '缓出', bezier: [0, 0, 0.58, 1], hint: '一下冲出去，慢慢停下' },
  { key: 'easeInOut', label: '缓入缓出', bezier: [0.42, 0, 0.58, 1], hint: '两头慢中间快' },
  { key: 'whip', label: '猛冲', bezier: [0.7, 0, 0.1, 1], hint: '几乎不动，然后猛地到位' },
  { key: 'snap', label: '急停', bezier: [0.2, 1.6, 0.35, 1], hint: '冲过头再弹回来' },
  { key: 'anticipate', label: '蓄力', bezier: [0.55, -0.55, 0.6, 1], hint: '先往反方向收一下再冲出去' },
  { key: 'spring', label: '弹簧', bezier: null, hint: '到位后来回晃两下' }
];

export const DEFAULT_STAGE_MOVE: StageMove = { mode: 'cut', duration: 0.3, delay: 0, curve: 'easeOut' };

const BEZIER = /^(?:bezier|曲线)\(\s*(-?[\d.]+)\s*[,，]\s*(-?[\d.]+)\s*[,，]\s*(-?[\d.]+)\s*[,，]\s*(-?[\d.]+)\s*\)$/i;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number) => Math.round(v * 1000) / 1000;

/** Control points for a curve, or null for curves that are not Béziers (spring). */
export function curveBezier(curve: string | null | undefined): Bezier | null {
  const preset = MOVE_CURVE_PRESETS.find(p => p.key === curve);
  if (preset) return preset.bezier ? [...preset.bezier] as Bezier : null;
  const m = BEZIER.exec(String(curve ?? '').trim());
  if (!m) return [0, 0, 0.58, 1];
  const [x1, y1, x2, y2] = m.slice(1).map(Number) as Bezier;
  return [clamp(x1, 0, 1), clamp(y1, -2, 3), clamp(x2, 0, 1), clamp(y2, -2, 3)];
}

export function bezierCurve(points: Bezier): string {
  return `bezier(${points.map(round).join(',')})`;
}

/** A curve name as the user types it: preset label/key or `曲线(a,b,c,d)`. Null when not a curve. */
export function parseMoveCurve(word: string): string | null {
  const text = word.trim();
  const preset = MOVE_CURVE_PRESETS.find(p => p.label === text || p.key.toLowerCase() === text.toLowerCase());
  if (preset) return preset.key;
  if (BEZIER.test(text)) return bezierCurve(curveBezier(text)!);
  return null;
}

/** How a curve is written back into a command: preset label or `曲线(a,b,c,d)`. */
export function formatMoveCurve(curve: string): string {
  const preset = MOVE_CURVE_PRESETS.find(p => p.key === curve);
  if (preset) return preset.label;
  const points = curveBezier(curve);
  return points ? `曲线(${points.map(round).join(',')})` : '缓出';
}

/** Value of a cubic Bézier (0,0)-(x1,y1)-(x2,y2)-(1,1) at time t, solving x(s) = t. */
function bezierAt([x1, y1, x2, y2]: Bezier, t: number): number {
  const coord = (a: number, b: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  const slope = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s * s;
  let s = t;
  for (let i = 0; i < 8; i++) {
    const dx = coord(x1, x2, s) - t, d = slope(x1, x2, s);
    if (Math.abs(dx) < 1e-6) break;
    if (Math.abs(d) < 1e-6) break;
    s = clamp(s - dx / d, 0, 1);
  }
  if (Math.abs(coord(x1, x2, s) - t) > 1e-4) { // Newton stalled: bisect.
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) { s = (lo + hi) / 2; if (coord(x1, x2, s) < t) lo = s; else hi = s; }
  }
  return coord(y1, y2, s);
}

/** Eased progress for t in 0..1. May go below 0 or above 1 (overshoot, anticipation, spring). */
export function moveCurveValue(curve: string, t: number): number {
  const x = clamp(t, 0, 1);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (curve === 'spring') return 1 - Math.exp(-6 * x) * Math.cos(14 * x) * (1 - x * x * x);
  return bezierAt(curveBezier(curve)!, x);
}

/** Progress of a move at `localTime` seconds into the line, or null when it is a cut. */
export function stageMoveProgress(move: StageMove | null | undefined, localTime: number): number | null {
  if (!move || move.mode !== 'move' || !(move.duration > 0)) return null;
  return moveCurveValue(move.curve, (localTime - Math.max(0, move.delay || 0)) / move.duration);
}

/** Cleans a stored move; anything unusable falls back to the defaults. */
export function normalizeStageMove(raw: unknown): StageMove | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<StageMove>;
  const duration = Number(r.duration), delay = Number(r.delay);
  const curve = typeof r.curve === 'string' && (MOVE_CURVE_PRESETS.some(p => p.key === r.curve) || BEZIER.test(r.curve)) ? r.curve : DEFAULT_STAGE_MOVE.curve;
  return {
    mode: r.mode === 'move' ? 'move' : 'cut',
    duration: Number.isFinite(duration) ? clamp(duration, 0.02, 10) : DEFAULT_STAGE_MOVE.duration,
    delay: Number.isFinite(delay) ? clamp(delay, 0, 30) : 0,
    curve
  };
}

/**
 * Words after `/move 角色 站位`: `0.25s` (or `0.25秒`) duration, `延迟0.5` delay, a curve name.
 * Returns null when nothing move-related was written (the move stays a cut).
 */
export function parseMoveWords(words: string[]): { move: StageMove | null } | { error: string } {
  let duration: number | null = null, delay = 0, curve: string | null = null;
  for (const word of words) {
    const seconds = /^(\d+(?:\.\d+)?)(?:s|秒)?$/i.exec(word);
    const wait = /^(?:延迟|delay=?)(\d+(?:\.\d+)?)(?:s|秒)?$/i.exec(word);
    if (wait) { delay = Number(wait[1]); continue; }
    if (seconds) { duration = Number(seconds[1]); continue; }
    if (word === '瞬移' || word.toLowerCase() === 'cut') { duration = 0; continue; }
    const named = parseMoveCurve(word);
    if (named) { curve = named; continue; }
    return { error: `看不懂「${word}」。例如：/move 亚瑟 右 0.25s 急停 延迟0.5（曲线可写 ${MOVE_CURVE_PRESETS.map(p => p.label).join('、')} 或 曲线(.2,1.6,.35,1)）` };
  }
  if (duration === 0 || (duration == null && !curve)) return { move: null };
  return { move: normalizeStageMove({ mode: 'move', duration: duration ?? DEFAULT_STAGE_MOVE.duration, delay, curve: curve ?? DEFAULT_STAGE_MOVE.curve }) };
}

export function formatMoveWords(move: StageMove | null | undefined): string {
  if (!move || move.mode !== 'move') return '';
  return [`${round(move.duration)}s`, formatMoveCurve(move.curve), move.delay ? `延迟${round(move.delay)}` : ''].filter(Boolean).join(' ');
}
