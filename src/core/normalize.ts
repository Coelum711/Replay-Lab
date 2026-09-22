import type { ReplayProject } from './types.js';
import { DEFAULT_SETTINGS } from './project.js';
import { defaultFaceFit, normalizeFaceFit } from './face.js';
import { normalizePuppetRig } from '../puppet/rig.js';
import { parseDirectorCommand } from './directives.js';
import { normalizeSceneGraphSettings } from './scene-graph.js';
import { normalizeProsodyCurve } from '../speech/prosody.js';
import { cleanCameraTransform } from './camera.js';

/**
 * Normalize an imported / recovered ReplayProject into the current runtime shape.
 *
 * This deliberately mutates and returns the supplied JSON object. Browser Studio,
 * CLI adapters and third-party callers should use the same entry point instead of
 * maintaining page-local compatibility shims.
 */
export function normalizeReplayProject(input: ReplayProject | Record<string, any>): ReplayProject {
  const project = input as ReplayProject & Record<string, any>;
  project.format = 'ReplayLabProject';
  project.version = '0.53';
  project.title = String(project.title || 'Untitled Replay');
  project.characters ??= [];
  project.lines ??= [];
  project.assets ??= [];
  project.customObjects ??= [];
  project.customObjectTakes ??= [];
  project.mediaDefinitions ??= [];
  project.faceTemplates ??= [];
  const incomingSettings = project.settings ?? {};
  const incomingAudioMix = incomingSettings.audioMix;
  const legacyBgmVolume = incomingSettings.bgmVolume;
  const legacySfxVolume = incomingSettings.sfxVolume;
  project.settings = { ...DEFAULT_SETTINGS, ...incomingSettings };
  // 0.53.2: spoken/TTS language is independent from the imported Log language.
  // Old projects inherit Log language so their existing speech behavior does not change.
  if (!incomingSettings.speechLanguage) project.settings.speechLanguage = 'auto';
  project.settings.audioMix = {
    ...DEFAULT_SETTINGS.audioMix,
    ...(incomingAudioMix ?? {}),
    ducking: { ...DEFAULT_SETTINGS.audioMix.ducking, ...(incomingAudioMix?.ducking ?? {}) },
    limiter: { ...DEFAULT_SETTINGS.audioMix.limiter, ...(incomingAudioMix?.limiter ?? {}) }
  };
  // 0.53 migration: old projects/templates only had bgmVolume/sfxVolume.
  // Preserve those values when no explicit Audio Mix block existed yet.
  if (!incomingAudioMix && Number.isFinite(Number(legacyBgmVolume))) project.settings.audioMix.bgmVolume = Number(legacyBgmVolume);
  if (!incomingAudioMix && Number.isFinite(Number(legacySfxVolume))) project.settings.audioMix.sfxVolume = Number(legacySfxVolume);
  // Keep legacy volume fields synchronized for old exporters/templates.
  project.settings.bgmVolume = project.settings.audioMix.bgmVolume;
  project.settings.sfxVolume = project.settings.audioMix.sfxVolume;
  project.sceneGraph = normalizeSceneGraphSettings(project.sceneGraph);
  if (!Number.isFinite(Number(project.settings.speechPauseScale))) project.settings.speechPauseScale = 1;


  for (const object of project.customObjects) {
    object.template = ['blank','illustration','document','map','phone','title-card'].includes(object.template as any) ? object.template : 'blank';
    object.interactionMode = ['none','inspect','stateful','pan-zoom','hotspots'].includes(object.interactionMode as any) ? object.interactionMode : 'none';
    object.states ??= [];
    object.hotspots ??= [];
    for (const hotspot of object.hotspots) {
      hotspot.stateId ??= null;
      hotspot.action = ['none','state','hide','note'].includes(hotspot.action as any) ? hotspot.action : hotspot.targetStateId ? 'state' : 'none';
      hotspot.x = Math.max(0, Math.min(1, Number(hotspot.x) || 0));
      hotspot.y = Math.max(0, Math.min(1, Number(hotspot.y) || 0));
      hotspot.width = Math.max(0.01, Math.min(1 - hotspot.x, Number(hotspot.width) || 0.2));
      hotspot.height = Math.max(0.01, Math.min(1 - hotspot.y, Number(hotspot.height) || 0.2));
    }
    object.transform ??= { x: 0.5, y: 0.5, scale: 0.6, rotation: 0 };
    object.transform.x = Math.max(-0.5, Math.min(1.5, Number.isFinite(Number(object.transform.x)) ? Number(object.transform.x) : 0.5));
    object.transform.y = Math.max(-0.5, Math.min(1.5, Number.isFinite(Number(object.transform.y)) ? Number(object.transform.y) : 0.5));
    object.transform.scale = Math.max(0.05, Math.min(4, Number(object.transform.scale) || 0.6));
    object.transform.rotation = Number.isFinite(Number(object.transform.rotation)) ? Number(object.transform.rotation) : 0;
    object.transform.depth = Number.isFinite(Number(object.transform.depth)) ? Math.max(0, Math.min(1, Number(object.transform.depth))) : 0;
    object.initialStateId ??= object.states[0]?.id ?? null;
  }

  for (const take of project.customObjectTakes) {
    take.steps ??= [];
    take.duration = Math.max(0, Number(take.duration) || 0);
    for (const step of take.steps) {
      step.at = Math.max(0, Number(step.at) || 0);
      step.kind = ['show','hide','state','transform','hotspot','pan','zoom'].includes(step.kind as any) ? step.kind : 'state';
    }
  }

  for (const template of project.faceTemplates) template.layers ??= {};
  for (const character of project.characters) {
    character.aliases ??= [];
    character.images ??= {};
    character.stageFacing ??= { policy: 'flippable', nativeFacing: 'left' };
    // 0.44.1 UX: symmetric/flippable art is the common case. Legacy fixed art
    // migrates to the same one-image workflow; paired remains an explicit
    // asymmetric opt-in with independent left/right assets.
    character.stageFacing.policy = character.stageFacing.policy === 'paired' ? 'paired' : 'flippable';
    character.stageFacing.nativeFacing = ['left','right'].includes(character.stageFacing.nativeFacing as any) ? character.stageFacing.nativeFacing : 'left';
    if (character.stageFacing.variants) {
      for (const key of ['left','right'] as const) {
        const variant = character.stageFacing.variants[key];
        if (!variant) continue;
        variant.images ??= {};
        variant.expressions ??= {};
        variant.layers ??= {};
        variant.layerExpressions ??= {};
      }
    }
    character.expressions ??= {};
    character.layers ??= {};
    character.layerExpressions ??= {};
    character.puppet = normalizePuppetRig(character.puppet);
    character.faceFit = normalizeFaceFit(character.faceFit ?? defaultFaceFit());
    character.speech ??= { defaultLanguage: null, voices: {}, accents: {} };
    character.speech.voices ??= {};
    character.speech.accents ??= {};
  }

  for (const line of project.lines) {
    // 0.45: default-looking imported lines inherit the previous expression;
    // non-default legacy expressions remain explicit authoring.
    line.expressionMode ??= line.expression && line.expression !== 'default' ? 'set' : 'inherit';
    line.speech ??= { languageOverride: null, sourceLanguage: null };
    line.audioMix ??= {};
    if (line.audioMix.voiceGain !== undefined) line.audioMix.voiceGain = Math.max(0, Math.min(4, Number(line.audioMix.voiceGain) || 0));
    if (line.audioMix.sfxGain !== undefined) line.audioMix.sfxGain = Math.max(0, Math.min(4, Number(line.audioMix.sfxGain) || 0));
    if (line.audioMix.voicePan !== undefined) line.audioMix.voicePan = Math.max(-1, Math.min(1, Number(line.audioMix.voicePan) || 0));
    if (line.audioMix.sfxPan !== undefined) line.audioMix.sfxPan = Math.max(-1, Math.min(1, Number(line.audioMix.sfxPan) || 0));
    if (line.audioMix.voiceOffset !== undefined) line.audioMix.voiceOffset = Math.max(-2, Math.min(10, Number(line.audioMix.voiceOffset) || 0));
    if (line.audioMix.preRoll !== undefined) line.audioMix.preRoll = Math.max(0, Math.min(10, Number(line.audioMix.preRoll) || 0));
    if (line.audioMix.postRoll !== undefined) line.audioMix.postRoll = Math.max(0, Math.min(10, Number(line.audioMix.postRoll) || 0));
    if (line.speech.prosodyCurve) {
      try { line.speech.prosodyCurve = normalizeProsodyCurve(line.speech.prosodyCurve); }
      catch { delete line.speech.prosodyCurve; }
    }
    if (line.speech.punctuationPauses) {
      const timing = line.speech.punctuationPauses as any;
      timing.mode = timing.mode === 'uniform' ? 'uniform' : 'custom';
      for (const key of ['uniformSeconds','comma','period','question','exclamation','ellipsis','semicolon','colon']) {
        if (timing[key] === undefined) continue;
        const value = Number(timing[key]);
        timing[key] = Number.isFinite(value) ? Math.max(0, Math.min(5, value)) : 0;
      }
    }
    line.bubble ??= null;
    line.dialogueStyleId ??= null;
    line.stageTransforms ??= {};
    for (const [characterId, transform] of Object.entries(line.stageTransforms)) {
      if (!transform) continue;
      const raw = transform as any;
      if (raw.depth !== undefined) raw.depth = Number.isFinite(Number(raw.depth)) ? Math.max(0, Math.min(1, Number(raw.depth))) : 0;
    }
    if (line.cameraTransform !== undefined && line.cameraTransform !== null) {
      line.cameraTransform = cleanCameraTransform(line.cameraTransform);
    }
    line.diceRolls ??= [];
    if (!('hitPoint' in line)) line.hitPoint = null;
    if (!('wheel' in line)) line.wheel = null;
    if (!('command' in line)) line.command = null;
    if (line.type === 'command') {
      const previousBeatMode = line.command?.beatMode;
      const parsed = parseDirectorCommand(project, line.text);
      if (parsed.command) {
        if (previousBeatMode) parsed.command.beatMode = previousBeatMode;
        line.command = parsed.command;
        if (parsed.command.kind === 'scene') line.sceneTitle = parsed.command.value ?? line.sceneTitle;
        if (parsed.command.kind === 'chapter') line.chapterTitle = parsed.command.value ?? line.chapterTitle;
      }
      line.mouth = 'off';
    }
  }
  return project;
}
