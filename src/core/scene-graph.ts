import type {
  CameraTransform,
  CustomObjectRuntimeState,
  PerformanceState,
  ReplayProject,
  SceneEffectStack,
  SceneGraphLayer,
  SceneGraphNode,
  SceneGraphSettings,
  SceneGraphPatch,
  SceneGraphSnapshot,
  SceneLayerId,
  SceneNodeOverride,
  SceneSpace,
  StagePosition,
  StageProjectionMode,
  StageTransform
} from './types.js';
import { projectStageTransform } from './projection.js';

const LAYER_DEFS: Array<{ id: SceneLayerId; space: SceneSpace; order: number; cameraAffected: boolean }> = [
  { id: 'world.background', space: 'world', order: 0, cameraAffected: true },
  { id: 'world.cg', space: 'world', order: 10, cameraAffected: true },
  { id: 'world.characters', space: 'world', order: 20, cameraAffected: true },
  { id: 'world.front-fx', space: 'world', order: 30, cameraAffected: true },
  { id: 'screen.presentation', space: 'screen', order: 100, cameraAffected: false },
  { id: 'screen.dialogue', space: 'screen', order: 110, cameraAffected: false },
  { id: 'screen.fx', space: 'screen', order: 120, cameraAffected: false }
];

const emptyEffects = (): SceneEffectStack => ({ filters: [], mask: null });
const DEFAULT_AMBIENT_LAYERS: SceneLayerId[] = ['world.background','world.cg','world.characters','world.front-fx'];

export const DEFAULT_SCENE_GRAPH_SETTINGS: SceneGraphSettings = {
  projection: 'flat',
  ambientLight: { enabled: false, color: '#ffffff', intensity: 0, layers: [...DEFAULT_AMBIENT_LAYERS] },
  worldEffects: emptyEffects(),
  outputEffects: emptyEffects(),
  layerEffects: {},
  nodeOverrides: {}
};

function cloneEffects(value?: Partial<SceneEffectStack> | null): SceneEffectStack {
  return {
    filters: Array.isArray(value?.filters)
      ? value!.filters.map(filter => ({ ...filter, enabled: filter.enabled !== false }))
      : [],
    mask: value?.mask ? { ...value.mask } : null
  };
}

export function normalizeSceneGraphSettings(value?: Partial<SceneGraphSettings> | null): SceneGraphSettings {
  const projection: StageProjectionMode = value?.projection === '2.5d' ? '2.5d' : 'flat';
  const ambientRaw = value?.ambientLight;
  const ambientLayers = Array.isArray(ambientRaw?.layers)
    ? ambientRaw!.layers.filter((id): id is SceneLayerId => LAYER_DEFS.some(def => def.id === id))
    : [...DEFAULT_AMBIENT_LAYERS];
  const ambientLight = {
    enabled: ambientRaw?.enabled === true,
    color: typeof ambientRaw?.color === 'string' && ambientRaw.color.trim() ? ambientRaw.color : '#ffffff',
    intensity: Math.max(0, Math.min(1, Number(ambientRaw?.intensity) || 0)),
    layers: ambientLayers.length ? ambientLayers : [...DEFAULT_AMBIENT_LAYERS]
  };
  const worldEffects = cloneEffects(value?.worldEffects);
  const outputEffects = cloneEffects(value?.outputEffects);
  const layerEffects: SceneGraphSettings['layerEffects'] = {};
  for (const def of LAYER_DEFS) {
    const effects = value?.layerEffects?.[def.id];
    if (effects) layerEffects[def.id] = cloneEffects(effects);
  }
  const nodeOverrides: Record<string, SceneNodeOverride> = {};
  for (const [id, override] of Object.entries(value?.nodeOverrides ?? {})) {
    if (!override || typeof override !== 'object') continue;
    const layerId = LAYER_DEFS.some(def => def.id === override.layerId) ? override.layerId : undefined;
    const space = override.space === 'world' || override.space === 'screen' ? override.space : undefined;
    nodeOverrides[id] = {
      ...(layerId ? { layerId } : {}),
      ...(space ? { space } : {}),
      ...(Number.isFinite(Number(override.zBias)) ? { zBias: Number(override.zBias) } : {}),
      ...cloneEffects(override)
    };
  }
  return { projection, ambientLight, worldEffects, outputEffects, layerEffects, nodeOverrides };
}


export function mergeSceneGraphPatch(base: SceneGraphSettings, patch?: SceneGraphPatch | null): SceneGraphSettings {
  if (!patch) return normalizeSceneGraphSettings(base);
  const next = normalizeSceneGraphSettings(base);
  if (patch.ambientLight === null) next.ambientLight = { ...DEFAULT_SCENE_GRAPH_SETTINGS.ambientLight, layers: [...DEFAULT_SCENE_GRAPH_SETTINGS.ambientLight.layers] };
  else if (patch.ambientLight) next.ambientLight = normalizeSceneGraphSettings({ ...next, ambientLight: { ...next.ambientLight, ...patch.ambientLight } }).ambientLight;
  if (Object.prototype.hasOwnProperty.call(patch, 'worldEffects')) next.worldEffects = patch.worldEffects ? cloneEffects(patch.worldEffects) : emptyEffects();
  if (Object.prototype.hasOwnProperty.call(patch, 'outputEffects')) next.outputEffects = patch.outputEffects ? cloneEffects(patch.outputEffects) : emptyEffects();
  for (const [layerId, effects] of Object.entries(patch.layerEffects ?? {}) as Array<[SceneLayerId, SceneEffectStack | null]>) {
    if (!LAYER_DEFS.some(def => def.id === layerId)) continue;
    if (effects) next.layerEffects[layerId] = cloneEffects(effects); else delete next.layerEffects[layerId];
  }
  for (const [nodeId, override] of Object.entries(patch.nodeOverrides ?? {})) {
    if (override) next.nodeOverrides[nodeId] = normalizeSceneGraphSettings({ ...next, nodeOverrides: { [nodeId]: override } }).nodeOverrides[nodeId]!;
    else delete next.nodeOverrides[nodeId];
  }
  return normalizeSceneGraphSettings(next);
}

export function sceneGraphLayers(settings: SceneGraphSettings): SceneGraphLayer[] {
  return LAYER_DEFS.map(def => ({
    ...def,
    effects: cloneEffects(settings.layerEffects[def.id] ?? emptyEffects())
  }));
}

function actorBaseTransform(position: StagePosition, transform?: StageTransform): SceneGraphNode['transform'] {
  const slotX = position === 'left' ? 0.22 : position === 'right' ? 0.78 : 0.5;
  return {
    x: Number.isFinite(Number(transform?.x)) ? Number(transform!.x) : slotX,
    y: Number.isFinite(Number(transform?.y)) ? Number(transform!.y) : 0.88,
    scale: Number.isFinite(Number(transform?.scale)) ? Number(transform!.scale) : 1,
    rotation: 0,
    depth: Number.isFinite(Number(transform?.depth)) ? Math.max(0, Math.min(1, Number(transform!.depth))) : 0
  };
}

function objectTransform(state: CustomObjectRuntimeState): SceneGraphNode['transform'] {
  return {
    x: Number(state.transform.x) || 0.5,
    y: Number(state.transform.y) || 0.5,
    scale: Number(state.transform.scale) || 0.6,
    rotation: Number(state.transform.rotation) || 0,
    depth: Number.isFinite(Number(state.transform.depth)) ? Math.max(0, Math.min(1, Number(state.transform.depth))) : 0
  };
}

function applyOverride(node: SceneGraphNode, settings: SceneGraphSettings): SceneGraphNode {
  const override = settings.nodeOverrides[node.id];
  if (!override) return node;
  return {
    ...node,
    layerId: override.layerId ?? node.layerId,
    space: override.space ?? node.space,
    zBias: Number.isFinite(Number(override.zBias)) ? Number(override.zBias) : node.zBias,
    effects: {
      filters: [...(node.effects?.filters ?? []), ...cloneEffects(override).filters],
      mask: cloneEffects(override).mask ?? node.effects?.mask ?? null
    }
  };
}

export interface SceneGraphFrameInput {
  state: PerformanceState;
  stage: Array<{ characterId: string; position: StagePosition; transform?: StageTransform; active: boolean }>;
  lineType: string;
  diceVisible?: boolean;
  wheelVisible?: boolean;
  hitPointVisible?: boolean;
  transition?: string;
  sceneGraphSettings?: SceneGraphSettings;
  cameraTransform?: CameraTransform;
}

/**
 * Build a normalized, renderer-agnostic scene graph from legacy Replay Lab authoring state.
 * The graph is deliberately derived: old project fields remain canonical in 0.49 so migration
 * can happen incrementally without making Studio and exporters maintain two sources of truth.
 */
export function buildSceneGraphSnapshot(project: ReplayProject, input: SceneGraphFrameInput): SceneGraphSnapshot {
  const settings = normalizeSceneGraphSettings(input.sceneGraphSettings ?? project.sceneGraph);
  const nodes: SceneGraphNode[] = [];
  const push = (node: SceneGraphNode) => nodes.push(applyOverride(node, settings));

  if (input.state.background) push({
    id: 'background', kind: 'background', layerId: 'world.background', space: 'world', visible: true,
    depth: 1, zBias: 0, assetId: input.state.background, effects: emptyEffects()
  });

  if (input.state.cg) push({
    id: 'cg', kind: 'cg', layerId: 'world.cg', space: 'world', visible: true,
    depth: 0.75, zBias: 0, assetId: input.state.cg, effects: { filters: [], mask: input.state.cgPresentation?.mask ? { ...input.state.cgPresentation.mask } : null },
    metadata: { presentation: { ...input.state.cgPresentation } }
  });

  if (!(input.state.cg && input.state.cgPresentation?.hideCharacters)) {
    input.stage.forEach((actor, index) => push({
      id: `character:${actor.characterId}`,
      kind: 'character',
      layerId: 'world.characters',
      space: 'world',
      visible: true,
      depth: actorBaseTransform(actor.position, actor.transform)?.depth ?? 0,
      zBias: index,
      characterId: actor.characterId,
      transform: actorBaseTransform(actor.position, actor.transform),
      effects: emptyEffects(),
      metadata: { active: actor.active, position: actor.position }
    }));
  }

  for (const state of Object.values(input.state.customObjects ?? {})) {
    if (!state?.visible) continue;
    push({
      id: `custom-object:${state.objectId}`,
      kind: 'custom-object',
      layerId: 'screen.presentation',
      space: 'screen',
      visible: true,
      depth: objectTransform(state)?.depth ?? 0,
      zBias: 0,
      objectId: state.objectId,
      stateId: state.stateId ?? null,
      transform: objectTransform(state),
      effects: emptyEffects()
    });
  }

  if (input.diceVisible) push({ id: 'system:dice', kind: 'dice', layerId: 'screen.presentation', space: 'screen', visible: true, depth: 0, zBias: 10, effects: emptyEffects() });
  if (input.wheelVisible) push({ id: 'system:wheel', kind: 'wheel', layerId: 'screen.presentation', space: 'screen', visible: true, depth: 0, zBias: 10, effects: emptyEffects() });
  if (input.hitPointVisible) push({ id: 'system:hitpoint', kind: 'hitpoint', layerId: 'screen.presentation', space: 'screen', visible: true, depth: 0, zBias: 10, effects: emptyEffects() });

  const dialogueVisible = input.lineType !== 'command' && !(input.state.cg && input.state.cgPresentation?.hideTextbox);
  if (dialogueVisible) push({ id: 'ui:dialogue', kind: 'dialogue-ui', layerId: 'screen.dialogue', space: 'screen', visible: true, depth: 0, zBias: 0, effects: emptyEffects() });
  if (input.transition === 'fade') push({ id: 'fx:transition', kind: 'screen-fx', layerId: 'screen.fx', space: 'screen', visible: true, depth: 0, zBias: 0, effects: emptyEffects(), metadata: { transition: 'fade' } });

  const layerOrder = new Map(sceneGraphLayers(settings).map(layer => [layer.id, layer.order]));
  nodes.sort((a, b) => {
    const layerDelta = (layerOrder.get(a.layerId) ?? 0) - (layerOrder.get(b.layerId) ?? 0);
    if (layerDelta) return layerDelta;
    if (a.space === 'world' && b.space === 'world') {
      const distance = (node: SceneGraphNode) => {
        if (settings.projection !== '2.5d' || !node.transform) return node.depth;
        const p = projectStageTransform({ x: node.transform.x ?? 0.5, y: node.transform.y ?? 0.88, scale: node.transform.scale ?? 1, depth: node.depth }, settings.projection, input.cameraTransform);
        return p.viewDepth ?? p.depth;
      };
      const delta = distance(b) - distance(a);
      if (delta) return delta;
    }
    return a.zBias - b.zBias || a.id.localeCompare(b.id);
  });

  return { projection: settings.projection, ambientLight: { ...settings.ambientLight, layers: [...settings.ambientLight.layers] }, worldEffects: cloneEffects(settings.worldEffects), outputEffects: cloneEffects(settings.outputEffects), layers: sceneGraphLayers(settings), nodes };
}
