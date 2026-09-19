import { makeId } from '../core/id.js';
import { createProject } from '../core/project.js';
import { defaultFaceFit } from '../core/face.js';
import type { MediaAsset, ReplayCharacter, ReplayProject } from '../core/types.js';

type Legacy = Record<string, any>;

function addDataAsset(project: ReplayProject, kind: MediaAsset['kind'], name: string, uri: string | null | undefined): string | null {
  if (!uri) return null;
  const existing = project.assets.find(a => a.uri === uri);
  if (existing) return existing.id;
  const id = makeId('asset');
  project.assets.push({ id, kind, name: name || id, uri });
  return id;
}

export function migrateV07Project(data: Legacy): ReplayProject {
  if (data?.format === 'ReplayLabProject' && /^0\.(8|9)/.test(String(data.version))) return data as ReplayProject;
  const project = createProject(data.title ?? 'Migrated Replay Lab project');
  project.settings = { ...project.settings, ...(data.settings ?? {}) };

  const charMap = new Map<string,string>();
  for (const old of data.characters ?? []) {
    const character: ReplayCharacter = {
      id: makeId('char'),
      name: old.name ?? 'Unknown',
      color: old.color ?? '#8b7cf0',
      kind: old.kind ?? 'normal',
      showOnStage: old.showOnStage ?? true,
      defaultPosition: old.defaultPosition ?? 'auto',
      stageFacing: { policy: 'flippable', nativeFacing: 'left' },
      images: {},
      expressions: {},
      layers: {},
      layerExpressions: {},
      puppet: { layout: { framing: 'auto', anchorX: 0.5, anchorY: 1, scale: 1, offsetX: 0, offsetY: 0 }, parts: {}, parameters: [], expressionPresets: {} },
      faceFit: defaultFaceFit()
    };
    charMap.set(old.id, character.id);
    for (const slot of ['idle','open','blink','A','I','U','E','O'] as const) {
      const asset = addDataAsset(project, 'character', `${character.name}-${slot}`, old.images?.[slot]);
      if (asset) character.images[slot] = asset;
    }
    for (const [expression, set] of Object.entries(old.expressions ?? {})) {
      character.expressions[expression] = {};
      for (const slot of ['idle','open','blink','A','I','U','E','O'] as const) {
        const asset = addDataAsset(project, 'character', `${character.name}-${expression}-${slot}`, (set as Legacy)?.[slot]);
        if (asset) character.expressions[expression]![slot] = asset;
      }
    }
    project.characters.push(character);
  }

  for (const old of data.lines ?? []) {
    const scene = old.scene ?? {};
    const background = scene.bgAction === 'clear' ? null : scene.bgAction === 'set' ? addDataAsset(project, 'background', scene.bgName, scene.bgData) : undefined;
    const cg = scene.cgAction === 'clear' ? null : scene.cgAction === 'set' ? addDataAsset(project, 'cg', scene.cgName, scene.cgData) : undefined;
    const bgm = scene.bgmAction === 'stop' ? null : scene.bgmAction === 'set' ? addDataAsset(project, 'bgm', scene.bgmName, scene.bgmData) : undefined;
    const voice = addDataAsset(project, 'voice', old.audioName, old.audioData);
    const sfx = addDataAsset(project, 'sfx', old.sfxName, old.sfxData);
    project.lines.push({
      id: makeId('line'),
      speakerId: charMap.get(old.speakerId) ?? project.characters[0]?.id ?? makeId('missing'),
      sourceSpeaker: old.sourceSpeaker,
      type: old.type ?? 'dialogue',
      text: old.text ?? '',
      chapterTitle: old.chapterTitle ?? '',
      sceneTitle: old.sceneTitle ?? '',
      duration: old.duration ?? null,
      expression: old.expression ?? 'default',
      mouth: old.mouthCues?.length ? 'timed' : old.mouth ?? 'auto',
      mouthCues: old.mouthCues ?? [],
      audioAssetId: voice,
      sfxAssetId: sfx,
      stageMode: old.stageMode ?? 'auto',
      stageIds: (old.stageIds ?? []).map((id: string) => charMap.get(id) ?? id),
      stagePositions: Object.fromEntries(Object.entries(old.stagePositions ?? {}).map(([id,pos]) => [charMap.get(id) ?? id, String(pos)])) as Record<string, import('../core/types.js').StagePosition>,
      scene: {
        ...(background !== undefined ? { background } : {}),
        ...(cg !== undefined ? { cg } : {}),
        ...(bgm !== undefined ? { bgm } : {}),
        camera: scene.camera ?? 'none',
        transition: scene.transition ?? 'cut',
        enterIds: (scene.enterIds ?? []).map((id: string) => charMap.get(id) ?? id),
        exitIds: (scene.exitIds ?? []).map((id: string) => charMap.get(id) ?? id)
      }
    });
  }
  return project;
}
