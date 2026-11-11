import type { CharacterBodyLayer } from '../core/types.js';

type Drawable = CanvasImageSource;

/**
 * Paints body layers bottom to top onto ctx (sized width × height). Non-normal blends are
 * clipped to what is already painted, so a multiply shadow darkens the body and never the
 * stage behind it — the same result as the Procreate clipped shadow layer.
 */
export function paintBodyLayers(
  ctx: CanvasRenderingContext2D,
  scratch: CanvasRenderingContext2D | null,
  layers: CharacterBodyLayer[],
  images: Array<Drawable | null | undefined>,
  width: number,
  height: number
): void {
  layers.forEach((layer, index) => {
    const image = images[index];
    if (!image) return;
    const opacity = Math.max(0, Math.min(1, Number(layer.opacity ?? 1)));
    const blend = layer.blend ?? 'normal';
    if (blend === 'normal' || !scratch) {
      ctx.globalAlpha = opacity; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(image, 0, 0, width, height);
      return;
    }
    scratch.globalCompositeOperation = 'source-over'; scratch.globalAlpha = opacity;
    scratch.clearRect(0, 0, width, height); scratch.drawImage(image, 0, 0, width, height);
    scratch.globalAlpha = 1; scratch.globalCompositeOperation = 'destination-in'; scratch.drawImage(ctx.canvas, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = blend === 'clip' ? 'source-over' : blend; ctx.drawImage(scratch.canvas, 0, 0);
  });
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
