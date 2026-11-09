import { createLine, createProject } from '../core/project.js';
import type { ReplayImporter } from './types.js';
import type { ParsedRecord } from './text.js';

function decodeEntities(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/<[^>]+>/g, '')
    .trim();
}

export function parseCocofoliaHtml(input: string): ParsedRecord[] {
  const out: ParsedRecord[] = [];

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(input, 'text/html');
    const semantic = [...doc.querySelectorAll('.player, li.player')];
    for (const node of semantic) {
      const speaker = node.querySelector('.speaker-text')?.textContent
        ?? node.querySelector('.speaker')?.textContent
        ?? node.querySelector('b')?.textContent
        ?? 'Unknown';
      let text = node.querySelector('.player-message')?.textContent ?? '';
      if (!text) {
        const clone = node.cloneNode(true) as Element;
        clone.querySelectorAll('.speaker,.speaker-text,b').forEach(n => n.remove());
        text = clone.textContent ?? '';
      }
      if (speaker.trim() && text.trim()) out.push({ speaker: speaker.trim(), text: text.trim() });
    }
    if (out.length) return out;

    for (const p of [...doc.querySelectorAll('p')]) {
      const spans = [...p.querySelectorAll(':scope > span')];
      if (spans.length >= 3) {
        const speaker = spans[1]?.textContent?.trim() ?? '';
        const text = spans.slice(2).map(s => s.textContent ?? '').join('').trim();
        if (speaker && text) out.push({ speaker, text });
      }
    }
    if (out.length) return out;
  }

  // Fallback for Node/tests: semantic HTML emitted by ccfolia-chatlog-formatter.
  const liPattern = /<li\b[^>]*class=["'][^"']*\bplayer\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  for (const liMatch of input.matchAll(liPattern)) {
    const body = liMatch[1] ?? '';
    const speaker = body.match(/class=["'][^"']*speaker-text[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]
      ?? body.match(/<b[^>]*>([\s\S]*?)<\/b>/i)?.[1]
      ?? '';
    const text = body.match(/class=["'][^"']*player-message[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '';
    if (speaker && text) out.push({ speaker: decodeEntities(speaker), text: decodeEntities(text) });
  }
  if (out.length) return out;

  // Classic Cocofolia: <p><span>[main]</span><span>Name</span><span>message</span></p>
  const pPattern = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  for (const pMatch of input.matchAll(pPattern)) {
    const spans = [...(pMatch[1] ?? '').matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map(m => decodeEntities(m[1] ?? ''));
    if (spans.length >= 3 && spans[1] && spans.slice(2).join('')) out.push({ speaker: spans[1], text: spans.slice(2).join('') });
  }
  return out;
}

export const CocofoliaImporter: ReplayImporter = {
  id: 'ccfolia-html',
  label: 'Cocofolia HTML',
  extensions: ['.html', '.htm'],
  sniff(input) {
    let score = 0;
    if (/class=["'][^"']*player-message/i.test(input)) score += 0.6;
    if (/class=["'][^"']*speaker-text/i.test(input)) score += 0.3;
    if (/<span[^>]*>\s*\[(main|メイン)/i.test(input)) score += 0.2;
    if (/<p\b[^>]*>\s*<span\b[^>]*>[\s\S]*?<\/span>\s*<span\b/i.test(input)) score += 0.4;
    return Math.min(1, score);
  },
  parse(input, context) {
    const project = createProject(context?.title ?? context?.sourceName ?? 'Cocofolia log');
    for (const record of parseCocofoliaHtml(input)) project.lines.push(createLine(project, record.speaker, record.text));
    return project;
  }
};
