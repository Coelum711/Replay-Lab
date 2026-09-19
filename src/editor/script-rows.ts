import type { ReplayProject } from '../core/types.js';
import { buildDirectorBeats } from '../core/beats.js';
import { buildScriptOutline, type SearchHit } from './outline.js';

export type ScriptRenderRow =
  | { kind: 'chapter'; key: string; label: string; lineIndex: number; collapsed: boolean; estimateSize: number }
  | { kind: 'scene'; key: string; label: string; lineIndex: number; collapsed: boolean; estimateSize: number }
  | { kind: 'beat'; key: string; label: string; lineIndex: number; endIndex: number; collapsed: boolean; active: boolean; selected: boolean; count: number; estimateSize: number }
  | { kind: 'line'; key: string; lineId: string; lineIndex: number; selected: boolean; active: boolean; hit: boolean; estimateSize: number };

export interface ScriptRenderRowOptions {
  collapsedGroups?: Iterable<string>;
  selectedLineIds?: Iterable<string>;
  activeIndex?: number;
  searchHits?: SearchHit[];
}

/** Flatten hierarchical Chapter/Scene/Beat/line state into UI rows. */
export function buildScriptRenderRows(project: ReplayProject, options: ScriptRenderRowOptions = {}): ScriptRenderRow[] {
  const collapsed = new Set(options.collapsedGroups ?? []);
  const selected = new Set(options.selectedLineIds ?? []);
  const hitIndices = new Set((options.searchHits ?? []).map(hit => hit.index));
  const outline = buildScriptOutline(project.lines);
  const beats = buildDirectorBeats(project);
  const beatByStart = new Map(beats.map(beat => [beat.startIndex, beat]));
  const beatByCommandIndex = new Map<number, (typeof beats)[number]>();
  for (const beat of beats) for (let i = beat.startIndex; i <= beat.endIndex; i += 1) beatByCommandIndex.set(i, beat);
  const rows: ScriptRenderRow[] = [];
  let lastChapterKey: string | null = null;
  let lastSceneKey: string | null = null;
  let chapterCollapsed = false;
  let sceneCollapsed = false;

  project.lines.forEach((line, index) => {
    const entry = outline[index];
    if (!entry) return;
    if (entry.chapterKey !== lastChapterKey) {
      lastChapterKey = entry.chapterKey;
      lastSceneKey = null;
      chapterCollapsed = collapsed.has(entry.chapterKey);
      rows.push({ kind: 'chapter', key: entry.chapterKey, label: entry.chapter, lineIndex: index, collapsed: chapterCollapsed, estimateSize: 32 });
    }
    if (chapterCollapsed) return;
    if (entry.sceneKey !== lastSceneKey) {
      lastSceneKey = entry.sceneKey;
      sceneCollapsed = collapsed.has(entry.sceneKey);
      if (entry.sceneStart || entry.scene !== '默认 Scene') {
        rows.push({ kind: 'scene', key: entry.sceneKey, label: entry.scene, lineIndex: index, collapsed: sceneCollapsed, estimateSize: 30 });
      }
    }
    if (sceneCollapsed) return;

    const startingBeat = beatByStart.get(index);
    if (startingBeat) {
      const beatSelected = startingBeat.commandLineIds.some(id => selected.has(id));
      const beatActive = options.activeIndex !== undefined && options.activeIndex >= startingBeat.startIndex && options.activeIndex <= startingBeat.endIndex;
      rows.push({
        kind: 'beat', key: startingBeat.id, label: startingBeat.summary, lineIndex: startingBeat.startIndex, endIndex: startingBeat.endIndex,
        collapsed: collapsed.has(startingBeat.id), active: beatActive, selected: beatSelected, count: startingBeat.commandLineIds.length, estimateSize: 34
      });
    }
    const ownerBeat = beatByCommandIndex.get(index);
    if (ownerBeat && collapsed.has(ownerBeat.id)) return;

    rows.push({
      kind: 'line', key: line.id, lineId: line.id, lineIndex: index,
      selected: selected.has(line.id), active: options.activeIndex === index, hit: hitIndices.has(index), estimateSize: 44
    });
  });
  return rows;
}
