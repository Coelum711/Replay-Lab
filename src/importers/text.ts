import { createLine, createProject } from '../core/project.js';
import type { ReplayImporter } from './types.js';

export interface ParsedRecord { speaker: string; text: string; }

export function parsePlainTextLog(input: string): ParsedRecord[] {
  const raw = input.replace(/\r/g, '').split('\n');
  const out: ParsedRecord[] = [];
  let pendingName = '';

  for (const original of raw) {
    let line = original.replace(/\u00a0/g, ' ').trim();
    if (!line) continue;
    // Drop a leading [timestamp] / [channel] tag, but keep "[Name] message" for the bracket-speaker form below.
    const bracket = line.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (bracket && (/^[\d\s:：\-\/.年月日时分秒]+$/.test(bracket[1]!) || /^[^:：]{1,50}[:：]/.test(bracket[2]!))) line = bracket[2]!;
    if (!line) continue;

    let match = line.match(/^(.{1,50})\s+\d{1,2}:\d{2}(?::\d{2})?$/);
    if (match) {
      pendingName = match[1]!.trim();
      continue;
    }

    match = line.match(/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?\s+(.{1,50})$/);
    if (match) {
      pendingName = match[1]!.trim();
      continue;
    }

    match = line.match(/^([^:：]{1,50})\s*[:：](?!\/\/)\s*(.+)$/);
    if (match) {
      out.push({ speaker: match[1]!.trim(), text: match[2]!.trim() });
      pendingName = '';
      continue;
    }

    if (pendingName) {
      out.push({ speaker: pendingName, text: line });
      pendingName = '';
      continue;
    }

    match = line.match(/^【(.+?)】\s*(.+)$/) ?? line.match(/^\[(.+?)\]\s*(.+)$/) ?? line.match(/^<(.+?)>\s*(.+)$/);
    if (match) {
      out.push({ speaker: match[1]!.trim(), text: match[2]!.trim() });
      continue;
    }

    if (out.length) out[out.length - 1]!.text += `\n${line}`;
    else out.push({ speaker: '旁白', text: line });
  }
  return out.filter(r => r.speaker && r.text);
}

export const TextImporter: ReplayImporter = {
  id: 'plain-text',
  label: 'Plain / QQ-style text log',
  extensions: ['.txt', '.log'],
  sniff(input) {
    if (/<!doctype\s+html|<html[\s>]|<body[\s>]|<\/span>/i.test(input)) return 0.05;
    if (/^[^\n:：]{1,50}[:：].+$/m.test(input)) return 0.8;
    if (/^.{1,50}\s+\d{1,2}:\d{2}(?::\d{2})?$/m.test(input)) return 0.7;
    return input.trim() ? 0.3 : 0;
  },
  parse(input, context) {
    const project = createProject(context?.title ?? context?.sourceName ?? 'Imported text log');
    for (const record of parsePlainTextLog(input)) project.lines.push(createLine(project, record.speaker, record.text));
    return project;
  }
};
