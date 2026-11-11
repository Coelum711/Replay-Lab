import { decodeFilterValue, filterCss } from '../core/filters.js';
/**
 * Classic VN/ADV staging effects drawn with plain canvas calls: manga marks, kinetic text,
 * rule-style transitions, colour grades and eyecatch cards. Everything is a pure function of
 * time so scrubbing and export render the same frame.
 */
import type { ChapterCard, EmoteKind, ScreenFilterKind, TransitionEffect } from '../core/types.js';
import type { TextTagRange } from '../core/text-tags.js';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const easeOutBack = (t: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
/** Deterministic 0..1 noise for an integer seed. */
export function hash01(n: number): number { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

// ---------------------------------------------------------------- emotes

/** Pops in, idles with a small wobble, fades out over the last 0.25 s. */
export function drawEmote(ctx: CanvasRenderingContext2D, kind: EmoteKind, x: number, y: number, size: number, since: number, duration: number): void {
  if (since < 0 || since >= duration) return;
  const pop = since < 0.22 ? easeOutBack(clamp(since / 0.22, 0, 1)) : 1;
  const fade = clamp((duration - since) / 0.25, 0, 1);
  if (pop <= 0 || fade <= 0) return;
  ctx.save();
  ctx.globalAlpha *= fade;
  ctx.translate(x, y);
  const pulse = kind === 'anger' ? 1 + Math.max(0, Math.sin(since * 14)) * 0.12 : kind === 'heart' ? 1 + Math.abs(Math.sin(since * 6)) * 0.1 : 1;
  ctx.scale(pop * pulse, pop * pulse);
  if (kind === 'note' || kind === 'sparkle') ctx.rotate(Math.sin(since * 5) * 0.12);
  const s = size;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const glyph = (text: string, color: string, scale = 1, dx = 0, dy = 0, rot = 0) => {
    ctx.save(); ctx.translate(dx * s, dy * s); ctx.rotate(rot);
    ctx.font = `900 ${Math.round(s * scale)}px system-ui, "PingFang SC", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, s * 0.12); ctx.strokeStyle = '#1b1720'; ctx.strokeText(text, 0, 0);
    ctx.fillStyle = color; ctx.fillText(text, 0, 0); ctx.restore();
  };
  switch (kind) {
    case 'anger': {
      // Four bent strokes meeting around a gap: the 💢 vein.
      ctx.strokeStyle = '#1b1720'; ctx.lineWidth = s * 0.28;
      const arm = (rot: number) => { ctx.save(); ctx.rotate(rot); ctx.beginPath(); ctx.moveTo(s * 0.1, -s * 0.42); ctx.quadraticCurveTo(s * 0.12, -s * 0.12, s * 0.42, -s * 0.1); ctx.stroke(); ctx.restore(); };
      for (let i = 0; i < 4; i++) arm(i * Math.PI / 2);
      ctx.strokeStyle = '#ff3b4e'; ctx.lineWidth = s * 0.16;
      for (let i = 0; i < 4; i++) arm(i * Math.PI / 2);
      break;
    }
    case 'sweat': {
      const fall = (since % 1.2) * s * 0.18;
      ctx.translate(0, fall); ctx.scale(1.35, 1.35);
      ctx.beginPath(); ctx.moveTo(0, -s * 0.5); ctx.bezierCurveTo(s * 0.42, -s * 0.02, s * 0.36, s * 0.42, 0, s * 0.42); ctx.bezierCurveTo(-s * 0.36, s * 0.42, -s * 0.42, -s * 0.02, 0, -s * 0.5); ctx.closePath();
      ctx.fillStyle = '#8fd3ff'; ctx.fill(); ctx.lineWidth = Math.max(2.5, s * 0.08); ctx.strokeStyle = '#1b1720'; ctx.stroke();
      ctx.beginPath(); ctx.ellipse(-s * 0.1, s * 0.12, s * 0.07, s * 0.13, -0.4, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fill();
      break;
    }
    case 'surprise': glyph('！', '#ffe14d', 1.15); break;
    case 'question': glyph('？', '#8fd3ff', 1.1, 0, 0, Math.sin(since * 3) * 0.15); break;
    case 'surprise-question': glyph('！', '#ffe14d', 1.05, -0.24, 0.02, -0.12); glyph('？', '#8fd3ff', 1.0, 0.26, -0.04, 0.12); break;
    case 'dots': {
      const shown = Math.min(3, Math.floor(since / 0.22) + 1);
      for (let i = 0; i < shown; i++) { ctx.beginPath(); ctx.arc((i - 1) * s * 0.42, 0, s * 0.13, 0, Math.PI * 2); ctx.fillStyle = '#f4f1ff'; ctx.fill(); ctx.lineWidth = Math.max(2, s * 0.06); ctx.strokeStyle = '#1b1720'; ctx.stroke(); }
      break;
    }
    case 'heart': {
      ctx.beginPath(); ctx.moveTo(0, s * 0.38);
      ctx.bezierCurveTo(-s * 0.62, -s * 0.06, -s * 0.34, -s * 0.62, 0, -s * 0.22);
      ctx.bezierCurveTo(s * 0.34, -s * 0.62, s * 0.62, -s * 0.06, 0, s * 0.38); ctx.closePath();
      ctx.fillStyle = '#ff6f91'; ctx.fill(); ctx.lineWidth = Math.max(2.5, s * 0.08); ctx.strokeStyle = '#1b1720'; ctx.stroke();
      break;
    }
    case 'note': glyph('♪', '#c9a6ff', 1.1, -0.2, Math.sin(since * 4) * 0.08); glyph('♫', '#ffd166', 0.8, 0.32, -0.3 + Math.cos(since * 4) * 0.08); break;
    case 'sparkle': {
      const star = (dx: number, dy: number, r: number, phase: number) => {
        const k = 0.6 + 0.4 * Math.abs(Math.sin(since * 5 + phase));
        ctx.save(); ctx.translate(dx * s, dy * s); ctx.scale(k, k); ctx.beginPath();
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * 0.28 : r; ctx.lineTo(Math.cos(a) * rr * s, Math.sin(a) * rr * s); }
        ctx.closePath(); ctx.fillStyle = '#fff5b8'; ctx.fill(); ctx.lineWidth = Math.max(2, s * 0.05); ctx.strokeStyle = '#1b1720'; ctx.stroke(); ctx.restore();
      };
      star(0, 0, 0.5, 0); star(0.48, -0.36, 0.26, 1.7); star(-0.42, 0.34, 0.2, 3.1);
      break;
    }
    case 'gloom': {
      // Vertical "shadow lines" hanging over the head.
      ctx.strokeStyle = 'rgba(70,64,110,.85)'; ctx.lineWidth = Math.max(2, s * 0.07);
      for (let i = 0; i < 6; i++) { const lx = (i - 2.5) * s * 0.22, len = s * (0.7 + 0.3 * hash01(i)); ctx.beginPath(); ctx.moveTo(lx, -s * 0.2); ctx.lineTo(lx, -s * 0.2 + len * clamp(since / 0.4, 0, 1)); ctx.stroke(); }
      break;
    }
    case 'steam': {
      for (let i = 0; i < 3; i++) {
        const t = (since * 1.2 + i / 3) % 1, px = (i - 1) * s * 0.45, py = -t * s * 0.8;
        ctx.globalAlpha = fade * (1 - t);
        ctx.beginPath(); ctx.arc(px, py, s * (0.18 + t * 0.2), 0, Math.PI * 2); ctx.fillStyle = '#f4f4f8'; ctx.fill(); ctx.lineWidth = Math.max(2, s * 0.05); ctx.strokeStyle = '#1b1720'; ctx.stroke();
      }
      break;
    }
    case 'idea': {
      ctx.strokeStyle = '#ffd166'; ctx.lineWidth = Math.max(2, s * 0.07);
      for (let i = 0; i < 7; i++) { const a = -Math.PI + i * Math.PI / 6, r0 = s * 0.5, r1 = s * (0.68 + 0.06 * Math.sin(since * 9 + i)); ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(0, -s * 0.06, s * 0.3, 0, Math.PI * 2); ctx.fillStyle = '#fff1a8'; ctx.fill(); ctx.lineWidth = Math.max(2.5, s * 0.07); ctx.strokeStyle = '#1b1720'; ctx.stroke();
      ctx.fillStyle = '#9aa0ad'; ctx.fillRect(-s * 0.13, s * 0.22, s * 0.26, s * 0.16); ctx.strokeRect(-s * 0.13, s * 0.22, s * 0.26, s * 0.16);
      break;
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------- kinetic text

const RAINBOW = ['#ff6b6b', '#ffb24d', '#ffe14d', '#7be08a', '#6cb8ff', '#b693ff'];

interface Glyph { char: string; index: number; scale: number; width: number; }

/** Like drawFittedText but each character can wobble, wave, grow or change colour. */
export function drawTaggedText(ctx: CanvasRenderingContext2D, options: {
  fullText: string; shownCount: number; ranges: TextTagRange[]; x: number; y: number; maxWidth: number; maxHeight: number;
  baseSize: number; minSize: number; ratio: number; align: 'left' | 'center'; weight?: string; time: number; revealTimes?: (index: number) => number;
}): void {
  const { fullText, ranges, x, y, maxWidth, maxHeight, ratio, align, time } = options;
  const weight = options.weight ?? '';
  const chars = Array.from(fullText);
  const styleAt = (i: number) => ranges.filter(range => i >= range.from && i < range.to);
  const scaleOf = (i: number) => styleAt(i).reduce((scale, range) => scale * (range.kind === 'big' ? 1.45 : range.kind === 'small' ? 0.72 : 1), 1);
  let size = options.baseSize;
  let rows: Glyph[][] = [];
  for (;; size -= 1) {
    ctx.font = `${weight} ${size}px system-ui`.trim();
    rows = [[]]; let rowWidth = 0;
    chars.forEach((char, index) => {
      if (char === '\n') { rows.push([]); rowWidth = 0; return; }
      const scale = scaleOf(index), width = ctx.measureText(char).width * scale;
      if (rowWidth + width > maxWidth && rows.at(-1)!.length) { rows.push([]); rowWidth = 0; }
      rows.at(-1)!.push({ char, index, scale, width }); rowWidth += width;
    });
    const height = rows.reduce((sum, row) => sum + size * ratio * Math.max(1, ...row.map(g => g.scale)), 0);
    if (height <= maxHeight || size <= options.minSize) break;
  }
  ctx.textAlign = 'left';
  const baseFill = ctx.fillStyle;
  let cursorY = y;
  for (const row of rows) {
    const rowScale = Math.max(1, ...row.map(g => g.scale));
    const rowWidth = row.reduce((sum, g) => sum + g.width, 0);
    let cursorX = align === 'center' ? x - rowWidth / 2 : x;
    const baseline = cursorY + size * (rowScale - 1); // keep big glyphs inside the row
    for (const g of row) {
      if (g.index >= options.shownCount) { cursorX += g.width; continue; }
      const styles = styleAt(g.index);
      let dx = 0, dy = 0, extra = 1, fill: string | CanvasGradient | CanvasPattern = baseFill;
      for (const style of styles) {
        if (style.kind === 'shake') { dx += (hash01(g.index * 7 + Math.floor(time * 30)) - 0.5) * size * 0.16; dy += (hash01(g.index * 13 + Math.floor(time * 30) + 5) - 0.5) * size * 0.16; }
        if (style.kind === 'wave') dy += Math.sin(time * 7 - g.index * 0.6) * size * 0.14;
        if (style.kind === 'pop') { const since = time - (options.revealTimes?.(g.index) ?? 0); extra *= since < 0.18 ? 0.4 + 0.6 * easeOutBack(clamp(since / 0.18, 0, 1)) : 1; }
        if (style.kind === 'rainbow') fill = RAINBOW[(g.index + Math.floor(time * 8)) % RAINBOW.length]!;
        if (style.kind === 'color' && style.color) fill = style.color;
      }
      ctx.save();
      ctx.font = `${weight} ${Math.round(size * g.scale)}px system-ui`.trim();
      ctx.fillStyle = fill;
      const cx = cursorX + g.width / 2, cy = baseline + size * g.scale / 2;
      ctx.translate(cx + dx, cy + dy); ctx.scale(extra, extra);
      ctx.textBaseline = 'middle';
      ctx.fillText(g.char, -g.width / 2, 0);
      ctx.restore();
      cursorX += g.width;
    }
    cursorY += size * ratio * rowScale;
  }
  ctx.fillStyle = baseFill;
}

// ---------------------------------------------------------------- transitions

export const MASK_TRANSITIONS = new Set<TransitionEffect>(['dissolve', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'iris-in', 'iris-out', 'blinds', 'noise']);

/** Covers the not-yet-revealed part of the new frame with the previous frame. progress 0→1 reveals. */
export function drawTransitionCover(ctx: CanvasRenderingContext2D, kind: TransitionEffect, progress: number, width: number, height: number, previous: CanvasImageSource): void {
  const p = clamp(progress, 0, 1);
  if (p >= 1) return;
  const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
  ctx.save();
  if (kind === 'dissolve') { ctx.globalAlpha = 1 - eased; ctx.drawImage(previous, 0, 0, width, height); ctx.restore(); return; }
  ctx.beginPath();
  if (kind === 'wipe-left') ctx.rect(0, 0, width * (1 - eased), height);
  else if (kind === 'wipe-right') ctx.rect(width * eased, 0, width * (1 - eased), height);
  else if (kind === 'wipe-up') ctx.rect(0, 0, width, height * (1 - eased));
  else if (kind === 'wipe-down') ctx.rect(0, height * eased, width, height * (1 - eased));
  else if (kind === 'iris-in') { // new scene opens from a growing circle
    const r = Math.hypot(width, height) / 2 * eased;
    ctx.rect(0, 0, width, height); ctx.arc(width / 2, height / 2, r, 0, Math.PI * 2, true);
  } else if (kind === 'iris-out') { // old scene shrinks into a circle
    ctx.arc(width / 2, height / 2, Math.hypot(width, height) / 2 * (1 - eased), 0, Math.PI * 2);
  } else if (kind === 'blinds') {
    const slats = 10, slat = height / slats;
    for (let i = 0; i < slats; i++) ctx.rect(0, i * slat + slat * eased, width, slat * (1 - eased));
  } else if (kind === 'noise') {
    const cols = 48, rows = Math.max(1, Math.round(cols * height / width)), cw = width / cols, ch = height / rows;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (hash01(j * cols + i) >= eased) ctx.rect(i * cw, j * ch, cw + 0.5, ch + 0.5);
  }
  ctx.clip('evenodd');
  ctx.drawImage(previous, 0, 0, width, height);
  ctx.restore();
}

/** Seconds a mask transition takes when the line does not set its own length. */
export const MASK_TRANSITION_SECONDS = 0.7;

// ---------------------------------------------------------------- colour grades

export function screenFilterCss(kind: ScreenFilterKind | null | undefined): string {
  const decoded = decodeFilterValue(kind);
  return decoded ? filterCss(decoded.params) : '';
}

const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; };

/** Overlay painted after the graded world: the colour wash, then the (optionally pulsing) vignette. */
export function drawScreenFilterOverlay(ctx: CanvasRenderingContext2D, kind: ScreenFilterKind | null | undefined, width: number, height: number, time: number): void {
  const decoded = decodeFilterValue(kind);
  if (!decoded) return;
  const p = decoded.params;
  ctx.save();
  if (p.tintAmount > 0) {
    ctx.globalCompositeOperation = p.blend === 'normal' ? 'source-over' : p.blend;
    ctx.fillStyle = `rgba(${rgb(p.tint)},${p.tintAmount})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
  }
  const strength = Math.min(1, p.vignette + (p.pulse ? p.pulse * (0.5 + 0.5 * Math.sin(time * 5)) : 0));
  if (strength > 0) {
    const g = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.32, width / 2, height / 2, Math.hypot(width, height) / 2);
    g.addColorStop(0, `rgba(${rgb(p.vignetteColor)},0)`); g.addColorStop(1, `rgba(${rgb(p.vignetteColor)},${strength})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- eyecatch card

export function drawChapterCard(ctx: CanvasRenderingContext2D, card: ChapterCard, localTime: number, width: number, height: number): void {
  const duration = Math.max(0.01, card.duration);
  const fadeIn = Math.min(0.35, duration / 4), fadeOut = Math.min(0.45, duration / 4);
  const alpha = Math.min(clamp(localTime / fadeIn, 0, 1), clamp((duration - localTime) / fadeOut, 0, 1));
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#15131f'); bg.addColorStop(1, '#2a2340');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
  // Diagonal light band sweeping across while the card is up.
  const sweep = clamp(localTime / duration, 0, 1);
  ctx.save(); ctx.globalAlpha = alpha * 0.18; ctx.translate(width * (sweep * 1.6 - 0.3), 0); ctx.rotate(-0.35);
  ctx.fillStyle = '#b9a8ff'; ctx.fillRect(-width * 0.06, -height, width * 0.12, height * 3); ctx.restore();
  const enter = easeOutBack(clamp((localTime - 0.1) / 0.5, 0, 1));
  const titleSize = Math.round(width * 0.052), subSize = Math.round(width * 0.02);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${titleSize}px system-ui, "PingFang SC", sans-serif`;
  ctx.fillStyle = '#f6f2ff';
  ctx.globalAlpha = alpha * clamp(enter, 0, 1);
  ctx.fillText(card.title, width / 2 + (1 - enter) * width * 0.04, height * 0.45);
  const lineW = width * 0.32 * clamp((localTime - 0.25) / 0.45, 0, 1);
  ctx.fillStyle = '#b9a8ff'; ctx.fillRect(width / 2 - lineW / 2, height * 0.45 + titleSize * 0.72, lineW, Math.max(2, height * 0.004));
  if (card.subtitle) {
    ctx.globalAlpha = alpha * clamp((localTime - 0.4) / 0.4, 0, 1);
    ctx.font = `500 ${subSize}px system-ui, "PingFang SC", sans-serif`; ctx.fillStyle = '#cfc6ea';
    ctx.fillText(card.subtitle, width / 2, height * 0.45 + titleSize * 1.25);
  }
  ctx.restore();
}
