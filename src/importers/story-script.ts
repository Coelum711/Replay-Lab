import { ACTING_PRESETS } from '../core/acting.js';
import { createLine, createProject, ensureCharacter } from '../core/project.js';
import type { ReplayLine, ReplayProject } from '../core/types.js';
import type { ReplayImporter } from './types.js';

function splitCast(value: string): string[] {
  return value.split(/[、,，\s]+/).map(x => x.trim()).filter(Boolean);
}

// Same labels and values as the emotion menu in the voice settings.
const ACTING_STRENGTHS: Record<string, 'subtle' | 'natural' | 'strong'> = {
  轻: 'subtle', 轻微: 'subtle', 自然: 'natural', 强: 'strong', 明显: 'strong'
};

/** `角色[情绪|强度|补充指令]：台词`: known emotions use the menu preset, other words go to the model as written. */
function parseActingTag(tag: string): NonNullable<NonNullable<ReplayLine['speech']>['acting']> {
  // An empty preset stops the character's default emotion leaking into a tagged line.
  const acting: NonNullable<NonNullable<ReplayLine['speech']>['acting']> = { actingPreset: '' };
  const notes: string[] = [];
  for (const part of tag.split(/[|｜]/).map(x => x.trim()).filter(Boolean)) {
    if (ACTING_STRENGTHS[part]) acting.actingStrength = ACTING_STRENGTHS[part];
    else if (ACTING_PRESETS[part] && !acting.actingPreset) acting.actingPreset = ACTING_PRESETS[part];
    else notes.push(part);
  }
  if (notes.length) acting.instruct = notes.join('；');
  return acting;
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
      // `表文 ||| 裏文`: the screen shows the first part, the voice reads the second.
      const [shown, ...spokenParts] = match[2]!.split(/\s*[|｜]{3}\s*/);
      const spoken = spokenParts.join(' ').trim();
      const tagged = speaker.match(/^(.+?)\s*[\[［]([^\]］]+)[\]］]$/);
      const line = append(tagged ? tagged[1]!.trim() : speaker, shown!.trim());
      if (tagged) line.speech = { ...line.speech, acting: parseActingTag(tagged[2]!) };
      if (spoken) line.speech = { ...line.speech, textOverride: spoken };
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
