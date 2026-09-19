import type { ReplayLine, ReplayProject } from '../core/types.js';

export interface ScriptOutlineEntry {
  index: number;
  lineId: string;
  chapter: string;
  scene: string;
  chapterStart: boolean;
  sceneStart: boolean;
  chapterKey: string;
  sceneKey: string;
}

export function buildScriptOutline(lines: ReplayLine[]): ScriptOutlineEntry[] {
  let chapter = '未分章';
  let scene = '默认 Scene';
  let chapterOrdinal = 0;
  let sceneOrdinal = 0;
  return lines.map((line, index) => {
    const chapterStart = Boolean(line.chapterTitle);
    if (chapterStart) {
      chapter = line.chapterTitle!.trim() || '未命名 Chapter';
      chapterOrdinal += 1;
      scene = '默认 Scene';
      sceneOrdinal = 0;
    }
    const sceneStart = Boolean(line.sceneTitle);
    if (sceneStart) {
      scene = line.sceneTitle!.trim() || '未命名 Scene';
      sceneOrdinal += 1;
    }
    const chapterKey = `chapter:${chapterOrdinal}:${chapter}`;
    const sceneKey = `${chapterKey}/scene:${sceneOrdinal}:${scene}`;
    return { index, lineId: line.id, chapter, scene, chapterStart, sceneStart, chapterKey, sceneKey };
  });
}

export interface SearchOptions {
  speaker?: boolean;
  text?: boolean;
  chapter?: boolean;
  scene?: boolean;
  type?: boolean;
}

export interface SearchHit {
  index: number;
  lineId: string;
  fields: Array<'speaker' | 'text' | 'chapter' | 'scene' | 'type'>;
}

export function searchReplayLines(project: ReplayProject, query: string, options: SearchOptions = {}): SearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const enabled = {
    speaker: options.speaker ?? true,
    text: options.text ?? true,
    chapter: options.chapter ?? true,
    scene: options.scene ?? true,
    type: options.type ?? true
  };
  const names = new Map(project.characters.map(c => [c.id, c.name]));
  const outline = buildScriptOutline(project.lines);
  const hits: SearchHit[] = [];
  project.lines.forEach((line, index) => {
    const fields: SearchHit['fields'] = [];
    const test = (value: unknown) => String(value ?? '').toLocaleLowerCase().includes(needle);
    if (enabled.speaker && test(names.get(line.speakerId) ?? line.sourceSpeaker)) fields.push('speaker');
    if (enabled.text && test(line.text)) fields.push('text');
    if (enabled.chapter && test(outline[index]?.chapter)) fields.push('chapter');
    if (enabled.scene && test(outline[index]?.scene)) fields.push('scene');
    if (enabled.type && test(line.type)) fields.push('type');
    if (fields.length) hits.push({ index, lineId: line.id, fields });
  });
  return hits;
}
