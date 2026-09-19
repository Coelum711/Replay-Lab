import type { ReplayLine, ReplayProject } from '../core/types.js';
import { buildScriptOutline } from './outline.js';

export type OutlineGroupKind = 'scene' | 'chapter';
export type MoveDirection = -1 | 1;

export interface LineRange {
  start: number;
  end: number;
}

function selectedIndices(project: ReplayProject, lineIds: Iterable<string>): number[] {
  const ids = new Set(lineIds);
  const out: number[] = [];
  project.lines.forEach((line, index) => { if (ids.has(line.id)) out.push(index); });
  return out;
}

/** Move an arbitrary multi-selection by one document row while preserving relative order. */
export function moveSelectedLines(project: ReplayProject, lineIds: Iterable<string>, direction: MoveDirection): boolean {
  const ids = new Set(lineIds);
  if (!ids.size || project.lines.length < 2) return false;
  let changed = false;
  if (direction < 0) {
    for (let i = 1; i < project.lines.length; i += 1) {
      if (!ids.has(project.lines[i].id) || ids.has(project.lines[i - 1].id)) continue;
      [project.lines[i - 1], project.lines[i]] = [project.lines[i], project.lines[i - 1]];
      changed = true;
    }
  } else {
    for (let i = project.lines.length - 2; i >= 0; i -= 1) {
      if (!ids.has(project.lines[i].id) || ids.has(project.lines[i + 1].id)) continue;
      [project.lines[i], project.lines[i + 1]] = [project.lines[i + 1], project.lines[i]];
      changed = true;
    }
  }
  return changed;
}

/** Move selected lines as one packed block before another line. Useful for drag/drop. */
export function moveLinesBefore(project: ReplayProject, lineIds: Iterable<string>, beforeLineId: string | null): boolean {
  const ids = new Set(lineIds);
  if (!ids.size || (beforeLineId && ids.has(beforeLineId))) return false;
  const moved = project.lines.filter(line => ids.has(line.id));
  if (!moved.length) return false;
  const remaining = project.lines.filter(line => !ids.has(line.id));
  let insertAt = beforeLineId ? remaining.findIndex(line => line.id === beforeLineId) : remaining.length;
  if (insertAt < 0) insertAt = remaining.length;
  const next = [...remaining.slice(0, insertAt), ...moved, ...remaining.slice(insertAt)];
  if (next.every((line, index) => line.id === project.lines[index]?.id)) return false;
  project.lines = next;
  return true;
}

export function outlineGroupRange(project: ReplayProject, index: number, kind: OutlineGroupKind): LineRange | null {
  if (index < 0 || index >= project.lines.length) return null;
  const outline = buildScriptOutline(project.lines);
  const current = outline[index];
  if (!current) return null;
  const key = kind === 'chapter' ? current.chapterKey : current.sceneKey;
  let start = index;
  let end = index;
  while (start > 0 && (kind === 'chapter' ? outline[start - 1].chapterKey : outline[start - 1].sceneKey) === key) start -= 1;
  while (end + 1 < outline.length && (kind === 'chapter' ? outline[end + 1].chapterKey : outline[end + 1].sceneKey) === key) end += 1;
  return { start, end };
}

function spliceRange(lines: ReplayLine[], range: LineRange): ReplayLine[] {
  return lines.splice(range.start, range.end - range.start + 1);
}

/** Move the current Scene among sibling Scenes, or Chapter among Chapters. */
export function moveOutlineGroup(project: ReplayProject, index: number, kind: OutlineGroupKind, direction: MoveDirection): boolean {
  const current = outlineGroupRange(project, index, kind);
  if (!current) return false;
  const outline = buildScriptOutline(project.lines);
  const currentChapterKey = outline[index]?.chapterKey;

  if (direction < 0) {
    if (current.start === 0) return false;
    const adjacentIndex = current.start - 1;
    if (kind === 'scene' && outline[adjacentIndex]?.chapterKey !== currentChapterKey) return false;
    const adjacent = outlineGroupRange(project, adjacentIndex, kind);
    if (!adjacent) return false;
    const block = spliceRange(project.lines, current);
    project.lines.splice(adjacent.start, 0, ...block);
    return true;
  }

  if (current.end >= project.lines.length - 1) return false;
  const adjacentIndex = current.end + 1;
  if (kind === 'scene' && outline[adjacentIndex]?.chapterKey !== currentChapterKey) return false;
  const adjacent = outlineGroupRange(project, adjacentIndex, kind);
  if (!adjacent) return false;
  const block = spliceRange(project.lines, current);
  // After removing current, the adjacent block shifts left by block.length.
  const adjustedAdjacentEnd = adjacent.end - block.length;
  project.lines.splice(adjustedAdjacentEnd + 1, 0, ...block);
  return true;
}

/** Return ids for the current outline group. */
export function outlineGroupLineIds(project: ReplayProject, index: number, kind: OutlineGroupKind): string[] {
  const range = outlineGroupRange(project, index, kind);
  return range ? project.lines.slice(range.start, range.end + 1).map(line => line.id) : [];
}

export function firstSelectedIndex(project: ReplayProject, lineIds: Iterable<string>): number | null {
  const indices = selectedIndices(project, lineIds);
  return indices.length ? Math.min(...indices) : null;
}
