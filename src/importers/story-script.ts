import { createLine, createProject, ensureCharacter } from '../core/project.js';
import type { ReplayProject } from '../core/types.js';
import type { ReplayImporter } from './types.js';

function splitCast(value: string): string[] {
  return value.split(/[、,，\s]+/).map(x => x.trim()).filter(Boolean);
}

/**
 * Import prose/VN-like scripts without forcing authors to rewrite them as chat logs.
 * Bare prose becomes narration; scene/cast declarations become structural metadata.
 */
export function parseStoryScript(input: string, title = 'Imported story script'): ReplayProject {
  const project = createProject(title);
  const rows = input.replace(/\r/g, '').split('\n');
  let sceneTitle = '';
  let pendingSceneTitle = '';
  let castNames: string[] = [];
  let pendingCastBoundary = false;

  const append = (speaker: string, text: string, type?: 'dialogue' | 'narration' | 'system') => {
    const line = createLine(project, speaker, text, type);
    if (pendingSceneTitle) { line.sceneTitle = pendingSceneTitle; pendingSceneTitle = ''; }
    if (castNames.length) {
      const castIds = castNames.map(name => ensureCharacter(project, name).id);
      // `角色：` declares who belongs to the scene/script context. It must not mean
      // “put everybody on screen right now”; auto staging should follow the active
      // conversation unless the author explicitly edits the stage roster later.
      line.metadata ??= {};
      line.metadata.declaredCastIds = [...castIds];
      line.metadata.declaredCastNames = [...castNames];
      if (pendingCastBoundary) pendingCastBoundary = false;
    }
    project.lines.push(line);
    return line;
  };

  for (const original of rows) {
    const row = original.replace(/\u00a0/g, ' ').trim();
    if (!row) continue;

    let match = row.match(/^当前场景\s*[:：]\s*(.+)$/);
    if (match) {
      sceneTitle = match[1]!.trim();
      pendingSceneTitle = sceneTitle;
      pendingCastBoundary = true;
      continue;
    }
    match = row.match(/^角色\s*[:：]\s*(.+)$/);
    if (match) {
      castNames = splitCast(match[1]!);
      for (const name of castNames) ensureCharacter(project, name);
      pendingCastBoundary = true;
      continue;
    }
    if (/^【.*】$/.test(row) || /^\[.*\]$/.test(row)) {
      append('旁白', row, 'narration');
      continue;
    }
    match = row.match(/^([^:：]{1,50})\s*[:：]\s*(.+)$/);
    if (match) {
      const speaker = match[1]!.trim();
      // Avoid accidentally creating pseudo-characters for unsupported metadata.
      if (speaker === '当前场景') { sceneTitle = match[2]!.trim(); pendingSceneTitle = sceneTitle; pendingCastBoundary = true; continue; }
      if (speaker === '角色') { castNames = splitCast(match[2]!); castNames.forEach(name => ensureCharacter(project, name)); pendingCastBoundary = true; continue; }
      append(speaker, match[2]!.trim());
      continue;
    }
    append('旁白', row, 'narration');
  }

  return project;
}

export const StoryScriptImporter: ReplayImporter = {
  id: 'story-script',
  label: '剧情台本 / 伪 TRPG 文游',
  extensions: ['.txt', '.log', '.md'],
  sniff(input) {
    let score = 0;
    if (/^当前场景\s*[:：]/m.test(input)) score += 0.55;
    if (/^角色\s*[:：]/m.test(input)) score += 0.25;
    if (/^【.*】$/m.test(input)) score += 0.15;
    const bare = input.split(/\r?\n/).filter(line => line.trim() && !/^[^:：]{1,50}[:：]/.test(line.trim())).length;
    if (bare >= 2) score += 0.12;
    return Math.min(0.98, score);
  },
  parse(input, context) {
    return parseStoryScript(input, context?.title ?? context?.sourceName ?? 'Imported story script');
  }
};
