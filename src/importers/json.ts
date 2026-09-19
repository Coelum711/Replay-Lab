import { createLine, createProject } from '../core/project.js';
import type { ReplayImporter } from './types.js';

type UnknownRecord = Record<string, unknown>;

function collectRecords(value: unknown): Array<{ speaker: string; text: string }> {
  const out: Array<{ speaker: string; text: string }> = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== 'object') return;
    const obj = node as UnknownRecord;
    const speaker = obj.speaker ?? obj.name ?? obj.character ?? obj.sender ?? obj.user;
    const text = obj.text ?? obj.message ?? obj.content ?? obj.body;
    if (typeof speaker === 'string' && typeof text === 'string') out.push({ speaker, text });
    else Object.values(obj).forEach(walk);
  };
  walk(value);
  return out;
}

export const GenericJsonImporter: ReplayImporter = {
  id: 'generic-json',
  label: 'Generic JSON chat log',
  extensions: ['.json'],
  sniff(input) {
    try {
      const data = JSON.parse(input) as UnknownRecord;
      if (data?.format === 'ReplayLabProject' || data?.format === 'ReplayLabPerformance') return 0;
      return collectRecords(data).length ? 0.65 : 0.1;
    } catch { return 0; }
  },
  parse(input, context) {
    const data = JSON.parse(input) as unknown;
    const project = createProject(context?.title ?? context?.sourceName ?? 'JSON log');
    for (const record of collectRecords(data)) project.lines.push(createLine(project, record.speaker, record.text));
    return project;
  }
};
