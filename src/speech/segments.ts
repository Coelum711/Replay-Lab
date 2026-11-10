import type { ReplayLine, SpeechSegment } from '../core/types.js';

/** Splits spoken text after sentence punctuation; tiny pieces merge into their neighbour. */
export function splitSpeechSegments(text: string, minChars = 3): SpeechSegment[] {
  const pieces = String(text ?? '').match(/[^。！？!?、，,…～~\n]+[。！？!?、，,…～~\n]*|[。！？!?、，,…～~\n]+/g) ?? [];
  const out: string[] = [];
  for (const piece of pieces.map(value => value.replace(/\n/g, '')).filter(Boolean)) {
    const spoken = (piece.match(/[\p{L}\p{N}]/gu) ?? []).length;
    if (out.length && spoken < minChars) out[out.length - 1] += piece;
    else out.push(piece);
  }
  // A short first piece ("おい！") stays alone on purpose: it is usually the shout before a sentence.
  return out.map(value => ({ text: value }));
}

const squash = (value: string) => String(value ?? '').replace(/\s+/g, '');

/** Usable segments for this spoken text, or null; throws when they no longer match the line. */
export function activeSegments(line: ReplayLine, spokenText: string): SpeechSegment[] | null {
  const segments = line.speech?.segments?.filter(segment => squash(segment.text));
  if (!segments?.length) return null;
  if (squash(segments.map(segment => segment.text).join('')) !== squash(spokenText))
    throw new Error('分段文字和这句的朗读文本不一致（可能改过台词或裏文），请在「分段表演」里重新分段。');
  return segments;
}

export function segmentsNeedInstruct(line: ReplayLine): boolean {
  return !!line.speech?.segments?.some(segment => segment.instruct?.trim());
}
