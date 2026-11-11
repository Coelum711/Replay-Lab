/*
 * Text → mouth syllables for the text + energy aligner (text-energy.ts).
 *
 * Ported idea: the user's Lip Studio (对口型1.0.html) split romaji into
 * syllables and kept only each syllable's vowel (n/m = idle). Replay Lab has
 * no romaji input, so each script gets its own way to find syllables:
 *   - Chinese: offline per-character pinyin table (data/zh-vowels.ts).
 *   - Japanese: kana → vowel; ん/っ keep the lips idle; ー repeats; kanji have
 *     no offline reading dictionary yet and count as two open morae.
 *   - Korean: Hangul syllables decompose into their medial vowel.
 *   - English: rule-based spelling → ARPABET → englishPhonemeToViseme.
 *   - Other Latin-script languages: vowel letters by spelling.
 */
import type { Viseme } from '../core/types.js';
import { englishPhonemeToViseme } from './viseme.js';
import { ZH_ONSETS, ZH_TABLE_START, ZH_VOWELS } from './data/zh-vowels.js';

export interface MouthSyllable {
  /** null = the syllable takes time but the lips stay idle (ん, っ, n/m). */
  vowel: Viseme | null;
  /** Brief consonant shape before the vowel (M for b/p/m, F for f/v, …). */
  onset?: Viseme;
  text: string;
}

type ZhLetter = 'A' | 'I' | 'U' | 'E' | 'O' | 'S' | 'X';

function zhFinalVowel(f: string): ZhLetter | null {
  if (!f) return null;
  if (f === 'e' || f === 'en' || f === 'eng' || f === 'er') return 'S';
  if (f === 'ian' || f === 'van') return 'E';
  if (f.endsWith('ao')) return 'A';
  if (/(ou|iu|uo)$/.test(f) || f === 'o') return 'O';
  if (f.endsWith('ong')) return 'U';
  if (f.includes('a')) return 'A';
  if (/(ei|ui|ie|ve|ue)$/.test(f)) return 'E';
  if (f === 'i' || f === 'in' || f === 'ing') return 'I';
  if (/^(u|un|uen|ueng|v|vn)$/.test(f)) return 'U';
  if (f.includes('e')) return 'E';
  if (f.includes('i')) return 'I';
  if (f.includes('u') || f.includes('v')) return 'U';
  return null;
}

/** Tone-stripped pinyin syllable → table letters. Exported for the table generator. */
export function pinyinToMouth(raw: string): { vowel: ZhLetter; onset?: 'B' | 'F' } | null {
  const s = raw.toLowerCase().replace(/ü/g, 'v').replace(/[^a-z]/g, '');
  if (!s) return null;
  if (/^(n|m|ng|hm|hng)$/.test(s)) return { vowel: 'X' };
  const match = /^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(.*)$/.exec(s)!;
  const initial = match[1] ?? '';
  let final = match[2] ?? '';
  if (initial === 'y') final = final.startsWith('u') ? 'v' + final.slice(1) : final.startsWith('i') ? final : 'i' + final;
  if (initial === 'w') final = final.startsWith('u') ? final : 'u' + final;
  if ((initial === 'j' || initial === 'q' || initial === 'x') && final.startsWith('u')) final = 'v' + final.slice(1);
  const vowel = zhFinalVowel(final);
  if (!vowel) return null;
  const onset = initial === 'b' || initial === 'p' || initial === 'm' ? 'B' : initial === 'f' ? 'F' : undefined;
  return onset ? { vowel, onset } : { vowel };
}

const ZH_LETTER_TO_VISEME: Record<string, Viseme | null> = { A: 'A', I: 'I', U: 'U', E: 'E', O: 'O', S: 'SCHWA', X: null, '?': 'OPEN' };
const ZH_DIGITS = '零一二三四五六七八九';

function zhCharSyllable(char: string): MouthSyllable {
  const index = (char.codePointAt(0) ?? 0) - ZH_TABLE_START;
  const letter = index >= 0 && index < ZH_VOWELS.length ? ZH_VOWELS[index]! : '?';
  const onsetLetter = index >= 0 && index < ZH_ONSETS.length ? ZH_ONSETS[index]! : '-';
  const syllable: MouthSyllable = { vowel: ZH_LETTER_TO_VISEME[letter] ?? 'OPEN', text: char };
  if (onsetLetter === 'B') syllable.onset = 'M';
  else if (onsetLetter === 'F') syllable.onset = 'F';
  return syllable;
}

// ---------- Japanese kana ----------
const KANA_VOWEL = new Map<string, Viseme>();
for (const [vowel, chars] of [
  ['A', 'あかさたなはまやらわがざだばぱぁゃゎゕ'],
  ['I', 'いきしちにひみりぎじぢびぴぃゐ'],
  ['U', 'うくすつぬふむゆるぐずづぶぷぅゅゔっ'],
  ['E', 'えけせてねへめれげぜでべぺぇゑゖ'],
  ['O', 'おこそとのほもよろをごぞどぼぽぉょ']
] as const) for (const char of chars) KANA_VOWEL.set(char, vowel);
const KANA_BILABIAL = new Set(Array.from('まみむめもばびぶべぼぱぴぷぺぽ'));
const SMALL_GLIDES = new Set(Array.from('ゃゅょぁぃぅぇぉゎ'));
const JA_DIGITS = ['ぜろ', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];

function toHiragana(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  return code >= 0x30A1 && code <= 0x30F6 ? String.fromCodePoint(code - 0x60) : char;
}

function kanaSyllables(run: string, out: MouthSyllable[]): void {
  let previousKana: MouthSyllable | null = null;
  for (const raw of Array.from(run)) {
    const char = toHiragana(raw);
    if (char === 'ー' || char === 'ゝ' || char === 'ゞ') {
      if (previousKana?.vowel) { previousKana = { vowel: previousKana.vowel, text: raw }; out.push(previousKana); }
      continue;
    }
    if (char === 'ん') { previousKana = { vowel: null, text: raw }; out.push(previousKana); continue; }
    if (char === 'っ') { previousKana = { vowel: null, text: raw }; out.push(previousKana); continue; }
    const vowel = KANA_VOWEL.get(char);
    if (!vowel) continue;
    if (SMALL_GLIDES.has(char) && previousKana?.vowel) {
      // きゃ / ファ: the small kana replaces the vowel of the same mora.
      previousKana.vowel = vowel;
      previousKana.text += raw;
      continue;
    }
    previousKana = { vowel, text: raw };
    if (KANA_BILABIAL.has(char)) previousKana.onset = 'M';
    out.push(previousKana);
  }
}

// ---------- Korean ----------
//                ㅏ  ㅐ  ㅑ  ㅒ  ㅓ  ㅔ  ㅕ  ㅖ  ㅗ  ㅘ  ㅙ  ㅚ  ㅛ  ㅜ  ㅝ  ㅞ  ㅟ  ㅠ  ㅡ  ㅢ  ㅣ
const HANGUL_MEDIAL: Viseme[] = ['A','E','A','E','A','E','A','E','O','A','E','E','O','U','A','E','I','U','U','I','I'];
const HANGUL_BILABIAL_INITIAL = new Set([6, 7, 8, 17]); // ㅁ ㅂ ㅃ ㅍ

function hangulSyllable(char: string): MouthSyllable {
  const code = (char.codePointAt(0) ?? 0) - 0xAC00;
  const initial = Math.floor(code / 588), medial = Math.floor((code % 588) / 28);
  const syllable: MouthSyllable = { vowel: HANGUL_MEDIAL[medial] ?? 'OPEN', text: char };
  if (HANGUL_BILABIAL_INITIAL.has(initial)) syllable.onset = 'M';
  return syllable;
}

// ---------- English (rule-based spelling → ARPABET) ----------
const EN_WORDS: Record<string, string[]> = {
  a: ['AH'], an: ['AE'], the: ['TH', 'AH'], i: ['AY'], you: ['UW'], your: ['AO'], to: ['UW'], too: ['UW'], two: ['UW'],
  do: ['UW'], does: ['AH'], done: ['AH'], of: ['AH'], are: ['AA'], was: ['AH'], were: ['ER'], one: ['W', 'AH'],
  once: ['W', 'AH'], who: ['UW'], what: ['W', 'AH'], where: ['W', 'EH'], there: ['TH', 'EH'], their: ['TH', 'EH'],
  they: ['TH', 'EY'], have: ['AE'], give: ['IH'], live: ['IH'], love: ['AH'], come: ['M', 'AH'], some: ['AH'],
  he: ['IY'], she: ['IY'], me: ['M', 'IY'], we: ['W', 'IY'], be: ['M', 'IY'], my: ['M', 'AY'], by: ['M', 'AY'],
  oh: ['OW'], ok: ['OW', 'EY'], okay: ['OW', 'EY'], says: ['EH'], said: ['EH'], been: ['M', 'IH'], eye: ['AY'],
  zero: ['IH', 'OW'], three: ['TH', 'IY'], four: ['F', 'AO'], five: ['F', 'AY'], six: ['IH'], seven: ['EH', 'AH'],
  eight: ['EY'], nine: ['AY']
};
const EN_DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const EN_DIGRAPH: Record<string, string> = {
  ee: 'IY', ea: 'IY', ie: 'IY', ey: 'IY', ai: 'EY', ay: 'EY', ei: 'EY', oo: 'UW', ou: 'AW', oi: 'OY', oy: 'OY',
  oa: 'OW', oe: 'OW', au: 'AO', ue: 'UW', ui: 'UW', eu: 'UW', ia: 'IY', io: 'IY', eo: 'IY'
};
const EN_SHORT: Record<string, string> = { a: 'AE', e: 'EH', i: 'IH', o: 'AA', u: 'AH', y: 'IH' };
const EN_LONG: Record<string, string> = { a: 'EY', e: 'IY', i: 'AY', o: 'OW', u: 'UW', y: 'AY' };

function englishOnset(consonants: string): string | undefined {
  if (!consonants) return undefined;
  if (/th$/.test(consonants)) return 'TH';
  if (/(ph|f|v)$/.test(consonants)) return 'F';
  if (/(qu|wh|w)$/.test(consonants)) return 'W';
  if (/[mbp]$/.test(consonants)) return 'M';
  return undefined;
}

/** Rough spelling-based ARPABET for one English word: [onset?, vowel] pairs flattened. */
export function englishWordToArpabet(word: string): Array<{ onset?: string; vowel: string }> {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return [];
  const known = EN_WORDS[w];
  if (known) {
    const result: Array<{ onset?: string; vowel: string }> = [];
    let onset: string | undefined;
    for (const p of known) {
      if (p === 'M' || p === 'F' || p === 'TH' || p === 'W') onset = p;
      else { result.push(onset ? { onset, vowel: p } : { vowel: p }); onset = undefined; }
    }
    return result;
  }
  let s = w, magic = false;
  // Silent final e ("make", "time"), but not "-le" ("table") or vowel+e ("free").
  if (s.length > 2 && s.endsWith('e') && !/[aeiouy]e$/.test(s) && !s.endsWith('le') && /[aeiouy]/.test(s.slice(0, -2))) { s = s.slice(0, -1); magic = true; }
  // Plural/past "-es"/"-ed" after a magic-e stem ("makes", "named").
  else if (/[^aeiouy][aeiouy][^aeiouy](es|ed)$/.test(s) && !/(ses|zes|ches|shes|ted|ded)$/.test(s)) { s = s.slice(0, -2); magic = true; }
  const clusters: Array<{ start: number; text: string }> = [];
  for (const m of s.matchAll(/[aeiouy]+/g)) {
    let text = m[0], start = m.index ?? 0;
    if (start === 0 && text.startsWith('y') && text.length > 1) { text = text.slice(1); start += 1; }
    if (text === 'y' && start === 0) continue;
    clusters.push({ start, text });
  }
  const result: Array<{ onset?: string; vowel: string }> = [];
  let consumed = 0;
  clusters.forEach((cluster, index) => {
    const consonants = s.slice(consumed, cluster.start);
    consumed = cluster.start + cluster.text.length;
    const next = s[consumed] ?? '';
    const last = index === clusters.length - 1;
    let vowel: string;
    const t = cluster.text;
    if (t.length >= 2) vowel = EN_DIGRAPH[t.slice(0, 2)] ?? EN_SHORT[t[0]!] ?? 'AH';
    else if (next === 'r' && 'aeiou'.includes(t)) vowel = t === 'a' ? 'AA' : t === 'o' ? 'AO' : 'ER';
    else if (t === 'o' && next === 'w') vowel = 'OW';
    else if (t === 'a' && next === 'w') vowel = 'AO';
    else if (t === 'e' && next === 'w') vowel = 'UW';
    else if (t === 'o' && last && consumed === s.length && !magic) vowel = 'OW';
    else if (t === 'y') vowel = clusters.length === 1 ? 'AY' : last ? 'IY' : 'IH';
    else if (last && magic) vowel = EN_LONG[t] ?? 'AH';
    else if (last && t === 'e' && consumed === s.length && clusters.length === 1) vowel = 'IY';
    else vowel = EN_SHORT[t] ?? 'AH';
    const onset = englishOnset(consonants);
    result.push(onset ? { onset, vowel } : { vowel });
  });
  return result;
}

function englishSyllables(word: string, out: MouthSyllable[]): void {
  for (const part of englishWordToArpabet(word)) {
    const syllable: MouthSyllable = { vowel: englishPhonemeToViseme(part.vowel), text: word };
    if (part.onset) syllable.onset = englishPhonemeToViseme(part.onset);
    out.push(syllable);
  }
}

// ---------- Other Latin-script languages ----------
function genericLatinSyllables(word: string, language: string, out: MouthSyllable[]): void {
  let w = word.toLowerCase().replace(/ü/g, 'u').replace(/ö|ø|œ/g, 'o').replace(/ä|æ/g, 'e').normalize('NFD').replace(/\p{M}+/gu, '');
  if (language === 'fr') w = w.replace(/(?<=[a-z][^aeiouy])(e|es|ent)$/, '');
  let consumed = 0;
  for (const m of w.matchAll(/[aeiouy]+/g)) {
    const start = m.index ?? 0, t = m[0];
    const consonants = w.slice(consumed, start);
    consumed = start + t.length;
    let vowel: Viseme;
    if (t.startsWith('ou')) vowel = 'U';
    else if (t.startsWith('eau') || t.startsWith('au')) vowel = 'O';
    else if (t.startsWith('oi')) vowel = 'A';
    else vowel = ({ a: 'A', e: 'E', i: 'I', o: 'O', u: 'U', y: 'I' } as Record<string, Viseme>)[t[0]!] ?? 'OPEN';
    const syllable: MouthSyllable = { vowel, text: word };
    if (/[mbp]$/.test(consonants)) syllable.onset = 'M';
    else if (/[fv]$/.test(consonants)) syllable.onset = 'F';
    out.push(syllable);
  }
}

function baseLanguage(language?: string): string {
  return String(language ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

const TOKEN = /(\p{Script=Han}|[々〆])|([぀-ヿㇰ-ㇿ]+)|(\p{Script=Hangul})|([\p{Script=Latin}]+(?:['’][\p{Script=Latin}]+)*)|(\d)/gu;

/**
 * Splits spoken text into mouth syllables. `language` is a BCP-47 tag (or
 * empty/auto); the script of each character decides how it is read.
 */
export function textToMouthSyllables(text: string, language?: string): MouthSyllable[] {
  const normalized = String(text ?? '').normalize('NFKC');
  const lang = baseLanguage(language);
  const japanese = lang === 'ja' || (lang !== 'zh' && /[぀-ヿ]/.test(normalized));
  const out: MouthSyllable[] = [];
  for (const m of normalized.matchAll(TOKEN)) {
    const [, han, kana, hangul, latin, digit] = m;
    if (han) {
      if (japanese) {
        // No offline kanji reading dictionary: an average kanji reading is ~2 morae.
        out.push({ vowel: 'OPEN', text: han }, { vowel: 'OPEN', text: han });
      } else out.push(zhCharSyllable(han === '々' ? (out.at(-1)?.text ?? han) : han));
    } else if (kana) kanaSyllables(kana, out);
    else if (hangul) out.push(hangulSyllable(hangul));
    else if (latin) {
      if (lang === 'en' || lang === 'zh' || lang === 'ja' || lang === 'ko' || !lang || lang === 'auto' || lang === 'und') englishSyllables(latin, out);
      else genericLatinSyllables(latin, lang, out);
    } else if (digit) {
      const d = Number(digit);
      if (japanese) kanaSyllables(JA_DIGITS[d]!, out);
      else if (lang === 'zh' || (!lang && /\p{Script=Han}/u.test(normalized))) out.push(zhCharSyllable(ZH_DIGITS[d]!));
      else if (lang === 'ko') out.push({ vowel: 'OPEN', text: digit });
      else englishSyllables(EN_DIGITS[d]!, out);
    }
  }
  return out;
}
