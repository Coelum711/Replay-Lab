/*
 * Adapter for VNVE's public MIT-licensed API. No VNVE source is bundled.
 * Install/provide @vnve/core at runtime and pass its exports to createVnveRenderer().
 */
import type { PerformanceDocument, ReplayCharacter } from '../core/types.js';
import type { Renderer } from './types.js';
import { buildRenderPlan } from './plan.js';

export interface VnveRuntime {
  Creator: new (...args: any[]) => any;
  Scene: new (options: Record<string, unknown>) => any;
  Img: new (options: Record<string, unknown>) => any;
  Text: new (text: string, options?: Record<string, unknown>) => any;
  Sound: new (options: Record<string, unknown>) => any;
  PREST_ANIMATION?: Record<string, unknown>;
}

export interface VnveAdapterOptions {
  runtime: VnveRuntime;
  resolveAsset(source: string): string | undefined;
  width?: number;
  height?: number;
}

function characterImage(character: ReplayCharacter, expression: string): string | undefined {
  const set = expression === 'default' ? character.images : character.expressions[expression] ?? character.images;
  return set.idle ?? undefined;
}

function xFor(position: string, width: number): number {
  if (position === 'left') return width * 0.25;
  if (position === 'right') return width * 0.75;
  return width * 0.5;
}

export function createVnveRenderer(options: VnveAdapterOptions): Renderer<Blob> {
  const { runtime, resolveAsset } = options;
  const width = options.width ?? 1280;
  const height = options.height ?? 720;

  return {
    id: 'vnve',
    label: 'VNVE / WebCodecs MP4',
    async render(performance: PerformanceDocument): Promise<Blob> {
      const creator = new runtime.Creator();
      const chars = new Map(performance.characters.map(c => [c.id, c]));
      const plan = buildRenderPlan(performance);

      plan.forEach((item, index) => {
        const scene = new runtime.Scene({ duration: item.durationMs, width, height });
        if (item.background) {
          const source = resolveAsset(item.background) ?? item.background;
          scene.addChild(new runtime.Img({ source, x: 0, y: 0, width, height }));
        }
        if (item.cg) {
          const source = resolveAsset(item.cg) ?? item.cg;
          scene.addChild(new runtime.Img({ source, x: 0, y: 0, width, height }));
        }
        for (const actor of item.actors) {
          const character = chars.get(actor.characterId);
          if (!character) continue;
          const sourceKey = characterImage(character, actor.expression);
          if (!sourceKey) continue;
          const source = resolveAsset(sourceKey) ?? sourceKey;
          scene.addChild(new runtime.Img({
            source,
            x: xFor(actor.position, width),
            y: height,
            anchor: { x: 0.5, y: 1 },
            alpha: actor.active ? 1 : !performance.settings.dimOthers || performance.settings.speakerFocus === 'none' ? 1 : performance.settings.speakerFocus === 'strong' ? 0.48 : 0.78
          }));
        }
        const text = new runtime.Text(`${item.speaker}\n${item.text}`, {
          x: width * 0.08,
          y: height * 0.72,
          fill: '#ffffff',
          fontSize: 34,
          wordWrap: true,
          wordWrapWidth: width * 0.84
        });
        if (item.transition === 'fade' && runtime.PREST_ANIMATION?.FadeIn && typeof text.addAnimation === 'function') {
          text.addAnimation(runtime.PREST_ANIMATION.FadeIn);
        }
        scene.addChild(text);

        const line = performance.lines[index]!;
        for (const assetId of [line.audioAssetId, line.sfxAssetId]) {
          if (!assetId) continue;
          const asset = performance.assets.find(a => a.id === assetId);
          const source = asset ? resolveAsset(asset.uri ?? asset.sourcePath ?? asset.id) : undefined;
          if (source) scene.addSound(new runtime.Sound({ source }));
        }
        creator.add(scene);
      });
      return await creator.start();
    }
  };
}
