import type { ReplayProject } from '../core/types.js';

export interface BridgeLine {
  /** One-based position in the project, used as the stable key in pasted replies. */
  number: number;
  lineId: string;
  speakerId?: string;
  speaker: string;
  text: string;
  existing: string;
}

export interface PastePromptOptions {
  targetLanguage: string;
  styleNotes?: string;
}

export interface ParsedReply {
  translations: Map<number, string>;
  missing: number[];
  unexpected: number[];
}

export const PASTE_BATCH_SIZE = 100;

const LANGUAGE_NAMES: Record<string, string> = { ja: '日语', zh: '中文', en: '英语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语', ru: '俄语', it: '意大利语', pt: '葡萄牙语' };

export function languageName(language: string): string {
  const base = language.trim().toLowerCase().split('-')[0] || language;
  return LANGUAGE_NAMES[base] || language;
}

export function collectBridgeLines(project: ReplayProject): BridgeLine[] {
  return project.lines.flatMap((line, index) => {
    if (line.type !== 'dialogue' || !line.text.trim()) return [];
    return [{
      number: index + 1,
      lineId: line.id,
      speakerId: line.speakerId,
      speaker: project.characters.find(character => character.id === line.speakerId)?.name || '未知角色',
      text: line.text,
      existing: line.speech?.textOverride || ''
    }];
  });
}

export function splitBridgeBatches<T>(lines: T[], size = PASTE_BATCH_SIZE): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < lines.length; start += size) batches.push(lines.slice(start, start + size));
  return batches;
}

export function buildPastePrompt(lines: BridgeLine[], options: PastePromptOptions): string {
  const language = languageName(options.targetLanguage);
  return [
    `请把下面的台词翻译成适合配音朗读的${language}口语。这是连续的剧情，请结合上下文理解称呼和语气。`,
    ...(options.styleNotes?.trim() ? [`角色口吻与称呼要求：\n${options.styleNotes.trim()}`] : []),
    '输出规则：',
    '1. 每句一行，格式严格为：#编号｜译文',
    '2. 不要改变编号，不要合并或漏掉句子，不要写说话人名字。',
    '3. 不要添加解释、注音或代码块。',
    '',
    '台词：',
    ...lines.map(line => `#${line.number}｜${line.speaker}：${line.text.replace(/\s*\n\s*/g, ' ')}`)
  ].join('\n');
}

export function parsePasteReply(reply: string, expected: number[]): ParsedReply {
  const wanted = new Set(expected);
  const translations = new Map<number, string>();
  const unexpected: number[] = [];
  for (const raw of reply.replace(/\r/g, '').split('\n')) {
    const match = raw.trim().match(/^#\s*(\d+)\s*[|｜]\s*(.+)$/);
    if (!match) continue;
    const number = Number(match[1]);
    if (!wanted.has(number)) { unexpected.push(number); continue; }
    translations.set(number, match[2]!.trim());
  }
  return { translations, unexpected, missing: expected.filter(number => !translations.has(number)) };
}

/** Keeps a small model from applying one character's speech habits to everyone. */
export function styleNotesFor(notes: string, speaker: string, speakers: string[]): string {
  const others = speakers.filter(name => name !== speaker);
  return notes.split(/[；;\n]+/).map(part => part.trim())
    .filter(part => part && (part.includes(speaker) || !others.some(name => part.includes(name))))
    .join('；');
}

/** Flags the mistakes small models actually make, so a reviewer can look at those rows first. */
export function translationWarnings(text: string, targetLanguage: string): string[] {
  const warnings: string[] = [];
  if (!text.trim()) return ['译文为空'];
  if (/^(ja|ko|zh)/i.test(targetLanguage) && /[A-Za-z]{3,}(?:\s+[A-Za-z]{2,}){2,}/.test(text)) warnings.push('混入英文句子');
  if (/^ja/i.test(targetLanguage)) {
    if (/[这那们么说话对吗为时间谁还没给让开关]/.test(text)) warnings.push('疑似混入中文');
    if (!/[぀-ヿ]/.test(text) && /[\p{Script=Han}]/u.test(text)) warnings.push('没有假名');
  }
  return warnings;
}
