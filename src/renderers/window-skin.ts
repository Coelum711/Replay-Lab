/**
 * Drawing helpers for textbox skins: nine-slice images, speaker-colour tinting, and
 * RPG Maker MV/MZ `Window.png` (192×192: back 0,0 · pattern 0,96 · frame 96,0 · text colours 96,144).
 */
type Img = CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength };
const dims = (img: Img) => ({ w: Number(img.naturalWidth ?? img.width ?? 0), h: Number(img.naturalHeight ?? img.height ?? 0) });

/** Draws a source rectangle as a nine-slice: corners keep their size (× scale), edges and centre stretch. */
export function drawNineSlice(ctx: CanvasRenderingContext2D, img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, slice: number, dx: number, dy: number, dw: number, dh: number, scale = 1): void {
  if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) return;
  const s = Math.max(0, Math.min(slice, sw / 2, sh / 2));
  if (!s) { ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh); return; }
  const d = Math.min(s * scale, dw / 2, dh / 2);
  const xs = [sx, sx + s, sx + sw - s, sx + sw], ys = [sy, sy + s, sy + sh - s, sy + sh];
  const xd = [dx, dx + d, dx + dw - d, dx + dw], yd = [dy, dy + d, dy + dh - d, dy + dh];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const w = xs[c + 1]! - xs[c]!, h = ys[r + 1]! - ys[r]!, W = xd[c + 1]! - xd[c]!, H = yd[r + 1]! - yd[r]!;
    if (w > 0 && h > 0 && W > 0 && H > 0) ctx.drawImage(img, xs[c]!, ys[r]!, w, h, xd[c]!, yd[r]!, W, H);
  }
}

const scratches: Array<HTMLCanvasElement | OffscreenCanvas | null> = [null, null];
function scratchCanvas(w: number, h: number, slot = 0): CanvasRenderingContext2D | null {
  let canvas = scratches[slot] ?? null;
  if (!canvas) canvas = scratches[slot] = typeof document !== 'undefined' ? document.createElement('canvas') : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : null;
  if (!canvas) return null;
  canvas.width = Math.max(1, Math.ceil(w)); canvas.height = Math.max(1, Math.ceil(h));
  return canvas.getContext('2d', { willReadFrequently: slot === 0 }) as CanvasRenderingContext2D | null;
}

/** Nine-slice image multiplied by `color`, keeping the image's own transparency (white art becomes the colour). */
export function drawTintedNineSlice(ctx: CanvasRenderingContext2D, img: Img, slice: number, dx: number, dy: number, dw: number, dh: number, scale: number, color: string | null): void {
  const { w, h } = dims(img);
  if (!color) { drawNineSlice(ctx, img, 0, 0, w, h, slice, dx, dy, dw, dh, scale); return; }
  // Tint on one scratch canvas, then cut it back to the art's alpha using an untinted copy in one draw
  // (destination-in per slice would erase every slice but the last).
  const off = scratchCanvas(dw, dh, 0), mask = scratchCanvas(dw, dh, 1);
  if (!off || !mask) { drawNineSlice(ctx, img, 0, 0, w, h, slice, dx, dy, dw, dh, scale); return; }
  drawNineSlice(off, img, 0, 0, w, h, slice, 0, 0, dw, dh, scale);
  drawNineSlice(mask, img, 0, 0, w, h, slice, 0, 0, dw, dh, scale);
  off.globalCompositeOperation = 'multiply'; off.fillStyle = color; off.fillRect(0, 0, dw, dh);
  off.globalCompositeOperation = 'destination-in'; off.drawImage(mask.canvas as CanvasImageSource, 0, 0);
  off.globalCompositeOperation = 'source-over';
  ctx.drawImage(off.canvas as CanvasImageSource, 0, 0, Math.ceil(dw), Math.ceil(dh), dx, dy, Math.ceil(dw), Math.ceil(dh));
}

/** Window.png check: RPG Maker skins are square, 192 px at 1× (MV/MZ). */
export function looksLikeRpgWindowSkin(img: Img): boolean {
  const { w, h } = dims(img);
  return w > 0 && w === h && w % 192 === 0;
}

/** An RPG Maker window: stretched back + tiled pattern (at the default 192/255 opacity), then the frame. */
export function drawRpgWindow(ctx: CanvasRenderingContext2D, img: Img, x: number, y: number, w: number, h: number, scale = 1, backOpacity = 192 / 255): void {
  const unit = dims(img).w / 192 || 1, q = 96 * unit, m = 4 * scale;
  ctx.save();
  ctx.globalAlpha *= backOpacity;
  ctx.drawImage(img, 0, 0, q, q, x + m, y + m, w - m * 2, h - m * 2);
  const tile = 96 * scale;
  ctx.beginPath(); ctx.rect(x + m, y + m, w - m * 2, h - m * 2); ctx.clip();
  for (let ty = y + m; ty < y + h - m; ty += tile) for (let tx = x + m; tx < x + w - m; tx += tile) ctx.drawImage(img, 0, q, q, q, tx, ty, tile, tile);
  ctx.restore();
  drawNineSlice(ctx, img, q, 0, q, q, 24 * unit, x, y, w, h, scale / unit);
}

/** Text colour n (0 = normal text) from the 8×4 swatch grid, like `\C[n]` in RPG Maker. */
export function rpgTextColor(img: Img, n: number): string {
  const unit = dims(img).w / 192 || 1;
  const ctx = scratchCanvas(1, 1);
  if (!ctx) return '#ffffff';
  const i = Math.max(0, Math.min(31, Math.floor(n)));
  const px = (96 + (i % 8) * 12 + 6) * unit, py = (144 + Math.floor(i / 8) * 12 + 6) * unit;
  try {
    ctx.clearRect(0, 0, 1, 1); ctx.drawImage(img, px, py, 1, 1, 0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map(v => (v ?? 255).toString(16).padStart(2, '0')).join('')}`;
  } catch { return '#ffffff'; }
}
