/*
 * Base phoneme groups adapted from KuchiPaku's MIT-licensed YmmpUtil.cs.
 * Copyright (c) 2022 - InuInu.
 * See ../../licenses/KuchiPaku-MIT.txt and THIRD_PARTY_NOTICES.md.
 *
 * English ARPABET → mouth-shape mapping is ported from the user's earlier
 * LipSync Studio HTML tool (lipsync-tool (23)(1).html). It deliberately keeps
 * that tool's compact visual inventory: A/I/U/E/O + ə/æ/ʊ/ɔ/w/f/th/m.
 *
 * 0.27 promotes that compact inventory into Replay Lab's universal fallback:
 * when a non-English language has no dedicated resolver but the TTS/aligner
 * supplies IPA-like phonemes, visible articulatory classes are mapped onto the
 * same extended visemes before falling back to five vowels or OPEN/CLOSED.
 */
import type { MouthCue, Viseme } from '../core/types.js';
import type { TimedPhoneme, VisemeOptions } from './types.js';

const VOWELS_A = new Set(['a','A','aa','ae','ah','ax','aw','axr','ay']);
const VOWELS_I = new Set(['i','I','ih','iy','y']);
const VOWELS_U = new Set(['u','U','uh','uw']);
const VOWELS_E = new Set(['e','E','eh','ey']);
const VOWELS_O = new Set(['o','O','ao','ow','oy']);
const CLOSE_CONSONANT = new Set(['by','my','ny','py','mm','nn','b','m','n','ng','p','v']);
const OPEN_CONSONANT = new Set(['dy','gy','hy','j','ky','ry','ts','ty','ch','d','dh','f','g','hh','jh','k','l','r','s','sh','t','th','w','z','zh','tt','dd']);
const SILENCE = new Set(['pau','sil','sp','cl','xx','<sil>','<eps>']);

/** Compact English visual inventory used by the user's earlier lip-sync tool. */
export const ENGLISH_EXTRA_VISEMES = ['SCHWA','AE','UU','OO','W','F','TH','M'] as const;

/** Fallback when a dedicated English mouth is absent (old-site rules, except ə → E). */
export const ENGLISH_VISEME_FALLBACK: Record<(typeof ENGLISH_EXTRA_VISEMES)[number], Viseme> = {
  // Lip Studio fell ə back to closed; a relaxed half-open E reads closer.
  SCHWA: 'E',
  AE: 'A',
  UU: 'U',
  OO: 'O',
  W: 'U',
  F: 'CLOSED',
  TH: 'CLOSED',
  M: 'CLOSED'
};

const ARPABET_BASE_MAP: Record<string, Viseme> = {
  // Vowels
  AA: 'A', AE: 'AE', AH: 'SCHWA', AO: 'OO', AW: 'A', AY: 'A',
  EH: 'E', ER: 'SCHWA', EY: 'E', IH: 'I', IY: 'I', OW: 'O', OY: 'O', UH: 'UU', UW: 'U',
  // Consonants that visibly benefit from their own mouth shape
  B: 'M', P: 'M', M: 'M', F: 'F', V: 'F', TH: 'TH', DH: 'TH', W: 'W'
};

const ENGLISH_KEYWORDS: Record<string, Viseme> = {
  schwa: 'SCHWA', ae: 'AE', uu: 'UU', oo: 'OO', w: 'W', f: 'F', th: 'TH', m: 'M'
};

/**
 * IPA / IPA-like phonemes whose *visible articulation* maps cleanly onto the
 * compact English-derived mouth inventory. This is intentionally not a
 * language pronunciation table: it only approximates what the lips need to do.
 */
const UNIVERSAL_EXACT_MAP: Record<string, Viseme> = {
  // Bilabial closure / near-closure.
  p: 'M', b: 'M', m: 'M', 'ɸ': 'M', 'β': 'M', 'ʙ': 'M',
  // Labiodental contact.
  f: 'F', v: 'F', 'ɱ': 'F', 'ʋ': 'F',
  // Dental/interdental tongue visibility.
  'θ': 'TH', 'ð': 'TH', th: 'TH', dh: 'TH',
  // Strong lip rounding approximants.
  w: 'W', 'ʍ': 'W', 'ɥ': 'W',

  // Central / reduced vowels.
  'ə': 'SCHWA', 'ɚ': 'SCHWA', 'ɝ': 'SCHWA', 'ɜ': 'SCHWA', 'ɐ': 'SCHWA',
  'ɘ': 'SCHWA', 'ɨ': 'SCHWA',
  // Rounded central vowels: nearest visible choices in the compact inventory.
  'ɵ': 'OO', 'ɞ': 'OO', 'ʉ': 'UU',

  // Open/front vowels.
  'æ': 'AE', 'ɶ': 'AE',
  a: 'A', 'ɑ': 'A',
  // Front unrounded vowels.
  i: 'I', 'ɪ': 'I', e: 'E', 'ɛ': 'E',
  // Front rounded vowels: lip rounding is more visually important than tongue position.
  y: 'U', 'ʏ': 'UU', 'ø': 'O', 'œ': 'OO',
  // Back / close vowels.
  u: 'U', 'ɯ': 'U', 'ʊ': 'UU', o: 'O', 'ɔ': 'OO', 'ɒ': 'OO',

  // Common ASCII/X-SAMPA-ish aliases used by aligners.
  schwa: 'SCHWA', ax: 'SCHWA', axr: 'SCHWA', er: 'SCHWA',
  ae: 'AE', aa: 'A', ah: 'A', ao: 'OO',
  ih: 'I', iy: 'I', eh: 'E', ey: 'E',
  uh: 'UU', uw: 'U', ow: 'O', oy: 'O'
};

function baseLanguage(language?: string): string {
  return String(language ?? '').trim().toLowerCase().split('-')[0] ?? '';
}

function arpabetBase(token: string): string {
  return token.toUpperCase().replace(/[012]$/, '');
}

function normalizePhonemeToken(raw: string): string {
  return raw
    .trim()
    .normalize('NFD')
    // Visual mouth fallback ignores stress, length, syllable boundaries and
    // most combining diacritics (nasalisation, aspiration, tone, etc.).
    .replace(/[ˈˌːˑ\.·]/gu, '')
    .replace(/[͜͡]/gu, '')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

function containsDistinctiveIpa(token: string): boolean {
  return /[əɚɝɜɐɘɨɵɞʉæɶɑɪɛʏøœɯʊɔɒɸβʙɱʋθðʍɥʷ]/u.test(token);
}

/**
 * Language-agnostic visual phoneme fallback.
 *
 * Returns null when the token has no useful compact-viseme equivalent. The
 * caller can then continue into the older A/I/U/E/O and OPEN/CLOSED policy.
 */
export function universalPhonemeToViseme(phoneme: string): Viseme | null {
  const raw = phoneme.trim();
  if (!raw) return 'SILENCE';
  const lowerRaw = raw.toLowerCase();
  if (SILENCE.has(lowerRaw)) return 'SILENCE';

  const token = normalizePhonemeToken(raw);
  if (!token) return null;

  // Labialisation is visually salient even when the primary consonant is not.
  if (token.includes('ʷ')) return 'W';
  if (UNIVERSAL_EXACT_MAP[token]) return UNIVERSAL_EXACT_MAP[token]!;

  // A few aligners emit diphthongs as one IPA token. Prefer a visually useful
  // endpoint rather than discarding the whole token. Dedicated language rules
  // can replace this later if they need timing-aware interpolation.
  const chars = Array.from(token);
  for (const char of chars) {
    const mapped = UNIVERSAL_EXACT_MAP[char];
    if (mapped && !['M','F','TH','W'].includes(mapped)) return mapped;
  }
  return null;
}

/**
 * Port of the English branch from the user's earlier LipSync Studio.
 * Unknown ARPABET consonants intentionally resolve to CLOSED/idle rather than
 * being guessed open; this preserves that tool's visual behavior.
 */
export function englishPhonemeToViseme(phoneme: string): Viseme {
  const raw = phoneme.trim();
  if (!raw) return 'SILENCE';
  const lower = raw.toLowerCase();
  if (SILENCE.has(lower)) return 'SILENCE';
  if (ENGLISH_KEYWORDS[lower]) return ENGLISH_KEYWORDS[lower]!;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{1,3}[012]?$/.test(upper)) return ARPABET_BASE_MAP[arpabetBase(upper)] ?? 'CLOSED';
  // IPA supplied by an English engine still benefits from the universal layer.
  return universalPhonemeToViseme(raw) ?? 'CLOSED';
}

export function phonemeToViseme(
  phoneme: string,
  consonants: VisemeOptions['consonants'] = 'open-closed',
  language?: string
): Viseme {
  const p = phoneme.trim();
  const lower = p.toLowerCase();
  if (!p || SILENCE.has(lower)) return 'SILENCE';

  const lang = baseLanguage(language);

  // 1) Language-specific resolver: English preserves the user's old ARPABET
  // mapping exactly, while still accepting IPA from engines that use it.
  const upper = p.toUpperCase();
  const base = arpabetBase(upper);
  if (lang === 'en' || (p === upper && ARPABET_BASE_MAP[base] && /^[A-Z]{1,3}[012]?$/.test(upper))) {
    return englishPhonemeToViseme(p);
  }

  // 2) For any explicitly identified non-English language, prefer the compact
  // universal articulatory mapping before five-vowel fallback. This is the
  // policy intended for minority / low-resource languages.
  //
  // With no language metadata, only distinctive IPA symbols trigger this path;
  // plain lowercase LAB tokens retain pre-0.27 compatibility (e.g. m=CLOSED).
  if (lang && lang !== 'auto' && lang !== 'und') {
    const universal = universalPhonemeToViseme(p);
    if (universal) return universal;
  } else if (containsDistinctiveIpa(p)) {
    const universal = universalPhonemeToViseme(p);
    if (universal) return universal;
  }

  // 3) Legacy five-vowel / KuchiPaku-derived groups.
  if (VOWELS_A.has(p) || VOWELS_A.has(lower)) return 'A';
  if (VOWELS_I.has(p) || VOWELS_I.has(lower)) return 'I';
  if (VOWELS_U.has(p) || VOWELS_U.has(lower)) return 'U';
  if (VOWELS_E.has(p) || VOWELS_E.has(lower)) return 'E';
  if (VOWELS_O.has(p) || VOWELS_O.has(lower)) return 'O';

  // 4) Coarse fallback when the phoneme has no useful visual class.
  if (consonants === 'closed') return 'CLOSED';
  if (consonants === 'open') return 'OPEN';
  if (CLOSE_CONSONANT.has(lower)) return 'CLOSED';
  if (OPEN_CONSONANT.has(lower)) return 'OPEN';
  return 'OPEN';
}

export function phonemesToMouthCues(lines: TimedPhoneme[], options: VisemeOptions = {}): MouthCue[] {
  const lead = Math.max(0, options.visualLeadMs ?? 66) / 1000;
  return lines
    .map(line => ({
      start: Math.max(0, line.start - lead),
      end: Math.max(0, line.end - lead),
      viseme: phonemeToViseme(line.phoneme, options.consonants, options.language),
      phoneme: line.phoneme
    }))
    .filter(cue => cue.end > cue.start);
}

export function collapseMouthCues(cues: MouthCue[]): MouthCue[] {
  const result: MouthCue[] = [];
  for (const cue of cues) {
    const previous = result.at(-1);
    if (previous && previous.viseme === cue.viseme && Math.abs(previous.end - cue.start) < 0.02) previous.end = cue.end;
    else result.push({ ...cue });
  }
  return result;
}
