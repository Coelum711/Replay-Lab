/**
 * Inline kinetic text tags: `{抖}撒手啊{/抖}`. Tags only change how the words are drawn;
 * speech, translation and timing always see the plain text.
 */
export type TextTagKind = 'shake' | 'wave' | 'big' | 'small' | 'pop' | 'rainbow' | 'color';

export interface TextTagRange {
  /** Character offsets (Array.from units) into the plain text, end exclusive. */
  from: number;
  to: number;
  kind: TextTagKind;
  color?: string;
}

const TAGS: Record<string, { kind: TextTagKind; color?: string }> = {
  抖: { kind: 'shake' }, shake: { kind: 'shake' },
  波: { kind: 'wave' }, wave: { kind: 'wave' },
  大: { kind: 'big' }, big: { kind: 'big' },
  小: { kind: 'small' }, small: { kind: 'small' },
  跳: { kind: 'pop' }, pop: { kind: 'pop' },
  彩: { kind: 'rainbow' }, rainbow: { kind: 'rainbow' },
  红: { kind: 'color', color: '#ff5d6c' }, red: { kind: 'color', color: '#ff5d6c' },
  蓝: { kind: 'color', color: '#6cb8ff' }, blue: { kind: 'color', color: '#6cb8ff' },
  金: { kind: 'color', color: '#ffd166' }, gold: { kind: 'color', color: '#ffd166' },
  绿: { kind: 'color', color: '#7be08a' }, green: { kind: 'color', color: '#7be08a' },
  灰: { kind: 'color', color: '#9aa0ad' }, gray: { kind: 'color', color: '#9aa0ad' }
};
export const TEXT_TAG_NAMES = ['抖', '波', '大', '小', '跳', '彩', '红', '蓝', '金', '绿', '灰'];

const TAG_PATTERN = /\{(\/?)([^{}\s]{0,12})\}/g;

/** `{色3}` / `{c3}`: text colour 3 of the window skin (RPG Maker's `\\C[3]`). */
const PALETTE_TAG = /^(?:色|c)(\d{1,2})$/i;
function tagFor(name: string): { kind: TextTagKind; color?: string } | null {
  const palette = PALETTE_TAG.exec(name);
  if (palette && Number(palette[1]) < 32) return { kind: 'color', color: `palette:${Number(palette[1])}` };
  return TAGS[name] ?? TAGS[name.toLowerCase()] ?? null;
}

/** RPG Maker `\\C[n]` switches the colour until the next `\\C[n]`; `\\C[0]` goes back to normal. */
function expandRpgColorCodes(source: string): string {
  if (!/\\C\[\d{1,2}\]/i.test(source)) return source;
  let open: string | null = null;
  const out = source.replace(/\\C\[(\d{1,2})\]/gi, (_, digits: string) => {
    const n = Number(digits);
    let text = open ? `{/${open}}` : '';
    open = n > 0 && n < 32 ? `c${n}` : null;
    if (open) text += `{${open}}`;
    return text;
  });
  return open ? `${out}{/${open}}` : out;
}

/** Plain text plus styled ranges. Unknown `{...}` stays as literal text. */
export function parseTextTags(text: string): { plain: string; ranges: TextTagRange[] } {
  const source = expandRpgColorCodes(String(text ?? ''));
  if (!source.includes('{')) return { plain: source, ranges: [] };
  const ranges: TextTagRange[] = [];
  const open: Array<{ name: string; from: number; kind: TextTagKind; color?: string }> = [];
  let plain = '', length = 0, last = 0;
  for (const match of source.matchAll(TAG_PATTERN)) {
    const [raw, closing, name] = match;
    if (closing ? name !== '' && !tagFor(name!) : !tagFor(name!)) continue;
    const before = source.slice(last, match.index);
    plain += before; length += Array.from(before).length; last = match.index! + raw.length;
    if (closing) {
      // `{/}` closes the newest tag; `{/抖}` closes the newest 抖.
      const at = name ? open.map(item => item.name).lastIndexOf(name) : open.length - 1;
      if (at < 0) continue;
      const [item] = open.splice(at, 1);
      if (length > item!.from) ranges.push({ from: item!.from, to: length, kind: item!.kind, ...(item!.color ? { color: item!.color } : {}) });
    } else {
      const tag = tagFor(name!)!;
      open.push({ name: name!, from: length, kind: tag.kind, ...(tag.color ? { color: tag.color } : {}) });
    }
  }
  const rest = source.slice(last);
  plain += rest; length += Array.from(rest).length;
  for (const item of open) if (length > item.from) ranges.push({ from: item.from, to: length, kind: item.kind, ...(item.color ? { color: item.color } : {}) });
  return { plain, ranges: ranges.sort((a, b) => a.from - b.from) };
}

export function stripTextTags(text: string): string {
  return parseTextTags(text).plain;
}
