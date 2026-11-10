import { stripTextTags } from '../core/text-tags.js';
import type { ReplayProject } from '../core/types.js';

export function exportYmmScript(project: ReplayProject): string {
  const names = new Map(project.characters.map(c => [c.id, c.name]));
  return project.lines.filter(line => line.type !== 'command').map(line => `${names.get(line.speakerId) ?? 'Unknown'}「${stripTextTags(line.text).replace(/\n/g, ' ')}」`).join('\n') + '\n';
}

export function exportCsvScript(project: ReplayProject): string {
  const names = new Map(project.characters.map(c => [c.id, c.name]));
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return ['Character,Dialogue', ...project.lines.filter(line => line.type !== 'command').map(line => `${quote(names.get(line.speakerId) ?? 'Unknown')},${quote(line.text)}`)].join('\n') + '\n';
}
