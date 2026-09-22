import { makeId, stableColor } from './id.js';
import type { CharacterKind, CustomObjectTemplate, CustomPresentationObject, LineType, ReplayCharacter, ReplayLine, ReplayProject } from './types.js';
import { defaultPuppetRig } from '../puppet/rig.js';
import { defaultFaceFit } from './face.js';
import { resolveCharacterName } from './character-name.js';
import { DEFAULT_SCENE_GRAPH_SETTINGS } from './scene-graph.js';

export const DEFAULT_SETTINGS = {
  maxOnStage: 2 as const,
  autoStageMode: 'vn-continuity' as const,
  speakerFocus: 'subtle' as const,
  dimOthers: true,
  showNameTags: true,
  bgColor: '#171924',
  bgmVolume: 0.24,
  sfxVolume: 0.70,
  audioMix: {
    masterVolume: 1,
    voiceVolume: 1,
    bgmVolume: 0.24,
    ambientVolume: 0.34,
    sfxVolume: 0.70,
    bgmCrossfadeSeconds: 0.8,
    ducking: { enabled: true, bgmGain: 0.48, ambientGain: 0.72, attackSeconds: 0.12, releaseSeconds: 0.35 },
    limiter: { enabled: true, threshold: 0.95 }
  },
  mouthLeadMs: 66,
  speechPauseScale: 1,
  templateId: 'visual-novel',
  logLanguage: 'auto',
  speechLanguage: 'auto',
  translationProvider: undefined,
  ttsProvider: 'replaylab-free'
};

export function inferCharacterKind(name: string): CharacterKind {
  const n = name.trim().toLowerCase();
  if (/^(system|dicebot|bot|director|导演|旁白系统|系统)$/.test(n)) return 'system';
  if (/^(kp|gm|dm|keeper|主持|旁白)$/.test(n)) return 'kp';
  return 'normal';
}

export function detectLineType(speaker: string, text: string): LineType {
  const sp = speaker.trim().toLowerCase();
  const tx = text.trim();
  if (/^(system|dicebot|bot|系统)$/.test(sp)) return 'system';
  if (/^(旁白|narration)$/.test(sp)) return 'narration';
  if (/\b\d+d\d+/i.test(tx) || (/(大成功|大失败|成功|失败|success|fail|critical|fumble)/i.test(tx) && /\d+\s*[\/／]\s*\d+/.test(tx))) return 'dice';
  return 'dialogue';
}

export function createProject(title = 'Untitled Replay'): ReplayProject {
  return {
    format: 'ReplayLabProject',
    version: '0.53',
    title,
    characters: [],
    lines: [],
    assets: [],
    customObjects: [],
    customObjectTakes: [],
    mediaDefinitions: [],
    faceTemplates: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    sceneGraph: structuredClone(DEFAULT_SCENE_GRAPH_SETTINGS)
  };
}


export function createCustomObject(name = '自定义对象', assetId: string | null = null, template: CustomObjectTemplate = 'blank'): CustomPresentationObject {
  const stateId = makeId('objstate');
  return {
    id: makeId('object'),
    name: name.trim() || '自定义对象',
    template,
    interactionMode: template === 'map' ? 'pan-zoom' : template === 'document' || template === 'phone' ? 'inspect' : 'none',
    states: [{ id: stateId, name: '默认', assetId }],
    initialStateId: stateId,
    hotspots: [],
    transform: { x: 0.5, y: 0.46, scale: template === 'title-card' ? 0.72 : 0.58, rotation: 0, depth: 0 },
    metadata: {}
  };
}

export function createCharacter(name: string): ReplayCharacter {
  const kind = inferCharacterKind(name);
  return {
    id: makeId('char'),
    name: name.trim() || 'Unknown',
    aliases: [],
    color: stableColor(name),
    kind,
    showOnStage: kind === 'normal' || kind === 'npc',
    defaultPosition: 'auto',
    stageFacing: { policy: 'flippable', nativeFacing: 'left' },
    images: {},
    expressions: {},
    layers: {},
    layerExpressions: {},
    puppet: defaultPuppetRig(),
    faceFit: defaultFaceFit(),
    speech: { defaultLanguage: null, voices: {} }
  };
}

export function ensureCharacter(project: ReplayProject, name: string): ReplayCharacter {
  const clean = name.trim() || 'Unknown';
  const resolution = resolveCharacterName(project.characters, clean);
  if (resolution.character) return resolution.character;
  // Ambiguity is deliberately materialized as a visible duplicate instead of
  // silently assigning dialogue to whichever alias happens to appear first.
  const character = createCharacter(clean);
  project.characters.push(character);
  return character;
}

export function createLine(project: ReplayProject, speaker: string, text: string, type?: LineType): ReplayLine {
  const character = ensureCharacter(project, speaker);
  return {
    id: makeId('line'),
    speakerId: character.id,
    sourceSpeaker: speaker,
    type: type ?? detectLineType(speaker, text),
    text: text.trim(),
    textEffect: 'all',
    textEffectDuration: null,
    speech: { languageOverride: null, sourceLanguage: null },
    chapterTitle: '',
    sceneTitle: '',
    duration: null,
    expression: 'default',
    expressionMode: 'inherit',
    mouth: 'auto',
    mouthCues: [],
    audioAssetId: null,
    sfxAssetId: null,
    diceRolls: [],
    hitPoint: null,
    wheel: null,
    bubble: null,
    dialogueStyleId: null,
    stageMethod: null,
    stageMode: 'auto',
    stageIds: [],
    stagePositions: {},
    stageTransforms: {},
    cameraTransform: undefined,
    scene: { camera: 'none', transition: 'cut', cameraCurve: 'sigmoid', transitionCurve: 'quadraticR', backgroundMethod: 'replace', backgroundMethodDuration: null, enterIds: [], exitIds: [] },
    command: null,
    metadata: {}
  };
}

export function estimateDuration(text: string): number {
  const s = text.trim();
  if (!s) return 1.2;
  const cjk = (s.match(/[\u3400-\u9fff]/g) || []).length;
  const words = (s.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  const punct = (s.match(/[，。！？,.!?;；:：…—]/g) || []).length;
  return Math.min(16, Math.max(1, cjk * 0.17 + words * 0.33 + punct * 0.11 + 0.68));
}
