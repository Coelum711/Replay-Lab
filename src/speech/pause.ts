import type { PunctuationPauseKey, PunctuationPauseTiming, ReplayLine, ReplayProject } from '../core/types.js';

export interface SpeechPauseSegment {
  text: string;
  /** Extra silence inserted after this segment. Punctuation itself remains in text. */
  pauseAfter: number;
  kind: 'none' | 'comma' | 'sentence' | 'question' | 'exclamation' | 'ellipsis' | 'semicolon' | 'colon' | 'manual';
}

const MANUAL_BASE_SECONDS = 0.36;
const DEFAULT_PUNCTUATION_SECONDS: Record<PunctuationPauseKey, number> = {
  comma: 0,
  period: 0.12,
  question: 0.12,
  exclamation: 0.12,
  ellipsis: 0.24,
  semicolon: 0,
  colon: 0
};

export function clampSpeechPauseScale(value: unknown, fallback = 1): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : fallback;
}

function clampPauseSeconds(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : fallback;
}

export function resolveSpeechPauseScale(project: ReplayProject, line: ReplayLine): number {
  const character = project.characters.find(c => c.id === line.speakerId);
  return clampSpeechPauseScale(
    line.speech?.pauseScale ?? character?.speech?.pauseScale ?? project.settings.speechPauseScale,
    1
  );
}

export function resolvePunctuationPauseTiming(_project: ReplayProject, line: ReplayLine): PunctuationPauseTiming | undefined {
  return line.speech?.punctuationPauses ?? undefined;
}

function configuredPauseSeconds(config: PunctuationPauseTiming | undefined, key: PunctuationPauseKey, legacyScale: number): number {
  if (!config) return DEFAULT_PUNCTUATION_SECONDS[key] * legacyScale;
  if (config.mode === 'uniform') return clampPauseSeconds(config.uniformSeconds, 0);
  return clampPauseSeconds(config[key], 0);
}

function sentenceClusterKey(cluster: string): PunctuationPauseKey {
  if (/[?？]/.test(cluster) && /[!！]/.test(cluster)) return 'question';
  if (/[?？]/.test(cluster)) return 'question';
  if (/[!！]/.test(cluster)) return 'exclamation';
  return 'period';
}

function segmentKind(key: PunctuationPauseKey): SpeechPauseSegment['kind'] {
  if (key === 'period') return 'sentence';
  return key;
}

/**
 * Manual pause syntax lives in the spoken-text layer, not display text:
 *   /   => pause marker
 *   \/  => literal slash
 *
 * Custom punctuation timing stores exact human-authored seconds. Repeated punctuation
 * (?!, !!!, …… and ...) is treated as one cluster rather than accumulating each glyph.
 * Legacy projects retain the old sentence/ellipsis gaps multiplied by pauseScale.
 */
export function planSpeechPauses(input: string, scale = 1, punctuation?: PunctuationPauseTiming): SpeechPauseSegment[] {
  const strength = clampSpeechPauseScale(scale, 1);
  if (!input) return [{ text: '', pauseAfter: 0, kind: 'none' }];
  const out: SpeechPauseSegment[] = [];
  let buffer = '';
  const push = (pauseAfter: number, kind: SpeechPauseSegment['kind']) => {
    if (buffer || !out.length) out.push({ text: buffer, pauseAfter: Math.max(0, pauseAfter), kind });
    else if (out.length) out[out.length - 1]!.pauseAfter += Math.max(0, pauseAfter);
    buffer = '';
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (ch === '\\' && input[i + 1] === '/') { buffer += '/'; i += 1; continue; }
    if (ch === '/') { push(MANUAL_BASE_SECONDS * strength, 'manual'); continue; }

    if (ch === '…') {
      buffer += ch;
      while (input[i + 1] === '…') buffer += input[++i]!;
      push(configuredPauseSeconds(punctuation, 'ellipsis', strength), 'ellipsis');
      continue;
    }
    if (ch === '.' && input.slice(i, i + 3) === '...') {
      buffer += '...'; i += 2;
      while (input.slice(i + 1, i + 4) === '...') { buffer += '...'; i += 3; }
      push(configuredPauseSeconds(punctuation, 'ellipsis', strength), 'ellipsis');
      continue;
    }

    if ('。！？!?'.includes(ch)) {
      let cluster = ch;
      buffer += ch;
      while (i + 1 < input.length && '。！？!?'.includes(input[i + 1]!)) { const next = input[++i]!; cluster += next; buffer += next; }
      const key = sentenceClusterKey(cluster);
      push(configuredPauseSeconds(punctuation, key, strength), punctuation ? segmentKind(key) : 'sentence');
      continue;
    }

    if (ch === '.') {
      const prev = input[i - 1] ?? '', next = input[i + 1] ?? '';
      buffer += ch;
      if (!(/\d/.test(prev) && /\d/.test(next))) push(configuredPauseSeconds(punctuation, 'period', strength), 'sentence');
      continue;
    }
    if (ch === ',' || ch === '，') { buffer += ch; push(configuredPauseSeconds(punctuation, 'comma', strength), 'comma'); continue; }
    if (ch === ';' || ch === '；') { buffer += ch; push(configuredPauseSeconds(punctuation, 'semicolon', strength), 'semicolon'); continue; }
    if (ch === ':' || ch === '：') { buffer += ch; push(configuredPauseSeconds(punctuation, 'colon', strength), 'colon'); continue; }
    buffer += ch;
  }
  if (buffer || !out.length) out.push({ text: buffer, pauseAfter: 0, kind: 'none' });
  return out;
}

export function speechPauseExtraSeconds(input: string, scale = 1, punctuation?: PunctuationPauseTiming): number {
  return planSpeechPauses(input, scale, punctuation).reduce((sum, segment) => sum + segment.pauseAfter, 0);
}

/** Generic providers that do not implement explicit pauses should never be asked to speak '/'. */
export function speechTextForGenericTts(input: string): string {
  return input.replace(/\\\//g, '\u0000').replace(/\s*\/\s*/g, ' … ').replace(/\u0000/g, '/');
}
