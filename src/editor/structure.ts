import type { ReplayLine, ReplayProject } from '../core/types.js';
import { buildScriptOutline } from './outline.js';
import { makeId } from '../core/id.js';
import { outlineGroupRange, type OutlineGroupKind } from './reorder.js';

export interface OutlineAssignment {
  chapterKey: string;
  chapter: string;
  sceneKey: string;
  scene: string;
}

export interface MoveSceneOptions {
  /** Insert before this scene's first line. Null means at the end of the target chapter. */
  beforeSceneIndex?: number | null;
}

function assignmentMap(project: ReplayProject): Map<string, OutlineAssignment> {
  const outline = buildScriptOutline(project.lines);
  const map = new Map<string, OutlineAssignment>();
  for (const entry of outline) {
    map.set(entry.lineId, {
      chapterKey: entry.chapterKey,
      chapter: entry.chapter,
      sceneKey: entry.sceneKey,
      scene: entry.scene
    });
  }
  return map;
}

/**
 * Re-materialize Chapter / Scene boundaries from stable per-line assignments.
 * This keeps markers on the first line of each contiguous group after structural edits.
 */
export function materializeOutlineAssignments(project: ReplayProject, assignments: Map<string, OutlineAssignment>): void {
  let previousChapterKey: string | null = null;
  let previousSceneKey: string | null = null;

  for (const line of project.lines) {
    const assignment = assignments.get(line.id);
    delete line.chapterTitle;
    delete line.sceneTitle;
    if (!assignment) continue;

    if (assignment.chapterKey !== previousChapterKey) {
      line.chapterTitle = assignment.chapter;
      previousChapterKey = assignment.chapterKey;
      previousSceneKey = null;
    }
    if (assignment.sceneKey !== previousSceneKey) {
      // Do not emit the synthetic default Scene unless it is needed to keep a boundary.
      const needsExplicitDefault = previousSceneKey !== null || assignment.scene !== '默认 Scene';
      if (needsExplicitDefault) line.sceneTitle = assignment.scene;
      previousSceneKey = assignment.sceneKey;
    }
  }
}

export function effectiveOutlineAt(project: ReplayProject, index: number): OutlineAssignment | null {
  const entry = buildScriptOutline(project.lines)[index];
  if (!entry) return null;
  return {
    chapterKey: entry.chapterKey,
    chapter: entry.chapter,
    sceneKey: entry.sceneKey,
    scene: entry.scene
  };
}

/** Rename the effective Chapter containing index without creating a new boundary. */
export function renameChapter(project: ReplayProject, index: number, title: string): boolean {
  const outline = buildScriptOutline(project.lines);
  const entry = outline[index];
  if (!entry) return false;
  const nextTitle = title.trim() || '未命名 Chapter';
  const first = outline.find(item => item.chapterKey === entry.chapterKey);
  if (!first) return false;
  const line = project.lines[first.index];
  const current = entry.chapter;
  if (current === nextTitle) return false;
  line.chapterTitle = nextTitle;
  return true;
}

/** Rename the effective Scene containing index without creating a new boundary. */
export function renameScene(project: ReplayProject, index: number, title: string): boolean {
  const outline = buildScriptOutline(project.lines);
  const entry = outline[index];
  if (!entry) return false;
  const nextTitle = title.trim() || '未命名 Scene';
  const first = outline.find(item => item.sceneKey === entry.sceneKey);
  if (!first) return false;
  const line = project.lines[first.index];
  if (entry.scene === nextTitle) return false;
  line.sceneTitle = nextTitle;
  return true;
}

/** Start a new Chapter at index while preserving the current effective Scene name. */
export function splitChapterAt(project: ReplayProject, index: number, title = '新 Chapter'): boolean {
  const outline = buildScriptOutline(project.lines);
  const entry = outline[index];
  const line = project.lines[index];
  if (!entry || !line) return false;
  const nextTitle = title.trim() || '新 Chapter';
  // Already a boundary with the same title: nothing to do.
  if (entry.chapterStart && entry.chapter === nextTitle) return false;
  line.chapterTitle = nextTitle;
  // Chapter reset would otherwise silently change the current Scene to the default Scene.
  if (!line.sceneTitle && entry.scene !== '默认 Scene') line.sceneTitle = entry.scene;
  return true;
}

/** Start a new Scene at index. */
export function splitSceneAt(project: ReplayProject, index: number, title = '新 Scene'): boolean {
  const line = project.lines[index];
  if (!line) return false;
  const nextTitle = title.trim() || '新 Scene';
  const outline = buildScriptOutline(project.lines);
  const entry = outline[index];
  if (entry?.sceneStart && entry.scene === nextTitle) return false;
  line.sceneTitle = nextTitle;
  return true;
}

/** Merge the current Scene into its previous sibling Scene within the same Chapter. */
export function mergeSceneWithPrevious(project: ReplayProject, index: number): boolean {
  const outline = buildScriptOutline(project.lines);
  const entry = outline[index];
  if (!entry) return false;
  const sceneStart = outline.find(item => item.sceneKey === entry.sceneKey);
  if (!sceneStart || sceneStart.index === 0) return false;
  const previous = outline[sceneStart.index - 1];
  if (!previous || previous.chapterKey !== entry.chapterKey) return false;
  delete project.lines[sceneStart.index].sceneTitle;
  return true;
}

/** Merge the current Chapter into the previous Chapter. */
export function mergeChapterWithPrevious(project: ReplayProject, index: number): boolean {
  const outline = buildScriptOutline(project.lines);
  const entry = outline[index];
  if (!entry) return false;
  const chapterStart = outline.find(item => item.chapterKey === entry.chapterKey);
  if (!chapterStart || chapterStart.index === 0) return false;
  const line = project.lines[chapterStart.index];
  // Removing a Chapter boundary must not accidentally absorb its default Scene into
  // the previous Chapter's last Scene. Preserve that Scene as an explicit boundary.
  if (!line.sceneTitle) line.sceneTitle = entry.scene;
  delete line.chapterTitle;
  return true;
}

/**
 * Move arbitrary lines before another line without allowing marker corruption.
 * Line-level drag means "move these dialogue rows into the destination Scene";
 * moving a whole Scene/Chapter should use moveOutlineGroup/moveSceneToChapter instead.
 */
export function moveLinesBeforeStructureAware(
  project: ReplayProject,
  lineIds: Iterable<string>,
  beforeLineId: string | null,
  options: { destinationLineId?: string | null } = {}
): boolean {
  const ids = new Set(lineIds);
  if (!ids.size || (beforeLineId && ids.has(beforeLineId))) return false;
  const assignments = assignmentMap(project);
  const moved = project.lines.filter(line => ids.has(line.id));
  if (!moved.length) return false;
  const remaining = project.lines.filter(line => !ids.has(line.id));
  let insertAt = beforeLineId ? remaining.findIndex(line => line.id === beforeLineId) : remaining.length;
  if (insertAt < 0) insertAt = remaining.length;

  const destinationLine = options.destinationLineId
    ? remaining.find(line => line.id === options.destinationLineId) ?? null
    : null;
  const targetLine = destinationLine ?? remaining[insertAt] ?? remaining[insertAt - 1] ?? null;
  const targetAssignment = targetLine ? assignments.get(targetLine.id) : null;
  if (targetAssignment) {
    for (const line of moved) assignments.set(line.id, { ...targetAssignment });
  }

  const next = [...remaining.slice(0, insertAt), ...moved, ...remaining.slice(insertAt)];
  if (next.every((line, i) => line.id === project.lines[i]?.id)) return false;
  project.lines = next;
  materializeOutlineAssignments(project, assignments);
  return true;
}



/** Move the selected dialogue rows one document step while keeping outline markers canonical. */
export function moveLinesOneStepStructureAware(project: ReplayProject, lineIds: Iterable<string>, direction: -1 | 1): boolean {
  const ids = new Set(lineIds);
  if (!ids.size) return false;
  const selected = project.lines
    .map((line, index) => ({ line, index }))
    .filter(item => ids.has(item.line.id));
  if (!selected.length) return false;

  if (direction < 0) {
    const first = selected[0].index;
    let crossed = first - 1;
    while (crossed >= 0 && ids.has(project.lines[crossed].id)) crossed -= 1;
    if (crossed < 0) return false;
    const crossedId = project.lines[crossed].id;
    return moveLinesBeforeStructureAware(project, ids, crossedId, { destinationLineId: crossedId });
  }

  const last = selected[selected.length - 1].index;
  let crossed = last + 1;
  while (crossed < project.lines.length && ids.has(project.lines[crossed].id)) crossed += 1;
  if (crossed >= project.lines.length) return false;
  const crossedId = project.lines[crossed].id;
  const remaining = project.lines.filter(line => !ids.has(line.id));
  const crossedRemainingIndex = remaining.findIndex(line => line.id === crossedId);
  const before = remaining[crossedRemainingIndex + 1]?.id ?? null;
  return moveLinesBeforeStructureAware(project, ids, before, { destinationLineId: crossedId });
}

/** Delete lines while transferring Chapter/Scene boundaries to surviving lines in those groups. */
export function deleteLinesStructureAware(project: ReplayProject, lineIds: Iterable<string>): boolean {
  const ids = new Set(lineIds);
  if (!ids.size) return false;
  const assignments = assignmentMap(project);
  const next = project.lines.filter(line => !ids.has(line.id));
  if (next.length === project.lines.length) return false;
  // Background/CG/BGM on a deleted row persist for later rows, so hand them to the next survivor.
  // Walk backwards: the latest deleted change is the one the following rows were seeing.
  for (let index = project.lines.length - 1; index >= 0; index -= 1) {
    const removed = project.lines[index]!;
    if (!ids.has(removed.id) || !removed.scene) continue;
    const target = project.lines.slice(index + 1).find(line => !ids.has(line.id));
    if (!target) continue;
    for (const key of ['background', 'cg', 'bgm', 'ambient', 'cgPresentation'] as const) {
      if (!Object.prototype.hasOwnProperty.call(removed.scene, key)) continue;
      target.scene ??= {} as NonNullable<ReplayLine['scene']>;
      if (!Object.prototype.hasOwnProperty.call(target.scene, key)) (target.scene as Record<string, unknown>)[key] = structuredClone(removed.scene[key]);
    }
  }
  project.lines = next;
  materializeOutlineAssignments(project, assignments);
  return true;
}

/** Move a Scene into another Chapter, preserving the Scene's own identity/name. */
export function moveSceneToChapter(project: ReplayProject, sceneIndex: number, targetChapterIndex: number, options: MoveSceneOptions = {}): boolean {
  const outline = buildScriptOutline(project.lines);
  const source = outline[sceneIndex];
  const target = outline[targetChapterIndex];
  if (!source || !target) return false;

  const sourceIndices = outline.filter(item => item.sceneKey === source.sceneKey).map(item => item.index);
  if (!sourceIndices.length) return false;
  const sourceIds = new Set(sourceIndices.map(i => project.lines[i].id));
  if (source.chapterKey === target.chapterKey && options.beforeSceneIndex == null) return false;

  const assignments = assignmentMap(project);
  const moved = project.lines.filter(line => sourceIds.has(line.id));
  const remaining = project.lines.filter(line => !sourceIds.has(line.id));

  const targetChapterLines = remaining.filter(line => assignments.get(line.id)?.chapterKey === target.chapterKey);
  if (!targetChapterLines.length) return false;

  let insertAt: number;
  if (options.beforeSceneIndex != null) {
    const before = project.lines[options.beforeSceneIndex];
    if (!before || sourceIds.has(before.id)) return false;
    const beforeAssignment = assignments.get(before.id);
    if (beforeAssignment?.chapterKey !== target.chapterKey) return false;
    insertAt = remaining.findIndex(line => line.id === before.id);
  } else {
    const lastId = targetChapterLines[targetChapterLines.length - 1].id;
    insertAt = remaining.findIndex(line => line.id === lastId) + 1;
  }
  if (insertAt < 0) return false;

  const sceneIdentity = assignments.get(moved[0].id)!;
  for (const line of moved) {
    assignments.set(line.id, {
      chapterKey: target.chapterKey,
      chapter: target.chapter,
      sceneKey: `${target.chapterKey}/moved:${sceneIdentity.sceneKey}`,
      scene: sceneIdentity.scene
    });
  }

  project.lines = [...remaining.slice(0, insertAt), ...moved, ...remaining.slice(insertAt)];
  materializeOutlineAssignments(project, assignments);
  return true;
}

/** Ensure existing marker placement is canonical without changing current group semantics. */
export function normalizeOutlineMarkers(project: ReplayProject): void {
  materializeOutlineAssignments(project, assignmentMap(project));
}


function cloneReplayLine(line: ReplayLine): ReplayLine {
  const cloned = typeof structuredClone === 'function'
    ? structuredClone(line)
    : JSON.parse(JSON.stringify(line)) as ReplayLine;
  cloned.id = makeId('line');
  return cloned;
}

/** Duplicate a whole Scene/Chapter after itself without leaking source outline markers. */
export function duplicateOutlineGroup(
  project: ReplayProject,
  index: number,
  kind: OutlineGroupKind,
  options: { title?: string } = {}
): { start: number; end: number; lineIds: string[] } | null {
  const range = outlineGroupRange(project, index, kind);
  if (!range) return null;
  const outline = buildScriptOutline(project.lines);
  const source = outline[index];
  if (!source) return null;
  const cloned = project.lines.slice(range.start, range.end + 1).map(cloneReplayLine);
  if (!cloned.length) return null;

  if (kind === 'chapter') {
    cloned[0]!.chapterTitle = options.title?.trim() || `${source.chapter} 副本`;
    // Scene markers inside the duplicated chapter can remain as authored.
    if (!cloned[0]!.sceneTitle && source.scene !== '默认 Scene') cloned[0]!.sceneTitle = source.scene;
  } else {
    delete cloned[0]!.chapterTitle;
    cloned[0]!.sceneTitle = options.title?.trim() || `${source.scene} 副本`;
    for (let i = 1; i < cloned.length; i += 1) {
      delete cloned[i]!.chapterTitle;
      // A Scene block must not contain another Scene marker.
      delete cloned[i]!.sceneTitle;
    }
  }

  const insertAt = range.end + 1;
  project.lines.splice(insertAt, 0, ...cloned);
  normalizeOutlineMarkers(project);
  return { start: insertAt, end: insertAt + cloned.length - 1, lineIds: cloned.map(line => line.id) };
}

/** Delete a complete Scene/Chapter as a structural block. */
export function deleteOutlineGroup(project: ReplayProject, index: number, kind: OutlineGroupKind): boolean {
  const range = outlineGroupRange(project, index, kind);
  if (!range) return false;
  project.lines.splice(range.start, range.end - range.start + 1);
  if (project.lines.length) normalizeOutlineMarkers(project);
  return true;
}
