import { lineMoodText, triggeredExpression } from './acting.js';
import { estimateDuration } from './project.js';
import { parseTextTags } from './text-tags.js';
import type { CameraEffect, CameraTransform, CgPresentation, CustomObjectRuntimeState, DirectorBeat, DirectorBeatChange, MediaAsset, PerformanceDocument, PerformanceState, ReplayCharacter, ReplayDirectorCommand, ScreenShake, ScreenEmote, EmoteKind, ScreenFilterKind, ReplayLine, ReplayProject, SceneGraphSettings, SceneMaskSpec, StagePosition, StageTransform, TransitionEffect } from './types.js';
import { resolveCachedSpeech } from '../speech/policy.js';
import { resolvePunctuationPauseTiming, resolveSpeechPauseScale, speechPauseExtraSeconds } from '../speech/pause.js';
import { normalizePuppetRig } from '../puppet/rig.js';
import { normalizeFaceFit } from './face.js';
import { buildDirectorBeats } from './beats.js';
import { buildSceneGraphSnapshot, mergeSceneGraphPatch, normalizeSceneGraphSettings } from './scene-graph.js';
import { cleanCameraTransform as sanitizeCameraTransform, DEFAULT_CAMERA_TRANSFORM } from './camera.js';

function characterMap(project: ReplayProject): Map<string, ReplayCharacter> {
  return new Map(project.characters.map(c => [c.id, c]));
}

type ConcreteStagePosition = Exclude<StagePosition, 'auto'>;
interface AutoStageFrame {
  roster: string[];
  positions: Record<string, StagePosition>;
}

const STAGE_SLOTS: ConcreteStagePosition[] = ['left', 'center', 'right'];

const DEFAULT_CG_PRESENTATION: CgPresentation = { fit: 'contain', hideCharacters: false, hideTextbox: false, motion: 'none', mask: null, duration: 0.6 };

function sanitizeSceneMask(value?: SceneMaskSpec | null): SceneMaskSpec | null {
  if (!value || value.kind === 'none') return null;
  const kind = ['asset','node','circle','rect'].includes(String(value.kind)) ? value.kind : 'none';
  if (kind === 'none') return null;
  const animation = ['reveal','wipe-left','wipe-right'].includes(String(value.animation)) ? value.animation : 'none';
  return {
    kind: kind as SceneMaskSpec['kind'],
    ...(value.assetId ? { assetId: value.assetId } : {}),
    ...(value.nodeId ? { nodeId: value.nodeId } : {}),
    inverted: !!value.inverted,
    x: Math.max(-0.5, Math.min(1.5, Number(value.x ?? 0.5))),
    y: Math.max(-0.5, Math.min(1.5, Number(value.y ?? 0.5))),
    width: Math.max(0.01, Math.min(2, Number(value.width ?? 0.7))),
    height: Math.max(0.01, Math.min(2, Number(value.height ?? 0.7))),
    radius: Math.max(0.01, Math.min(1.5, Number(value.radius ?? 0.42))),
    feather: Math.max(0, Math.min(0.95, Number(value.feather ?? 0.08))),
    animation: animation as SceneMaskSpec['animation'],
    duration: Number.isFinite(Number(value.duration)) ? Math.max(0.05, Math.min(30, Number(value.duration))) : undefined
  };
}

function sanitizeCgPresentation(value?: Partial<CgPresentation> | null): CgPresentation {
  return {
    fit: value?.fit === 'cover' ? 'cover' : 'contain',
    hideCharacters: !!value?.hideCharacters,
    hideTextbox: !!value?.hideTextbox,
    motion: ['slow-push','pan-left','pan-right'].includes(String(value?.motion)) ? value!.motion as CgPresentation['motion'] : 'none',
    mask: sanitizeSceneMask(value?.mask),
    duration: Number.isFinite(Number(value?.duration)) ? Math.max(0.05, Math.min(30, Number(value!.duration))) : 0.6
  };
}

function sanitizeStageTransform(value: StageTransform): StageTransform {
  const finite = (input: number, fallback: number) => Number.isFinite(Number(input)) ? Number(input) : fallback;
  const facing = value.facing === 'left' || value.facing === 'right' || value.facing === 'neutral' ? value.facing : undefined;
  return {
    x: Math.max(-0.5, Math.min(1.5, finite(value.x, 0.5))),
    y: Math.max(-0.5, Math.min(1.5, finite(value.y, 0.88))),
    scale: Math.max(0.2, Math.min(4, finite(value.scale, 1))),
    ...(value.depth !== undefined && Number.isFinite(Number(value.depth)) ? { depth: Math.max(0, Math.min(1, Number(value.depth))) } : {}),
    ...(facing ? { facing } : {})
  };
}

function visibleSpeaker(line: ReplayLine, chars: Map<string, ReplayCharacter>): string | null {
  const character = chars.get(line.speakerId);
  if (!character?.showOnStage) return null;
  return line.type === 'dialogue' || line.type === 'dice' ? character.id : null;
}

function buildSceneKeys(lines: ReplayLine[]): string[] {
  let chapterOrdinal = 0;
  let sceneOrdinal = 0;
  return lines.map(line => {
    if (line.chapterTitle) {
      chapterOrdinal += 1;
      sceneOrdinal = 0;
    }
    if (line.sceneTitle) sceneOrdinal += 1;
    return `${chapterOrdinal}:${sceneOrdinal}`;
  });
}

function stageDistance(a: ConcreteStagePosition, b: ConcreteStagePosition): number {
  if (a === b) return 0;
  if (a === 'center' || b === 'center') return 4;
  return 12;
}

function assignments(ids: string[]): Array<Record<string, ConcreteStagePosition>> {
  const out: Array<Record<string, ConcreteStagePosition>> = [];
  const walk = (index: number, remaining: ConcreteStagePosition[], current: Record<string, ConcreteStagePosition>) => {
    if (index >= ids.length) {
      out.push({ ...current });
      return;
    }
    for (const slot of remaining) {
      current[ids[index]!] = slot;
      walk(index + 1, remaining.filter(candidate => candidate !== slot), current);
    }
    delete current[ids[index]!];
  };
  walk(0, STAGE_SLOTS, {});
  return out;
}

/**
 * Choose left/center/right as a tiny deterministic blocking solver.
 *
 * Priorities are deliberately ordered as:
 * 1. explicit per-line placement;
 * 2. preserve spatial continuity from the previous line;
 * 3. respect character default positions;
 * 4. use conventional VN 1/2/3-person composition;
 * 5. when a third actor newly joins a two-person conversation, prefer center.
 */
function solveStagePositions(
  roster: string[],
  chars: Map<string, ReplayCharacter>,
  line: ReplayLine,
  previous: Record<string, StagePosition>,
  entrantId: string | null
): Record<string, StagePosition> {
  if (!roster.length) return {};
  if (roster.length > 3) {
    const fallback: Record<string, StagePosition> = {};
    roster.forEach((id, index) => {
      fallback[id] = line.stagePositions?.[id]
        ?? (chars.get(id)?.defaultPosition !== 'auto' ? chars.get(id)!.defaultPosition : STAGE_SLOTS[Math.min(index, 2)]!);
    });
    return fallback;
  }

  let best: Record<string, ConcreteStagePosition> | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  for (const candidate of assignments(roster)) {
    let cost = 0;
    for (const id of roster) {
      const slot = candidate[id]!;
      const explicit = line.stagePositions?.[id];
      if (explicit && explicit !== 'auto' && explicit !== slot) cost += 10_000;

      const previousSlot = previous[id];
      if (previousSlot && previousSlot !== 'auto') cost += stageDistance(previousSlot, slot) * 3;

      const preferred = chars.get(id)?.defaultPosition;
      if (preferred && preferred !== 'auto') cost += preferred === slot ? -10 : 12;

      if (roster.length === 1) cost += slot === 'center' ? 0 : 8;
      else if (roster.length === 2) cost += slot === 'center' ? 18 : 0;
    }

    if (roster.length === 3 && entrantId && roster.includes(entrantId)) {
      cost += candidate[entrantId] === 'center' ? -14 : 6;
    }

    if (cost < bestCost) {
      best = candidate;
      bestCost = cost;
    }
  }

  return best ?? {};
}

/** Legacy 0.40 automatic roster: most-recent distinct visible speakers. */
function applyStageCommand(
  line: ReplayLine,
  roster: string[],
  positions: Record<string, StagePosition>,
  chars: Map<string, ReplayCharacter>,
  maxOnStage: number,
  lastActive?: Map<string, number>,
  index = 0
): { roster: string[]; positions: Record<string, StagePosition> } {
  const command = line.type === 'command' ? line.command : null;
  if (!command || !['enter', 'dismiss', 'move'].includes(command.kind) || !command.characterId) return { roster, positions };
  const id = command.characterId;
  if (command.kind === 'move') {
    if (!roster.includes(id) || !command.position || command.position === 'auto') return { roster, positions };
    return { roster, positions: { ...positions, [id]: command.position } };
  }
  if (command.kind === 'dismiss') {
    const nextRoster = roster.filter(item => item !== id);
    const nextPositions = { ...positions };
    delete nextPositions[id];
    lastActive?.delete(id);
    return { roster: nextRoster, positions: nextPositions };
  }
  if (!chars.get(id)?.showOnStage) return { roster, positions };
  let nextRoster = roster.filter(item => item !== id);
  if (nextRoster.length >= maxOnStage) {
    let victim = nextRoster[0]!;
    let seen = lastActive?.get(victim) ?? -1;
    for (const candidate of nextRoster.slice(1)) {
      const candidateSeen = lastActive?.get(candidate) ?? -1;
      if (candidateSeen < seen) { victim = candidate; seen = candidateSeen; }
    }
    nextRoster = nextRoster.filter(item => item !== victim);
    const trimmed = { ...positions };
    delete trimmed[victim];
    positions = trimmed;
    lastActive?.delete(victim);
  }
  nextRoster.push(id);
  const nextPositions = { ...positions };
  if (command.position && command.position !== 'auto') nextPositions[id] = command.position;
  lastActive?.set(id, index);
  return { roster: nextRoster, positions: nextPositions };
}

function commandBlockingLine(line: ReplayLine): ReplayLine {
  const command = line.type === 'command' ? line.command : null;
  if ((command?.kind !== 'enter' && command?.kind !== 'move') || !command.characterId || !command.position || command.position === 'auto') return line;
  return { ...line, stagePositions: { ...(line.stagePositions ?? {}), [command.characterId]: command.position } };
}

function buildRecentAutoFrames(project: ReplayProject, chars: Map<string, ReplayCharacter>): AutoStageFrame[] {
  const maxOnStage = project.settings.maxOnStage;
  const recent: string[] = [];
  const frames: AutoStageFrame[] = new Array(project.lines.length);
  let previousPositions: Record<string, StagePosition> = {};

  for (let index = 0; index < project.lines.length; index += 1) {
    const line = project.lines[index]!;
    const commandStage = applyStageCommand(line, recent, previousPositions, chars, maxOnStage, undefined, index);
    recent.splice(0, recent.length, ...commandStage.roster);
    previousPositions = commandStage.positions;
    const speakerId = visibleSpeaker(line, chars);
    if (speakerId) {
      const previous = recent.indexOf(speakerId);
      if (previous >= 0) recent.splice(previous, 1);
      recent.push(speakerId);
      while (recent.length > maxOnStage) recent.shift();
    }
    const positions = solveStagePositions(recent, chars, commandBlockingLine(line), previousPositions, speakerId && !previousPositions[speakerId] ? speakerId : null);
    frames[index] = { roster: [...recent], positions };
    previousPositions = positions;
  }
  return frames;
}

/**
 * VN-style automatic blocking.
 *
 * Actors remain on stage after they speak; alternating dialogue changes focus,
 * not roster order. Slot affinity is carried forward inside a Scene, so A/B do
 * not swap sides simply because the speaker changes. A structured Scene/Chapter
 * boundary resets the automatic conversation cluster.
 */
function buildContinuityAutoFrames(project: ReplayProject, chars: Map<string, ReplayCharacter>): AutoStageFrame[] {
  const maxOnStage = project.settings.maxOnStage;
  const frames: AutoStageFrame[] = new Array(project.lines.length);
  let roster: string[] = [];
  let positions: Record<string, StagePosition> = {};
  const lastActive = new Map<string, number>();
  const sceneKeys = buildSceneKeys(project.lines);
  let previousScene = '';

  for (let index = 0; index < project.lines.length; index += 1) {
    const line = project.lines[index]!;
    const scene = sceneKeys[index] ?? '0:0';
    if (index > 0 && scene !== previousScene) {
      roster = [];
      positions = {};
      lastActive.clear();
    }
    previousScene = scene;

    const commandStage = applyStageCommand(line, roster, positions, chars, maxOnStage, lastActive, index);
    roster = commandStage.roster;
    positions = commandStage.positions;

    // A hand-arranged line becomes a useful continuity seed for the following
    // automatic lines, while the compiler still renders the custom line exactly.
    if (line.stageMode === 'custom') {
      roster = (line.stageIds ?? []).filter(id => chars.get(id)?.showOnStage).slice(0, maxOnStage);
      const seeded: Record<string, StagePosition> = {};
      for (const id of roster) {
        const explicit = line.stagePositions?.[id];
        if (explicit && explicit !== 'auto') seeded[id] = explicit;
      }
      positions = solveStagePositions(roster, chars, line, { ...positions, ...seeded }, null);
      roster.forEach(id => lastActive.set(id, index));
      frames[index] = { roster: [...roster], positions: { ...positions } };
      continue;
    }

    const speakerId = visibleSpeaker(line, chars);
    let entrantId: string | null = null;
    if (speakerId) {
      if (!roster.includes(speakerId)) {
        entrantId = speakerId;
        if (roster.length >= maxOnStage) {
          let victim = roster[0]!;
          let victimSeen = lastActive.get(victim) ?? -1;
          for (const id of roster.slice(1)) {
            const seen = lastActive.get(id) ?? -1;
            if (seen < victimSeen) {
              victim = id;
              victimSeen = seen;
            }
          }
          roster = roster.filter(id => id !== victim);
          delete positions[victim];
          lastActive.delete(victim);
        }
        roster.push(speakerId);
      }
      lastActive.set(speakerId, index);
    }

    positions = solveStagePositions(roster, chars, commandBlockingLine(line), positions, entrantId);
    frames[index] = { roster: [...roster], positions: { ...positions } };
  }
  return frames;
}

function buildAutoStageFrames(project: ReplayProject, chars: Map<string, ReplayCharacter>): AutoStageFrame[] {
  return project.settings.autoStageMode === 'recent'
    ? buildRecentAutoFrames(project, chars)
    : buildContinuityAutoFrames(project, chars);
}


function buildPerformanceDirectorBeats(project: ReplayProject, autoFrames: AutoStageFrame[]): DirectorBeat[] {
  const beats = buildDirectorBeats(project).map(beat => structuredClone(beat));
  const byTarget = new Map<string, DirectorBeat>();
  for (const beat of beats) if (beat.targetLineId) byTarget.set(beat.targetLineId, beat);

  let previous: AutoStageFrame = { roster: [], positions: {} };
  for (let index = 0; index < project.lines.length; index += 1) {
    const line = project.lines[index]!;
    const frame = autoFrames[index] ?? { roster: [], positions: {} };
    if (line.type === 'command' || line.stageMode === 'custom') { previous = frame; continue; }
    const changes: DirectorBeatChange[] = [];
    const previousSet = new Set(previous.roster);
    const currentSet = new Set(frame.roster);
    for (const id of frame.roster) {
      const character = project.characters.find(c => c.id === id);
      if (!previousSet.has(id)) changes.push({ kind: 'auto-blocking', characterId: id, label: `${character?.name ?? id} 自动上场 · ${frame.positions[id] ?? 'auto'}` });
      else if ((previous.positions[id] ?? 'auto') !== (frame.positions[id] ?? 'auto')) changes.push({ kind: 'auto-blocking', characterId: id, label: `${character?.name ?? id} 自动移到 ${frame.positions[id] ?? 'auto'}` });
    }
    for (const id of previous.roster) if (!currentSet.has(id)) {
      const character = project.characters.find(c => c.id === id);
      changes.push({ kind: 'auto-blocking', characterId: id, label: `${character?.name ?? id} 自动退场` });
    }
    if (line.stageMethod?.name) changes.push({ kind: 'motion', label: `动作 · ${line.stageMethod.name}` });
    if (changes.length) {
      let beat = byTarget.get(line.id);
      if (!beat) {
        beat = { id: `beat:auto:${line.id}`, timingMode: 'parallel', startIndex: index, endIndex: index, commandLineIds: [], targetLineId: line.id, changes: [], summary: '' };
        beats.push(beat);
        byTarget.set(line.id, beat);
      }
      beat.changes.push(...changes);
      const labels = beat.changes.map(change => change.label);
      beat.summary = labels.slice(0, 3).join(' · ') + (labels.length > 3 ? ` · +${labels.length - 3}` : '');
    }
    previous = frame;
  }
  return beats.sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);
}

function emoteFromCommand(command: ReplayDirectorCommand): ScreenEmote {
  return { characterId: command.characterId ?? '', kind: (command.value ?? 'surprise') as EmoteKind, offset: 0, duration: Math.max(0.01, Number(command.duration) || 1.6) };
}

function shakeFromCommand(command: ReplayDirectorCommand): ScreenShake {
  const [pattern, amplitude, frequency] = String(command.value ?? '').split(' ');
  return { offset: 0, duration: Math.max(0.01, Number(command.duration) || 1), amplitude: Number(amplitude) || 12, frequency: Number(frequency) || 14, pattern: pattern === 'fixed' ? 'fixed' : 'random' };
}

export function compilePerformance(project: ReplayProject): PerformanceDocument {
  const chars = characterMap(project);
  const assets = new Map<string, MediaAsset>(project.assets.map(asset => [asset.id, asset]));
  const autoFrames = buildAutoStageFrames(project, chars);
  const sceneKeys = buildSceneKeys(project.lines);
  const state: PerformanceState = { background: null, cg: null, cgPresentation: { ...DEFAULT_CG_PRESENTATION }, customObjects: {}, bgm: null, ambient: null, roster: [], expressions: {}, characterVisuals: {}, bubble: null };
  const directorBeats = buildPerformanceDirectorBeats(project, autoFrames);
  const beatByLineId = new Map<string, DirectorBeat>();
  for (const beat of directorBeats) { for (const id of beat.commandLineIds) beatByLineId.set(id, beat); if (beat.targetLineId) beatByLineId.set(beat.targetLineId, beat); }
  const projectLineById = new Map(project.lines.map(line => [line.id, line]));
  const parallelCommandIds = new Set<string>();
  const parallelCameraByTarget = new Map<string, CameraEffect>();
  const parallelTransitionByTarget = new Map<string, TransitionEffect>();
  const parallelMotionsByTarget = new Map<string, Map<string, { name: string; duration: number }>>();
  for (const beat of directorBeats) {
    if (beat.timingMode !== 'parallel' || !beat.targetLineId || !beat.commandLineIds.length) continue;
    for (const id of beat.commandLineIds) {
      parallelCommandIds.add(id);
      const source = projectLineById.get(id);
      const command = source?.command;
      if (!command) continue;
      if (command.kind === 'camera' && command.value) parallelCameraByTarget.set(beat.targetLineId, command.value as CameraEffect);
      if (command.kind === 'transition' && command.value) parallelTransitionByTarget.set(beat.targetLineId, command.value as TransitionEffect);
      if (command.kind === 'motion' && command.characterId && command.value) {
        const motions = parallelMotionsByTarget.get(beat.targetLineId) ?? new Map();
        motions.set(command.characterId, { name: command.value, duration: Math.max(0.01, Number(command.duration) || 0.5) });
        parallelMotionsByTarget.set(beat.targetLineId, motions);
      }
    }
  }
  const lines: PerformanceDocument['lines'] = [];
  let cursor = 0;
  let currentFilter: ScreenFilterKind | null = null;
  let explicitPositions: Record<string, StagePosition> = {};
  // Once a row uses enter/exit, state.roster owns the stage (it may legitimately be empty).
  let explicitStage = false;
  let carriedTransforms: Record<string, StageTransform> = {};
  let carriedCameraTransform: CameraTransform = { ...DEFAULT_CAMERA_TRANSFORM };
  let currentSceneKey = sceneKeys[0] ?? '0:0';
  const projectSceneGraph = normalizeSceneGraphSettings(project.sceneGraph);
  let sceneGraphState: SceneGraphSettings = normalizeSceneGraphSettings(projectSceneGraph);

  // Per-line puppet overrides as of the previous pushed line (for transitions).
  let carriedPuppet: Record<string, Record<string, number>> = {};
  let carriedPuppetExpressions: Record<string, string> = {};
  let carriedPuppetRoster = new Set<string>();

  project.lines.forEach((line, index) => {
    const parallelCommand = line.type === 'command' && parallelCommandIds.has(line.id);
    const parallelTargetMotions = parallelMotionsByTarget.get(line.id);
    const commandMotion = line.type === 'command' && line.command?.kind === 'motion' && line.command.characterId && line.command.value
      ? { characterId: line.command.characterId, spec: { name: line.command.value, duration: Math.max(0.01, Number(line.command.duration) || 0.5) } }
      : null;
    for (const visual of Object.values(state.characterVisuals)) visual.motion = null;
    const sceneKey = sceneKeys[index] ?? '0:0';
    if (index > 0 && sceneKey !== currentSceneKey) {
      carriedTransforms = {};
      for (const visual of Object.values(state.characterVisuals)) delete visual.transform;
      carriedCameraTransform = { ...DEFAULT_CAMERA_TRANSFORM };
      sceneGraphState = normalizeSceneGraphSettings(projectSceneGraph);
    }
    currentSceneKey = sceneKey;
    let cameraPlacementSource: 'auto' | 'manual' | 'inherited' = carriedCameraTransform.zoom !== 1 || carriedCameraTransform.x !== 0.5 || carriedCameraTransform.y !== 0.5 || !!carriedCameraTransform.yaw || !!carriedCameraTransform.pitch ? 'inherited' : 'auto';
    if (line.cameraTransform === null) {
      carriedCameraTransform = { ...DEFAULT_CAMERA_TRANSFORM };
      cameraPlacementSource = 'manual';
    } else if (line.cameraTransform) {
      carriedCameraTransform = sanitizeCameraTransform(line.cameraTransform);
      cameraPlacementSource = 'manual';
    }
    const localTransformIds = new Set<string>();
    for (const [id, rawTransform] of Object.entries(line.stageTransforms ?? {})) {
      if (rawTransform === null) { delete carriedTransforms[id]; if (state.characterVisuals[id]) delete state.characterVisuals[id]!.transform; continue; }
      carriedTransforms[id] = sanitizeStageTransform(rawTransform);
      localTransformIds.add(id);
    }

    // Preserve the historical index-0 behavior: a first-line enter/exit event
    // seeds from the first automatically-directed frame.
    const previousAutoFrame = autoFrames[Math.max(0, index - 1)] ?? { roster: [], positions: {} };
    if (!explicitStage && (line.scene?.enterIds?.length || line.scene?.exitIds?.length)) {
      explicitStage = true;
      state.roster = [...previousAutoFrame.roster];
      explicitPositions = { ...previousAutoFrame.positions };
    }

    if (line.scene && Object.prototype.hasOwnProperty.call(line.scene, 'background')) state.background = line.scene.background ?? null;
    if (line.scene && Object.prototype.hasOwnProperty.call(line.scene, 'cg')) state.cg = line.scene.cg ?? null;
    if (line.scene?.cgPresentation) state.cgPresentation = sanitizeCgPresentation({ ...state.cgPresentation, ...line.scene.cgPresentation });
    if (line.scene?.sceneGraph) sceneGraphState = mergeSceneGraphPatch(sceneGraphState, line.scene.sceneGraph);
    if (line.scene && Object.prototype.hasOwnProperty.call(line.scene, 'bgm')) state.bgm = line.scene.bgm ?? null;
    if (line.scene && Object.prototype.hasOwnProperty.call(line.scene, 'ambient')) state.ambient = line.scene.ambient ?? null;

    if (line.type === 'command' && line.command) {
      const command = line.command;
      if (command.kind === 'background') state.background = command.assetId ?? null;
      if (command.kind === 'cg') state.cg = command.assetId ?? null;
      if (command.kind === 'object' && command.objectId) {
        const object = project.customObjects.find(item => item.id === command.objectId);
        if (object) {
          const previousObject = state.customObjects[object.id];
          const action = command.objectAction ?? 'show';
          const initial = object.initialStateId ?? object.states[0]?.id ?? null;
          const nextStateId = command.objectStateId ?? previousObject?.stateId ?? initial;
          state.customObjects[object.id] = {
            objectId: object.id,
            visible: action === 'hide' ? false : previousObject?.visible ?? false,
            stateId: nextStateId,
            transform: { ...(previousObject?.transform ?? object.transform), ...(action === 'transform' ? (command.objectTransform ?? {}) : {}) }
          };
          if (action === 'show') state.customObjects[object.id]!.visible = true;
          if (action === 'state' && previousObject == null) state.customObjects[object.id]!.visible = true;
        }
      }
      if (command.kind === 'bgm') state.bgm = command.assetId ?? null;
      if (command.kind === 'ambient') state.ambient = command.assetId ?? null;
      if (command.kind === 'expression' && command.characterId) {
        const expression = command.expression ?? 'default';
        state.expressions[command.characterId] = expression;
        const previous = state.characterVisuals[command.characterId];
        state.characterVisuals[command.characterId] = { ...(previous ?? { position: 'auto' }), expression };
      }
    }

    for (const id of line.scene?.exitIds ?? []) {
      state.roster = state.roster.filter(x => x !== id);
      delete explicitPositions[id];
      delete carriedTransforms[id];
    }
    if (line.type === 'command' && line.command?.kind === 'dismiss' && line.command.characterId) delete carriedTransforms[line.command.characterId];
    for (const id of line.scene?.enterIds ?? []) if (!state.roster.includes(id)) state.roster.push(id);
    if (explicitStage) {
      const applied = applyStageCommand(line, state.roster, explicitPositions, chars, project.settings.maxOnStage);
      state.roster = [...applied.roster];
      explicitPositions = applied.positions;
      const joining = visibleSpeaker(line, chars);
      if (joining && line.stageMode !== 'custom' && !state.roster.includes(joining) && !line.scene?.exitIds?.includes(joining)) {
        while (state.roster.length >= project.settings.maxOnStage) state.roster.shift();
        state.roster.push(joining);
      }
    }

    for (const [id, expression] of Object.entries(line.scene?.expressions ?? {})) {
      if (!expression) continue;
      state.expressions[id] = expression;
      state.characterVisuals[id] = { ...(state.characterVisuals[id] ?? { position: 'auto' }), expression };
    }
    if (line.expressionMode === 'set' && line.expression) {
      state.expressions[line.speakerId] = line.expression;
      const previous = state.characterVisuals[line.speakerId];
      state.characterVisuals[line.speakerId] = { ...(previous ?? { position: 'auto' }), expression: line.expression };
    }

    let roster: string[];
    let positions: Record<string, StagePosition>;
    if (line.stageMode === 'custom') {
      roster = (line.stageIds ?? []).filter(id => chars.has(id));
      positions = solveStagePositions(roster, chars, line, { ...(autoFrames[index]?.positions ?? {}), ...(explicitStage ? explicitPositions : {}) }, null);
    } else if (explicitStage) {
      roster = state.roster.filter(id => chars.get(id)?.showOnStage);
      positions = solveStagePositions(roster, chars, commandBlockingLine(line), explicitPositions, null);
      explicitPositions = { ...positions };
    } else {
      const frame = autoFrames[index] ?? { roster: [], positions: {} };
      roster = frame.roster;
      positions = frame.positions;
    }

    for (const id of roster) {
      const previous = state.characterVisuals[id];
      const transform = carriedTransforms[id] ? { ...carriedTransforms[id] } : previous?.transform ? { ...previous.transform } : undefined;
      const expression = state.expressions[id] ?? previous?.expression ?? 'default';
      state.expressions[id] = expression;
      const actorMotion = parallelTargetMotions?.get(id)
        ?? (commandMotion?.characterId === id ? commandMotion.spec : null)
        ?? (id === line.speakerId && line.stageMethod ? line.stageMethod : null);
      state.characterVisuals[id] = {
        ...(previous ?? {}),
        expression,
        position: positions[id] ?? previous?.position ?? 'auto',
        ...(transform ? { transform, facing: transform.facing ?? previous?.facing ?? null } : {}),
        motion: actorMotion?.name ?? null
      };
    }

    if (line.type === 'command' && line.command?.kind === 'filter') currentFilter = line.command.value && line.command.value !== 'none' ? line.command.value as ScreenFilterKind : null;
    const tagged = line.type === 'command' ? { plain: line.text, ranges: [] } : parseTextTags(line.text);
    const voiceDuration = line.audioAssetId ? Number(assets.get(line.audioAssetId)?.metadata?.duration) : NaN;
    const speaker = chars.get(line.speakerId);
    const speech = line.type === 'command'
      ? { text: '', language: project.settings.logLanguage || 'auto', translationPending: false }
      : resolveCachedSpeech(project, line);
    const pauseExtra = line.type === 'command' ? 0 : speechPauseExtraSeconds(speech.text, resolveSpeechPauseScale(project, line), resolvePunctuationPauseTiming(project, line));
    const commandDuration = line.command?.kind === 'wait' ? Math.max(0, Number(line.command.duration) || 0)
      : line.command?.kind === 'flash' ? Math.max(0.01, Number(line.command.duration) || 0.5)
      : line.command?.kind === 'card' ? Math.max(0.01, Number(line.command.duration) || 2.6)
      : line.command?.kind === 'motion' ? Math.max(0.01, Number(line.command.duration) || 0.5)
      : line.command?.kind === 'camera' ? Math.max(0.2, line.duration ?? 0.5)
      : line.command?.kind === 'transition' ? Math.max(0.2, line.duration ?? (Number(line.command.duration) || (line.command.value === 'fade' || line.command.value === 'cut' ? 0.42 : 0.7)))
      : 0.04;
    const voiceHold = Math.max(0, Number(line.audioMix?.preRoll) || 0) + Math.max(0, Number(line.audioMix?.postRoll) || 0) + Math.max(0, Number(line.audioMix?.voiceOffset) || 0);
    const duration = line.type === 'command'
      ? (parallelCommand && line.command?.kind !== 'wait' && line.command?.kind !== 'flash' && line.command?.kind !== 'card' ? 0 : Math.max(0, line.duration ?? commandDuration))
      : Math.max(0.2, line.duration ?? (Number.isFinite(voiceDuration) && voiceDuration > 0 ? voiceDuration + voiceHold : estimateDuration(tagged.plain) + pauseExtra));
    const start = cursor;
    const end = start + duration;
    const performanceSpeakerId = commandMotion?.characterId ?? line.speakerId;
    const performanceSpeaker = chars.get(performanceSpeakerId) ?? speaker;
    const performanceStage = roster.map(id => ({
      characterId: id,
      name: chars.get(id)?.name ?? id,
      position: positions[id] ?? 'auto',
      active: id === performanceSpeakerId,
      ...(carriedTransforms[id] ? { transform: { ...carriedTransforms[id] } } : {}),
      ...((parallelTargetMotions?.get(id) ?? (commandMotion?.characterId === id ? commandMotion.spec : null) ?? (id === line.speakerId && line.stageMethod ? line.stageMethod : null))
        ? { motion: { ...(parallelTargetMotions?.get(id) ?? (commandMotion?.characterId === id ? commandMotion.spec : line.stageMethod!)) } }
        : {}),
      placementSource: (localTransformIds.has(id) || (line.stageMode === 'custom' && !!line.stagePositions?.[id])
        ? 'manual'
        : carriedTransforms[id] ? 'inherited' : 'auto') as 'auto' | 'manual' | 'inherited'
    }));
    // Trigger words pick a sprite for this line only; an explicit expression on the line wins.
    const moodExpression = line.type === 'dialogue' && line.expressionMode !== 'set' && !line.scene?.expressions?.[line.speakerId]
      ? triggeredExpression(chars.get(line.speakerId)?.expressionTriggers, lineMoodText(line)) : null;
    const performanceState: PerformanceState = {
      background: state.background,
      cg: state.cg,
      cgPresentation: { ...state.cgPresentation },
      customObjects: Object.fromEntries(Object.entries(state.customObjects).map(([id, object]) => [id, { ...object, transform: { ...object.transform } }])),
      bgm: state.bgm,
      ambient: state.ambient,
      roster: [...roster],
      expressions: { ...state.expressions, ...(moodExpression ? { [line.speakerId]: moodExpression } : {}) },
      characterVisuals: Object.fromEntries(Object.entries(state.characterVisuals).map(([id, visual]) => [id, { ...visual, ...(visual.transform ? { transform: { ...visual.transform } } : {}) }])),
      bubble: line.bubble ? { ...line.bubble, metadata: line.bubble.metadata ? { ...line.bubble.metadata } : undefined } : state.bubble ? { ...state.bubble } : null
    };
    const blip = line.type !== 'command' && !line.audioAssetId && ['dialogue', 'narration', 'system'].includes(line.type) ? chars.get(line.speakerId)?.textBlip ?? null : null;
    const performanceTransition = parallelTransitionByTarget.get(line.id) ?? (line.type === 'command' && line.command?.kind === 'transition' ? (line.command.value as any) : line.scene?.transition ?? 'cut');
    const puppet = resolveLinePuppet(line, carriedPuppet, carriedPuppetExpressions, carriedPuppetRoster, performanceState);
    carriedPuppet = puppet.params;
    carriedPuppetExpressions = { ...performanceState.expressions };
    carriedPuppetRoster = new Set(performanceState.roster);
    lines.push({
      index: index + 1,
      lineId: line.id,
      start,
      end,
      duration,
      speakerId: performanceSpeakerId,
      speakerName: performanceSpeaker?.name ?? 'Unknown',
      type: line.type,
      text: tagged.plain,
      textEffect: blip && (line.textEffect ?? 'all') === 'all' ? 'w2w' : line.textEffect ?? 'all',
      textEffectDuration: Math.max(0, line.textEffectDuration ?? Math.min(duration * 0.72, Math.max(0.35, Array.from(tagged.plain).length * 0.055))),
      ...(tagged.ranges.length ? { textTags: tagged.ranges } : {}),
      ...(blip ? { textBlip: { ...blip } } : {}),
      screenFilter: currentFilter,
      ...(line.type === 'command' && line.command?.kind === 'emote' && line.command.characterId ? { emoteEvent: emoteFromCommand(line.command) } : {}),
      ...(line.type === 'command' && line.command?.kind === 'card' ? { card: { title: line.command.value ?? '', subtitle: line.command.target ?? '', duration } } : {}),
      speechText: speech.text,
      speechLanguage: speech.language,
      translationPending: speech.translationPending,
      chapterTitle: line.chapterTitle,
      sceneTitle: line.sceneTitle,
      expression: moodExpression ?? state.expressions[line.speakerId] ?? line.expression ?? 'default',
      mouth: line.mouth ?? 'auto',
      mouthCues: line.mouthCues ?? [],
      ...(Object.keys(puppet.params).length ? { puppetParams: puppet.params } : {}),
      ...(Object.keys(puppet.from).length ? { puppetFrom: puppet.from } : {}),
      stage: performanceStage,
      state: performanceState,
      camera: parallelCameraByTarget.get(line.id) ?? (line.type === 'command' && line.command?.kind === 'camera' ? (line.command.value as any) : line.scene?.camera ?? 'none'),
      cameraTransform: { ...carriedCameraTransform },
      cameraPlacementSource,
      transition: performanceTransition,
      cameraCurve: line.scene?.cameraCurve ?? 'sigmoid',
      transitionCurve: line.scene?.transitionCurve ?? 'quadraticR',
      backgroundChanged: (line.type === 'command' && line.command?.kind === 'background') || (!!line.scene && Object.prototype.hasOwnProperty.call(line.scene, 'background')),
      backgroundMethod: line.scene?.backgroundMethod ?? 'replace',
      backgroundMethodDuration: Math.max(0, line.scene?.backgroundMethodDuration ?? 0.5),
      diceRolls: (line.diceRolls ?? []).map(roll => ({ ...roll })),
      hitPoint: line.hitPoint ? { ...line.hitPoint } : null,
      wheel: line.wheel ? { ...line.wheel, steps: line.wheel.steps.map(step => ({ ...step, options: step.options.map(option => ({ ...option })) })), source: line.wheel.source ? { ...line.wheel.source } : undefined, metadata: line.wheel.metadata ? { ...line.wheel.metadata } : undefined } : null,
      bubble: line.bubble ? { ...line.bubble, metadata: line.bubble.metadata ? { ...line.bubble.metadata } : undefined } : null,
      dialogueStyleId: line.dialogueStyleId ?? null,
      stageMethod: commandMotion ? { ...commandMotion.spec } : line.stageMethod ? { ...line.stageMethod } : null,
      sceneGraph: buildSceneGraphSnapshot(project, { state: performanceState, stage: performanceStage, lineType: line.type, diceVisible: !!(line.diceRolls?.length), wheelVisible: !!line.wheel, hitPointVisible: !!line.hitPoint, transition: performanceTransition, sceneGraphSettings: sceneGraphState, cameraTransform: carriedCameraTransform }),
      directorBeatId: beatByLineId.get(line.id)?.id ?? null,
      audioAssetId: line.audioAssetId,
      sfxAssetId: line.type === 'command' && line.command?.kind === 'sfx' ? line.command.assetId : line.sfxAssetId,
      ...(line.type === 'command' && line.command?.kind === 'shake' ? { shakeEvent: shakeFromCommand(line.command) } : {}),
      ...(line.type === 'command' && line.command?.kind === 'flash' ? { flash: { color: line.command.value ?? '#000000', duration: Math.max(0.01, Number(line.command.duration) || 0.5) } } : {}),
      audioMix: { ...(line.audioMix ?? {}) },
      ...(line.type !== 'command' && line.duration != null ? { voiceClip: true } : {}),
      bgmFadeSeconds: line.scene?.bgmFadeSeconds ?? null
    });
    cursor = end + (index === project.lines.length - 1 ? 0 : line.type === 'command' ? 0 : 0.18);
  });

  // An emote stays up across the following lines like a shake does.
  for (const source of lines) {
    const emote = source.emoteEvent;
    if (!emote) continue;
    const from = source.start, until = source.start + emote.duration;
    for (const target of lines) {
      if (target.end <= from || target.start >= until) continue;
      (target.emotes ??= []).push({ ...emote, offset: from - target.start });
    }
  }

  // A shake keeps running across the following lines, so each line carries the part it overlaps.
  for (const source of lines) {
    const shake = source.shakeEvent;
    if (!shake) continue;
    const from = source.start, until = source.start + shake.duration;
    for (const target of lines) {
      if (target.end <= from || target.start >= until) continue;
      (target.shakes ??= []).push({ ...shake, offset: from - target.start });
    }
  }

  return {
    format: 'ReplayLabPerformance',
    version: '0.53',
    title: project.title,
    settings: { ...project.settings },
    sceneGraph: normalizeSceneGraphSettings(project.sceneGraph),
    characters: project.characters.map(c => ({
      ...c,
      stageFacing: {
        ...c.stageFacing,
        variants: c.stageFacing?.variants ? Object.fromEntries(Object.entries(c.stageFacing.variants).map(([direction, variant]) => [direction, {
          ...(variant ?? {}),
          images: { ...(variant?.images ?? {}) },
          expressions: Object.fromEntries(Object.entries(variant?.expressions ?? {}).map(([name, set]) => [name, { ...set }])),
          layers: { ...(variant?.layers ?? {}) },
          layerExpressions: Object.fromEntries(Object.entries(variant?.layerExpressions ?? {}).map(([name, set]) => [name, { ...set }]))
        }])) : undefined
      },
      images: { ...c.images },
      expressions: Object.fromEntries(Object.entries(c.expressions ?? {}).map(([name, set]) => [name, { ...set }])),
      layers: { ...(c.layers ?? {}) },
      layerExpressions: Object.fromEntries(Object.entries(c.layerExpressions ?? {}).map(([name, set]) => [name, { ...set }])),
      puppet: normalizePuppetRig(c.puppet),
      faceFit: normalizeFaceFit(c.faceFit)
    })),
    assets: project.assets.map(a => ({ ...a })),
    customObjects: (project.customObjects ?? []).map(object => ({ ...object, transform: { ...object.transform }, states: object.states.map(state => ({ ...state })), hotspots: object.hotspots.map(hotspot => ({ ...hotspot })), metadata: object.metadata ? { ...object.metadata } : undefined })),
    customObjectTakes: (project.customObjectTakes ?? []).map(take => ({ ...take, steps: take.steps.map(step => ({ ...step, transform: step.transform ? { ...step.transform } : undefined })) })),
    mediaDefinitions: (project.mediaDefinitions ?? []).map(def => ({ ...def, metadata: def.metadata ? { ...def.metadata } : undefined })),
    faceTemplates: (project.faceTemplates ?? []).map(template => ({ ...template, layers: { ...(template.layers ?? {}) } })),
    lines,
    directorBeats,
    duration: lines.at(-1)?.end ?? 0
  };
}

function cleanPuppetParams(input: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(input ?? {})) if (Number.isFinite(Number(value))) out[id] = Number(value);
  return out;
}

function samePuppetParams(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

/**
 * A line's puppet overrides, plus where to ease from: only for characters who
 * were already on stage in the same expression with different values. Command
 * lines carry the previous overrides unchanged (no transition, no reset).
 */
function resolveLinePuppet(
  line: ReplayLine,
  carried: Record<string, Record<string, number>>,
  carriedExpressions: Record<string, string>,
  carriedRoster: Set<string>,
  state: PerformanceState
): { params: Record<string, Record<string, number>>; from: Record<string, Record<string, number>> } {
  if (line.type === 'command') return { params: Object.fromEntries(Object.entries(carried).map(([id, v]) => [id, { ...v }])), from: {} };
  const params: Record<string, Record<string, number>> = {};
  const from: Record<string, Record<string, number>> = {};
  const ids = new Set([...Object.keys(carried), ...Object.keys(line.puppetParams ?? {})]);
  for (const id of ids) {
    const next = cleanPuppetParams(line.puppetParams?.[id]);
    const previous = carried[id] ?? {};
    if (Object.keys(next).length) params[id] = next;
    const sameExpression = (carriedExpressions[id] ?? 'default') === (state.expressions[id] ?? 'default');
    if (sameExpression && carriedRoster.has(id) && state.roster.includes(id) && !samePuppetParams(previous, next)) from[id] = { ...previous };
  }
  return { params, from };
}
