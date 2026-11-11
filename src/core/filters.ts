/**
 * Colour grades as parameters. Presets are just starting values, so `/filter 回忆 暗0.7` tweaks a
 * preset and `/filter 自定义 色#ff8800 强0.35` builds one from scratch.
 */
export type FilterBlend = 'normal' | 'multiply' | 'soft-light' | 'screen' | 'overlay';

export interface FilterParams {
  brightness: number; contrast: number; saturate: number; sepia: number; grayscale: number; hue: number; blur: number;
  /** Colour wash painted over the world layer. */
  tint: string; tintAmount: number; blend: FilterBlend;
  vignette: number; vignetteColor: string;
  /** Extra vignette that pulses (the red "danger" throb). */
  pulse: number;
}

export const NEUTRAL_FILTER: FilterParams = { brightness: 1, contrast: 1, saturate: 1, sepia: 0, grayscale: 0, hue: 0, blur: 0, tint: '#000000', tintAmount: 0, blend: 'normal', vignette: 0, vignetteColor: '#000000', pulse: 0 };

/** The built-in looks, expressed as parameters (same look as before they became adjustable). */
export const FILTER_PRESETS: Record<string, FilterParams> = {
  memory: { ...NEUTRAL_FILTER, sepia: 0.75, saturate: 0.8, brightness: 1.04, contrast: 0.92, tint: '#ffecc8', tintAmount: 0.08, vignette: 0.55, vignetteColor: '#281808' },
  night: { ...NEUTRAL_FILTER, brightness: 0.62, saturate: 0.7, hue: -12, contrast: 1.05, tint: '#465aaa', tintAmount: 0.55, blend: 'multiply', vignette: 0.35 },
  dusk: { ...NEUTRAL_FILTER, sepia: 0.3, saturate: 1.25, brightness: 0.92, hue: -12, tint: '#ff8c3c', tintAmount: 0.45, blend: 'soft-light', vignette: 0.25, vignetteColor: '#3c141e' },
  mono: { ...NEUTRAL_FILTER, grayscale: 1, contrast: 1.08, vignette: 0.3 },
  dream: { ...NEUTRAL_FILTER, saturate: 1.25, brightness: 1.08, blur: 1.2, tint: '#ffe6fa', tintAmount: 0.12, vignette: 0.45, vignetteColor: '#fff0ff' },
  vignette: { ...NEUTRAL_FILTER, vignette: 0.72 },
  danger: { ...NEUTRAL_FILTER, saturate: 1.15, contrast: 1.1, vignette: 0.35, vignetteColor: '#aa0014', pulse: 0.25 },
  custom: { ...NEUTRAL_FILTER }
};

type Key = keyof FilterParams;
/** Word prefix → parameter, e.g. `亮0.9`, `色#ff8800`, `混柔光`. */
const PREFIXES: Array<[string, Key]> = [
  ['暗色', 'vignetteColor'], ['色相', 'hue'], ['色', 'tint'], ['强', 'tintAmount'], ['混', 'blend'], ['亮', 'brightness'], ['对', 'contrast'],
  ['饱', 'saturate'], ['旧', 'sepia'], ['灰', 'grayscale'], ['糊', 'blur'], ['暗', 'vignette'], ['闪', 'pulse'],
  ['vigcolor=', 'vignetteColor'], ['hue=', 'hue'], ['tint=', 'tint'], ['amount=', 'tintAmount'], ['blend=', 'blend'], ['brightness=', 'brightness'],
  ['contrast=', 'contrast'], ['saturate=', 'saturate'], ['sepia=', 'sepia'], ['gray=', 'grayscale'], ['blur=', 'blur'], ['vignette=', 'vignette'], ['pulse=', 'pulse']
];
const BLENDS: Record<string, FilterBlend> = { 正常: 'normal', normal: 'normal', 正片叠底: 'multiply', 叠底: 'multiply', multiply: 'multiply', 柔光: 'soft-light', 'soft-light': 'soft-light', 滤色: 'screen', screen: 'screen', 叠加: 'overlay', overlay: 'overlay' };
const BLEND_WORD: Record<FilterBlend, string> = { normal: '正常', multiply: '正片叠底', 'soft-light': '柔光', screen: '滤色', overlay: '叠加' };
const RANGES: Partial<Record<Key, [number, number]>> = { brightness: [0, 3], contrast: [0, 3], saturate: [0, 3], sepia: [0, 1], grayscale: [0, 1], hue: [-180, 180], blur: [0, 12], tintAmount: [0, 1], vignette: [0, 1], pulse: [0, 1] };
const HEX = /^#[0-9a-f]{6}$/i;

/** Parses the words after `/filter <preset>` into full parameters, or reports the first bad word. */
export function parseFilterWords(base: FilterParams, words: string[]): { params: FilterParams } | { error: string } {
  const params = { ...base };
  for (const word of words) {
    const hit = PREFIXES.find(([prefix]) => word.startsWith(prefix));
    if (!hit && HEX.test(word)) { params.tint = word.toLowerCase(); if (!params.tintAmount) params.tintAmount = 0.3; continue; }
    if (!hit) return { error: `看不懂「${word}」。写法例如：色#ff8800 强0.35 混柔光 亮0.9 对1.1 饱0.8 旧0.2 灰0 色相-10 糊1 暗0.5 暗色#000000 闪0.2` };
    const [prefix, key] = hit, raw = word.slice(prefix.length);
    if (key === 'tint' || key === 'vignetteColor') { if (!HEX.test(raw)) return { error: `${prefix} 后面要写 #rrggbb 颜色` }; (params as any)[key] = raw.toLowerCase(); continue; }
    if (key === 'blend') { const blend = BLENDS[raw]; if (!blend) return { error: '混合方式可用：正常 正片叠底 柔光 滤色 叠加' }; params.blend = blend; continue; }
    const value = Number(raw), [lo, hi] = RANGES[key] ?? [0, 1];
    if (!Number.isFinite(value) || value < lo || value > hi) return { error: `${prefix} 要在 ${lo} 到 ${hi} 之间` };
    (params as any)[key] = value;
  }
  return { params };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Words that turn `base` into `params` (only what differs), ready to write after the preset name. */
export function filterOverrideWords(base: FilterParams, params: FilterParams): string[] {
  const out: string[] = [];
  const order: Key[] = ['tint', 'tintAmount', 'blend', 'brightness', 'contrast', 'saturate', 'sepia', 'grayscale', 'hue', 'blur', 'vignette', 'vignetteColor', 'pulse'];
  for (const key of order) {
    const a = base[key], b = params[key];
    if (typeof b === 'number' ? Math.abs((a as number) - b) < 0.0005 : a === b) continue;
    const prefix = PREFIXES.find(([, k]) => k === key)![0];
    out.push(key === 'blend' ? `${prefix}${BLEND_WORD[b as FilterBlend]}` : typeof b === 'number' ? `${prefix}${round(b)}` : `${prefix}${b}`);
  }
  return out;
}

/** Stored value of a /filter command: a plain preset name, or `custom:` + the full parameters. */
export function encodeFilterValue(preset: string, params: FilterParams): string {
  const base = FILTER_PRESETS[preset];
  if (base && preset !== 'custom' && !filterOverrideWords(base, params).length) return preset;
  return `custom:${JSON.stringify({ preset, ...params })}`;
}

export function decodeFilterValue(value: string | null | undefined): { preset: string; params: FilterParams } | null {
  if (!value || value === 'none') return null;
  if (FILTER_PRESETS[value]) return { preset: value, params: { ...FILTER_PRESETS[value]! } };
  if (!value.startsWith('custom:')) return null;
  try {
    const raw = JSON.parse(value.slice(7));
    const preset = typeof raw.preset === 'string' && FILTER_PRESETS[raw.preset] ? raw.preset : 'custom';
    const params = { ...NEUTRAL_FILTER };
    for (const key of Object.keys(NEUTRAL_FILTER) as Key[]) if (raw[key] !== undefined && typeof raw[key] === typeof NEUTRAL_FILTER[key]) (params as any)[key] = raw[key];
    return { preset, params };
  } catch { return null; }
}

export function filterCss(params: FilterParams): string {
  const parts: string[] = [];
  if (params.sepia) parts.push(`sepia(${round(params.sepia)})`);
  if (params.grayscale) parts.push(`grayscale(${round(params.grayscale)})`);
  if (params.saturate !== 1) parts.push(`saturate(${round(params.saturate)})`);
  if (params.brightness !== 1) parts.push(`brightness(${round(params.brightness)})`);
  if (params.contrast !== 1) parts.push(`contrast(${round(params.contrast)})`);
  if (params.hue) parts.push(`hue-rotate(${round(params.hue)}deg)`);
  if (params.blur) parts.push(`blur(${round(params.blur)}px)`);
  return parts.join(' ');
}
