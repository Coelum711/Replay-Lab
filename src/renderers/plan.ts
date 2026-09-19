import type { CameraTransform, PerformanceDocument, StagePosition, StageTransform } from '../core/types.js';

export interface RenderActor {
  characterId: string;
  name: string;
  position: StagePosition;
  active: boolean;
  expression: string;
  transform?: StageTransform;
}

export interface RenderScenePlan {
  durationMs: number;
  background: string | null;
  cg: string | null;
  bgm: string | null;
  ambient: string | null;
  voice: string | null;
  sfx: string | null;
  actors: RenderActor[];
  speaker: string;
  text: string;
  camera: string;
  cameraTransform: CameraTransform;
  transition: string;
}

export function buildRenderPlan(performance: PerformanceDocument): RenderScenePlan[] {
  return performance.lines.map(line => ({
    durationMs: Math.round(line.duration * 1000),
    background: line.state.background,
    cg: line.state.cg,
    bgm: line.state.bgm,
    ambient: line.state.ambient,
    voice: line.audioAssetId ?? null,
    sfx: line.sfxAssetId ?? null,
    actors: line.stage.map(actor => ({
      characterId: actor.characterId,
      name: actor.name,
      position: actor.position,
      active: actor.active,
      expression: line.state.expressions[actor.characterId] ?? 'default',
      transform: actor.transform ? { ...actor.transform } : undefined
    })),
    speaker: line.speakerName,
    text: line.text,
    camera: line.camera,
    cameraTransform: { ...line.cameraTransform },
    transition: line.transition
  }));
}
