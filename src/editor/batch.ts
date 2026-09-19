import type { CameraEffect, LineType, PunctuationPauseTiming, ReplayLine, ReplayProject, StagePosition, StageTransform, TransitionEffect } from '../core/types.js';

export interface ReplayLineBatchPatch {
  speakerId?: string;
  type?: LineType;
  expression?: string;
  expressionMode?: ReplayLine['expressionMode'];
  mouth?: ReplayLine['mouth'];
  duration?: number | null;
  textEffect?: ReplayLine['textEffect'];
  textEffectDuration?: number | null;
  stageMode?: ReplayLine['stageMode'];
  camera?: CameraEffect;
  transition?: TransitionEffect;
  punctuationPauses?: PunctuationPauseTiming | null;
}

export interface PerformanceClipboard {
  expression?: string;
  expressionMode?: ReplayLine['expressionMode'];
  mouth?: ReplayLine['mouth'];
  sfxAssetId?: string | null;
  stageMode?: ReplayLine['stageMode'];
  stageIds?: string[];
  stagePositions?: Record<string, StagePosition>;
  stageTransforms?: Record<string, StageTransform | null>;
  stageMethod?: ReplayLine['stageMethod'];
  dialogueStyleId?: ReplayLine['dialogueStyleId'];
  bubble?: ReplayLine['bubble'];
  scene?: ReplayLine['scene'];
}

export function applyBatchEdit(project: ReplayProject, lineIds: Iterable<string>, patch: ReplayLineBatchPatch): number {
  const ids = new Set(lineIds);
  let changed = 0;
  for (const line of project.lines) {
    if (!ids.has(line.id)) continue;
    if (patch.speakerId !== undefined) line.speakerId = patch.speakerId;
    if (patch.type !== undefined) line.type = patch.type;
    if (patch.expression !== undefined) { line.expression = patch.expression; line.expressionMode = patch.expressionMode ?? 'set'; }
    else if (patch.expressionMode !== undefined) line.expressionMode = patch.expressionMode;
    if (patch.mouth !== undefined) line.mouth = patch.mouth;
    if (patch.duration !== undefined) line.duration = patch.duration;
    if (patch.textEffect !== undefined) line.textEffect = patch.textEffect;
    if (patch.textEffectDuration !== undefined) line.textEffectDuration = patch.textEffectDuration;
    if (patch.stageMode !== undefined) line.stageMode = patch.stageMode;
    if (patch.punctuationPauses !== undefined) {
      line.speech ??= {};
      if (patch.punctuationPauses === null) delete line.speech.punctuationPauses;
      else line.speech.punctuationPauses = structuredClone(patch.punctuationPauses);
    }
    if (patch.camera !== undefined || patch.transition !== undefined) {
      line.scene ??= {};
      if (patch.camera !== undefined) line.scene.camera = patch.camera;
      if (patch.transition !== undefined) line.scene.transition = patch.transition;
    }
    changed += 1;
  }
  return changed;
}

export function copyPerformanceSettings(line: ReplayLine): PerformanceClipboard {
  return structuredClone({
    expression: line.expression,
    expressionMode: line.expressionMode,
    mouth: line.mouth,
    sfxAssetId: line.sfxAssetId,
    stageMode: line.stageMode,
    stageIds: line.stageIds,
    stagePositions: line.stagePositions,
    stageTransforms: line.stageTransforms,
    stageMethod: line.stageMethod,
    dialogueStyleId: line.dialogueStyleId,
    bubble: line.bubble,
    scene: line.scene
  });
}

/** Paste an explicitly copied line's performance settings, replacing the target line's local scene patch. */
export function pastePerformanceSettings(line: ReplayLine, clipboard: PerformanceClipboard): void {
  const copy = structuredClone(clipboard);
  if ('expression' in copy) line.expression = copy.expression;
  if ('expressionMode' in copy) line.expressionMode = copy.expressionMode;
  if ('mouth' in copy) line.mouth = copy.mouth;
  if ('sfxAssetId' in copy) line.sfxAssetId = copy.sfxAssetId;
  if ('stageMode' in copy) line.stageMode = copy.stageMode;
  if ('stageIds' in copy) line.stageIds = copy.stageIds;
  if ('stagePositions' in copy) line.stagePositions = copy.stagePositions;
  if ('stageTransforms' in copy) line.stageTransforms = copy.stageTransforms;
  if ('stageMethod' in copy) line.stageMethod = copy.stageMethod;
  if ('dialogueStyleId' in copy) line.dialogueStyleId = copy.dialogueStyleId;
  if ('bubble' in copy) line.bubble = copy.bubble;
  if ('scene' in copy) line.scene = copy.scene;
}

/** Apply a reusable preset without erasing unrelated scene fields such as BG/BGM/CG. */
export function applyPerformancePatch(line: ReplayLine, patch: PerformanceClipboard): void {
  const copy = structuredClone(patch);
  if (copy.expression !== undefined) line.expression = copy.expression;
  if (copy.expressionMode !== undefined) line.expressionMode = copy.expressionMode;
  if (copy.mouth !== undefined) line.mouth = copy.mouth;
  if (copy.sfxAssetId !== undefined) line.sfxAssetId = copy.sfxAssetId;
  if (copy.stageMode !== undefined) line.stageMode = copy.stageMode;
  if (copy.stageIds !== undefined) line.stageIds = copy.stageIds;
  if (copy.stagePositions !== undefined) line.stagePositions = copy.stagePositions;
  if (copy.stageTransforms !== undefined) line.stageTransforms = copy.stageTransforms;
  if (copy.stageMethod !== undefined) line.stageMethod = copy.stageMethod;
  if (copy.dialogueStyleId !== undefined) line.dialogueStyleId = copy.dialogueStyleId;
  if (copy.bubble !== undefined) line.bubble = copy.bubble;
  if (copy.scene !== undefined) line.scene = { ...(line.scene ?? {}), ...copy.scene };
}
