import type { PerformanceLine, ReplayLine, StagePosition, StageTransform } from '../core/types.js';

export type DirectStageSlot = 'left' | 'center' | 'right';
export interface DirectStageActor { characterId: string; position: StagePosition; transform?: StageTransform; }
export interface StageCompositionClipboard {
  stageIds: string[];
  stagePositions: Record<string, StagePosition>;
  stageTransforms: Record<string, StageTransform | null>;
}

const SLOT_ORDER: DirectStageSlot[] = ['left', 'center', 'right'];

function unique(ids: string[]): string[] {
  const seen = new Set<string>();
  return ids.filter(id => !!id && !seen.has(id) && !!seen.add(id));
}

function effectivePosition(actor: DirectStageActor, index: number, count: number): DirectStageSlot {
  if (actor.position === 'left' || actor.position === 'center' || actor.position === 'right') return actor.position;
  const fallback = count <= 1 ? ['center'] : count === 2 ? ['left', 'right'] : ['left', 'center', 'right'];
  return (fallback[Math.min(index, fallback.length - 1)] ?? 'center') as DirectStageSlot;
}

export function defaultStageTransform(position: StagePosition, index = 0, count = 1): StageTransform {
  let x = position === 'left' ? 0.22 : position === 'right' ? 0.78 : 0.5;
  if (position === 'auto' && count > 1) x = count === 2 ? [0.22, 0.78][Math.min(index, 1)]! : [0.22, 0.5, 0.78][Math.min(index, 2)]!;
  return { x, y: 0.88, scale: 1 };
}

function cleanTransform(transform: StageTransform): StageTransform {
  const clamp = (value: number, min: number, max: number, fallback: number) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
  const facing = transform.facing === 'left' || transform.facing === 'right' || transform.facing === 'neutral' ? transform.facing : undefined;
  return {
    x: clamp(transform.x, -0.5, 1.5, 0.5),
    y: clamp(transform.y, -0.5, 1.5, 0.88),
    scale: clamp(transform.scale, 0.2, 4, 1),
    ...(transform.depth !== undefined && Number.isFinite(Number(transform.depth)) ? { depth: clamp(transform.depth, 0, 1, 0) } : {}),
    ...(facing ? { facing } : {})
  };
}

/** Freeze the currently visible compiled roster only when a direct-manipulation edit actually occurs. */
export function materializeCustomStage(line: ReplayLine, stage: Array<Pick<DirectStageActor, 'characterId' | 'position'>>): void {
  const actors = stage.map((actor, index) => ({ ...actor, position: effectivePosition(actor as DirectStageActor, index, stage.length) }));
  line.stageMode = 'custom';
  line.stageIds = unique(actors.map(actor => actor.characterId));
  line.stagePositions ??= {};
  line.stageTransforms ??= {};
  for (const actor of actors) line.stagePositions[actor.characterId] = actor.position;
  for (const id of Object.keys(line.stagePositions)) if (!line.stageIds.includes(id)) delete line.stagePositions[id];
  for (const id of Object.keys(line.stageTransforms)) if (!line.stageIds.includes(id)) delete line.stageTransforms[id];
}

function ensureMaterialized(line: ReplayLine, stage: Array<Pick<DirectStageActor, 'characterId' | 'position'>>): void {
  if (line.stageMode !== 'custom') materializeCustomStage(line, stage);
  line.stageIds ??= [];
  line.stagePositions ??= {};
  line.stageTransforms ??= {};
}

export function stageSlotOf(line: ReplayLine, stage: Array<Pick<DirectStageActor, 'characterId' | 'position'>>, characterId: string): DirectStageSlot | null {
  const explicit = line.stagePositions?.[characterId];
  if (explicit === 'left' || explicit === 'center' || explicit === 'right') return explicit;
  const index = stage.findIndex(actor => actor.characterId === characterId);
  if (index < 0) return null;
  return effectivePosition(stage[index] as DirectStageActor, index, stage.length);
}

export function effectiveStageTransform(
  line: ReplayLine,
  stage: Array<Pick<DirectStageActor, 'characterId' | 'position' | 'transform'>>,
  characterId: string
): StageTransform {
  const explicit = line.stageTransforms?.[characterId];
  if (explicit) return cleanTransform(explicit);
  const index = stage.findIndex(actor => actor.characterId === characterId);
  const actor = index >= 0 ? stage[index] : undefined;
  if (actor?.transform) return cleanTransform(actor.transform);
  return defaultStageTransform(actor?.position ?? 'auto', Math.max(0, index), Math.max(1, stage.length));
}

export function setStageActorTransform(
  line: ReplayLine,
  stage: Array<Pick<DirectStageActor, 'characterId' | 'position' | 'transform'>>,
  characterId: string,
  transform: StageTransform
): void {
  ensureMaterialized(line, stage);
  if (!line.stageIds!.includes(characterId)) line.stageIds!.push(characterId);
  line.stageTransforms![characterId] = cleanTransform(transform);
  line.stageIds = unique(line.stageIds!);
}

/** Remove only this row's freeform override, allowing an earlier Scene transform to flow through. */
export function inheritStageActorTransform(line: ReplayLine, characterId: string): void {
  line.stageTransforms ??= {};
  delete line.stageTransforms[characterId];
}

/** Explicitly stop inherited freeform placement from this row onward and return this actor to slot layout. */
export function resetStageActorTransform(line: ReplayLine, characterId: string): void {
  line.stageTransforms ??= {};
  line.stageTransforms[characterId] = null;
}

export function moveStageActorToSlot(line: ReplayLine, stage: Array<Pick<DirectStageActor, 'characterId' | 'position'>>, characterId: string, target: DirectStageSlot): void {
  ensureMaterialized(line, stage);
  if (!line.stageIds!.includes(characterId)) line.stageIds!.push(characterId);
  const source = stageSlotOf(line, stage, characterId) ?? 'center';
  const occupied = line.stageIds!.find(id => id !== characterId && stageSlotOf(line, stage, id) === target);
  line.stagePositions![characterId] = target;
  if (occupied) line.stagePositions![occupied] = source;
  line.stageIds = unique(line.stageIds!);
}

export function addStageActorToSlot(line: ReplayLine, stage: Array<Pick<DirectStageActor, 'characterId' | 'position'>>, characterId: string, target: DirectStageSlot): boolean {
  ensureMaterialized(line, stage);
  const occupied = line.stageIds!.some(id => id !== characterId && stageSlotOf(line, stage, id) === target);
  if (occupied) return false;
  if (!line.stageIds!.includes(characterId)) line.stageIds!.push(characterId);
  line.stagePositions![characterId] = target;
  line.stageIds = unique(line.stageIds!);
  return true;
}

export function removeStageActor(line: ReplayLine, stage: Array<Pick<DirectStageActor, 'characterId' | 'position'>>, characterId: string): void {
  ensureMaterialized(line, stage);
  line.stageIds = (line.stageIds ?? []).filter(id => id !== characterId);
  if (line.stagePositions) delete line.stagePositions[characterId];
  if (line.stageTransforms) delete line.stageTransforms[characterId];
}

export function actorsByDirectSlot(line: ReplayLine, performanceLine?: Pick<PerformanceLine, 'stage'> | null): Record<DirectStageSlot, string[]> {
  const stage = performanceLine?.stage ?? [];
  const ids = line.stageMode === 'custom' ? (line.stageIds ?? []) : stage.map(actor => actor.characterId);
  const result: Record<DirectStageSlot, string[]> = { left: [], center: [], right: [] };
  ids.forEach(id => {
    const slot = stageSlotOf(line, stage, id) ?? 'center';
    result[slot].push(id);
  });
  return result;
}

export function copyStageComposition(line: ReplayLine, performanceLine?: Pick<PerformanceLine, 'stage'> | null): StageCompositionClipboard {
  const stage = performanceLine?.stage ?? [];
  const ids = line.stageMode === 'custom' ? unique(line.stageIds ?? []) : unique(stage.map(actor => actor.characterId));
  const stagePositions: Record<string, StagePosition> = {};
  const stageTransforms: Record<string, StageTransform | null> = {};
  ids.forEach((id, index) => {
    const actor = stage.find(item => item.characterId === id);
    stagePositions[id] = stageSlotOf(line, stage, id) ?? effectivePosition((actor ?? { characterId: id, position: 'auto' }) as DirectStageActor, index, ids.length);
    stageTransforms[id] = effectiveStageTransform(line, stage, id);
  });
  return { stageIds: ids, stagePositions, stageTransforms };
}

export function pasteStageComposition(line: ReplayLine, composition: StageCompositionClipboard): void {
  line.stageMode = 'custom';
  line.stageIds = unique(composition.stageIds);
  line.stagePositions = structuredClone(composition.stagePositions);
  line.stageTransforms = structuredClone(composition.stageTransforms);
}

export const DIRECT_STAGE_SLOTS = SLOT_ORDER;
