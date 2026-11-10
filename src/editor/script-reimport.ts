import { createCharacter } from '../core/project.js';
import { makeId } from '../core/id.js';
import { resolveCharacterName } from '../core/character-name.js';
import type { ReplayLine, ReplayProject, ScenePatch } from '../core/types.js';

export interface ScriptReimportReport {
  lines: number;
  reusedCharacters: number;
  createdCharacters: number;
  retainedCharacters: number;
  unusedRetainedCharacters: number;
  /** Unchanged source lines whose local performance authoring was carried over. */
  reusedLineAuthoring: number;
  /** Manually-authored /director command rows reinserted around surviving source lines. */
  preservedCommands: number;
  ambiguousNames: string[];
}

export interface ScriptReimportResult {
  project: ReplayProject;
  report: ScriptReimportReport;
}

function unique(ids: string[] | undefined): string[] | undefined {
  return ids ? [...new Set(ids)] : ids;
}

export function remapLineCharacters(line: ReplayLine, idMap: Map<string, string>): ReplayLine {
  const clone = structuredClone(line);
  const remap = (id: string): string => idMap.get(id) ?? id;
  clone.speakerId = remap(clone.speakerId);
  clone.stageIds = unique(clone.stageIds?.map(remap));
  if (clone.stagePositions) {
    const next: typeof clone.stagePositions = {};
    for (const [id, position] of Object.entries(clone.stagePositions)) if (next[remap(id)] === undefined) next[remap(id)] = position;
    clone.stagePositions = next;
  }
  if (clone.stageTransforms) {
    const next: typeof clone.stageTransforms = {};
    for (const [id, transform] of Object.entries(clone.stageTransforms)) if (next[remap(id)] === undefined) next[remap(id)] = transform ? structuredClone(transform) : null;
    clone.stageTransforms = next;
  }
  if (clone.scene) {
    clone.scene.enterIds = unique(clone.scene.enterIds?.map(remap));
    clone.scene.exitIds = unique(clone.scene.exitIds?.map(remap));
  }
  if (clone.command?.characterId) clone.command.characterId = remap(clone.command.characterId);
  return clone;
}

function lineSourceKey(line: ReplayLine): string {
  // Character ids are already remapped before matching. Exclude chapter/scene
  // anchors so moving an unchanged line between sections does not lose its work.
  return `${line.speakerId}\u0000${line.type}\u0000${line.text}`;
}

function hasAuthoredSpeech(line: ReplayLine): boolean {
  const speech = line.speech as Record<string, unknown> | undefined;
  if (!speech) return false;
  return Object.entries(speech).some(([key, value]) => {
    if ((key === 'languageOverride' || key === 'sourceLanguage') && (value === null || value === undefined || value === '')) return false;
    if (Array.isArray(value)) return value.length > 0;
    return value !== null && value !== undefined && value !== '';
  });
}

function hasAuthoredScene(scene: ScenePatch | undefined): boolean {
  if (!scene) return false;
  if (scene.background !== undefined || scene.cg !== undefined || scene.bgm !== undefined || scene.ambient !== undefined) return true;
  if (scene.enterIds?.length || scene.exitIds?.length) return true;
  if (scene.camera && scene.camera !== 'none') return true;
  if (scene.transition && scene.transition !== 'cut') return true;
  if (scene.cameraCurve && scene.cameraCurve !== 'sigmoid') return true;
  if (scene.transitionCurve && scene.transitionCurve !== 'quadraticR') return true;
  if (scene.backgroundMethod && scene.backgroundMethod !== 'replace') return true;
  return scene.backgroundMethodDuration !== null && scene.backgroundMethodDuration !== undefined;
}

/**
 * Carry local authoring from an unchanged source line without overwriting richer
 * data newly supplied by an importer when the old field was still at its default.
 */
function preserveLineAuthoring(imported: ReplayLine, previous: ReplayLine): ReplayLine {
  const next = structuredClone(imported);
  next.id = previous.id;

  if (previous.textEffect && previous.textEffect !== 'all') next.textEffect = previous.textEffect;
  if (previous.textEffectDuration !== null && previous.textEffectDuration !== undefined) next.textEffectDuration = previous.textEffectDuration;
  if (hasAuthoredSpeech(previous)) next.speech = structuredClone(previous.speech);
  if (previous.duration !== null && previous.duration !== undefined) next.duration = previous.duration;
  if (previous.expressionMode === 'set' || (previous.expression && previous.expression !== 'default')) { next.expression = previous.expression ?? 'default'; next.expressionMode = 'set'; }
  if (previous.mouth && previous.mouth !== 'auto') next.mouth = previous.mouth;
  if (previous.mouthCues?.length) next.mouthCues = structuredClone(previous.mouthCues);
  if (previous.audioAssetId) next.audioAssetId = previous.audioAssetId;
  if (previous.sfxAssetId) next.sfxAssetId = previous.sfxAssetId;
  if (previous.bubble) next.bubble = structuredClone(previous.bubble);
  if (previous.dialogueStyleId) next.dialogueStyleId = previous.dialogueStyleId;
  if (previous.stageMethod) next.stageMethod = structuredClone(previous.stageMethod);
  if (previous.stageMode === 'custom') next.stageMode = 'custom';
  if (previous.stageIds?.length) next.stageIds = [...previous.stageIds];
  if (previous.stagePositions && Object.keys(previous.stagePositions).length) next.stagePositions = { ...previous.stagePositions };
  if (previous.stageTransforms && Object.keys(previous.stageTransforms).length) next.stageTransforms = structuredClone(previous.stageTransforms);
  if (previous.cameraTransform !== undefined) next.cameraTransform = previous.cameraTransform === null ? null : structuredClone(previous.cameraTransform);
  if (hasAuthoredScene(previous.scene)) next.scene = structuredClone(previous.scene);
  if (previous.metadata && Object.keys(previous.metadata).length) next.metadata = structuredClone(previous.metadata);
  return next;
}

/**
 * Replace only the script while preserving the current project's authoring setup.
 *
 * In addition to character/material setup, unchanged source lines keep their
 * line ids and non-default local performance authoring. This means inserting or
 * deleting unrelated Log lines no longer discards expressions, voice, staging,
 * camera/BGM scene work, bubbles, etc. on the lines that still match exactly.
 *
 * This remains deliberately conservative: a source line whose speaker/type/text
 * changed is treated as new until importers provide stronger stable message ids.
 */
export function reimportScriptPreservingSetup(current: ReplayProject, imported: ReplayProject): ScriptReimportResult {
  const next = structuredClone(current);
  const idMap = new Map<string, string>();
  const ambiguousNames: string[] = [];
  let reusedCharacters = 0;
  let createdCharacters = 0;

  for (const importedCharacter of imported.characters) {
    const resolution = resolveCharacterName(next.characters, importedCharacter.name);
    if (resolution.character) {
      idMap.set(importedCharacter.id, resolution.character.id);
      reusedCharacters += 1;
      continue;
    }

    const created = createCharacter(importedCharacter.name);
    // Script import may infer semantic role/staging, but must not smuggle visual
    // bindings or template references into the preserved project.
    created.kind = importedCharacter.kind;
    created.showOnStage = importedCharacter.showOnStage;
    created.defaultPosition = importedCharacter.defaultPosition;
    created.aliases = [...(importedCharacter.aliases ?? [])];
    while (next.characters.some(character => character.id === created.id)) created.id = makeId('char');
    next.characters.push(created);
    idMap.set(importedCharacter.id, created.id);
    createdCharacters += 1;
    if (resolution.kind === 'ambiguous') ambiguousNames.push(importedCharacter.name);
  }

  const previousBySource = new Map<string, ReplayLine[]>();
  for (const line of current.lines) {
    if (line.type === 'command') continue;
    const key = lineSourceKey(line);
    const queue = previousBySource.get(key) ?? [];
    queue.push(line);
    previousBySource.set(key, queue);
  }

  const remappedLines = imported.lines.map(line => remapLineCharacters(line, idMap));
  const importedCounts = new Map<string, number>();
  for (const line of remappedLines) {
    const key = lineSourceKey(line);
    importedCounts.set(key, (importedCounts.get(key) ?? 0) + 1);
  }
  const ambiguousDuplicateKeys = new Set<string>();
  for (const [key, queue] of previousBySource) {
    const nextCount = importedCounts.get(key) ?? 0;
    if (queue.length !== nextCount && (queue.length > 1 || nextCount > 1)) ambiguousDuplicateKeys.add(key);
  }

  let reusedLineAuthoring = 0;
  const authoredLines = remappedLines.map(remapped => {
    const key = lineSourceKey(remapped);
    // When the count of identical duplicate lines changed, there is no stable way
    // to know which duplicate owned which expression/audio/staging. Prefer losing
    // that local carry-over over silently attaching it to the wrong occurrence.
    if (ambiguousDuplicateKeys.has(key)) return remapped;
    const queue = previousBySource.get(key);
    const previous = queue?.shift();
    if (!previous) return remapped;
    reusedLineAuthoring += 1;
    return preserveLineAuthoring(remapped, previous);
  });

  // Director commands are authored editing decisions, not imported Log content.
  // Re-anchor each command cluster to the nearest surviving source line id so a
  // source-aware reimport does not throw away /expression, /dismiss, /bgm, etc.
  const survivingIds = new Set(authoredLines.map(line => line.id));
  const before = new Map<string, ReplayLine[]>();
  const after = new Map<string, ReplayLine[]>();
  const tail: ReplayLine[] = [];
  for (let index = 0; index < current.lines.length; index += 1) {
    const command = current.lines[index]!;
    if (command.type !== 'command') continue;
    let nextId: string | null = null;
    let prevId: string | null = null;
    for (let j = index + 1; j < current.lines.length; j += 1) {
      const candidate = current.lines[j]!;
      if (candidate.type !== 'command' && survivingIds.has(candidate.id)) { nextId = candidate.id; break; }
    }
    if (!nextId) {
      for (let j = index - 1; j >= 0; j -= 1) {
        const candidate = current.lines[j]!;
        if (candidate.type !== 'command' && survivingIds.has(candidate.id)) { prevId = candidate.id; break; }
      }
    }
    const clone = structuredClone(command);
    if (nextId) { const list = before.get(nextId) ?? []; list.push(clone); before.set(nextId, list); }
    else if (prevId) { const list = after.get(prevId) ?? []; list.push(clone); after.set(prevId, list); }
    else tail.push(clone);
  }
  next.lines = [];
  let preservedCommands = 0;
  for (const line of authoredLines) {
    const prefix = before.get(line.id) ?? [];
    next.lines.push(...prefix, line); preservedCommands += prefix.length;
    const suffix = after.get(line.id) ?? [];
    next.lines.push(...suffix); preservedCommands += suffix.length;
  }
  next.lines.push(...tail); preservedCommands += tail.length;

  const importedTargetIds = new Set(idMap.values());
  const unusedRetainedCharacters = next.characters.filter(character => !importedTargetIds.has(character.id)).length;
  return {
    project: next,
    report: {
      lines: next.lines.length,
      reusedCharacters,
      createdCharacters,
      retainedCharacters: Math.max(0, next.characters.length - createdCharacters),
      unusedRetainedCharacters,
      reusedLineAuthoring,
      preservedCommands,
      ambiguousNames: [...new Set(ambiguousNames)]
    }
  };
}
