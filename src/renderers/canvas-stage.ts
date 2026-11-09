import type {
  CharacterLayerSet,
  FaceTemplate,
  FaceTemplateFeatureName,
  PuppetPartName,
  ImageSet,
  MouthCue,
  PerformanceDocument,
  PerformanceLine,
  ReplayCharacter,
  ReplayMediaDefinition,
  ReplayTextDefinition,
  ReplayBubbleDefinition,
  ReplayChatWindowDefinition,
  ReplayImageDefinition,
  ReplayChatParticipantDefinition,
  SceneEffectStack,
  SceneFilterSpec,
  SceneMaskSpec,
  SceneLayerId,
  SceneGraphNode,
  CustomObjectRuntimeState,
  CustomObjectTransform,
  CustomPresentationObject,
  CustomObjectHotspot,
  StagePosition,
  Viseme,
  WheelStep
} from '../core/types.js';
import { replayEase } from './easing.js';
import { evaluateRplGenMotion } from './rplgen-motion.js';
import { evaluatePuppet, normalizePuppetRig, type PuppetPartState } from '../puppet/rig.js';
import { projectFaceFeature } from '../core/face.js';
import { projectStageTransform } from '../core/projection.js';
import { applyLatticeOffsets } from '../puppet/lattice.js';

export type BrowserAssetSource = string | Blob | ArrayBuffer | Uint8Array | null | undefined;
export type BrowserAssetResolver = (assetIdOrSource: string) => Promise<BrowserAssetSource> | BrowserAssetSource;

export interface CanvasStageRendererOptions {
  canvas: HTMLCanvasElement;
  performance: PerformanceDocument;
  resolveAsset: BrowserAssetResolver;
}


export interface CustomObjectHitRegion {
  objectId: string;
  stateId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  hotspots: CustomObjectHotspot[];
}

export interface CustomObjectHitResult {
  objectId: string;
  stateId: string | null;
  hotspotId?: string | null;
  localX: number;
  localY: number;
  region: CustomObjectHitRegion;
}

export interface CustomObjectInteractionOverride {
  visible?: boolean;
  stateId?: string | null;
  transform?: Partial<CustomObjectTransform>;
}

export interface FrameSelection {
  ref: string | null;
  viseme: Viseme;
  blinking: boolean;
}

export interface CharacterLayerSelection {
  base: string | null;
  overlay: string | null;
  eyes: string | null;
  eyelids: string | null;
  pupils: string | null;
  brows: string | null;
  mouth: string | null;
  blinking: boolean;
  viseme: Viseme;
}

const OPEN_VISEMES = new Set<Viseme>(['OPEN', 'A', 'I', 'U', 'E', 'O', 'AE', 'UU', 'OO', 'W']);
const ENGLISH_SPECIAL_VISEMES = new Set<Viseme>(['SCHWA', 'AE', 'UU', 'OO', 'W', 'F', 'TH', 'M']);
const FACE_TEMPLATE_PARTS = new Set<PuppetPartName>(['eyes', 'eyelids', 'pupils', 'brows', 'mouth']);

function selectLayerSetFaceParts(set: CharacterLayerSet | null | undefined, viseme: Viseme, blinking: boolean): Partial<CharacterLayerSelection> {
  const src = set ?? {};
  const eyelids = blinking ? (src.eyelidsClosed ?? null) : (src.eyelidsOpen ?? null);
  const eyes = blinking && !eyelids ? (src.eyesClosed ?? src.eyesOpen ?? null) : (src.eyesOpen ?? src.eyesClosed ?? null);
  const preciseKeyByViseme: Partial<Record<Viseme, keyof CharacterLayerSet>> = {
    A: 'mouthA', I: 'mouthI', U: 'mouthU', E: 'mouthE', O: 'mouthO',
    SCHWA: 'mouthSchwa', AE: 'mouthAe', UU: 'mouthUu', OO: 'mouthOo',
    W: 'mouthW', F: 'mouthF', TH: 'mouthTh', M: 'mouthM'
  };
  const fallbackKeyByEnglishViseme: Partial<Record<Viseme, keyof CharacterLayerSet>> = { AE: 'mouthA', UU: 'mouthU', OO: 'mouthO', W: 'mouthU' };
  let mouth = src.mouthClosed ?? null;
  const preciseKey = preciseKeyByViseme[viseme];
  const precise = preciseKey ? (src[preciseKey] ?? null) : null;
  const fallbackKey = fallbackKeyByEnglishViseme[viseme];
  const fallback = fallbackKey ? (src[fallbackKey] ?? null) : null;
  if (precise || ENGLISH_SPECIAL_VISEMES.has(viseme)) mouth = precise ?? fallback ?? mouth;
  else if (OPEN_VISEMES.has(viseme)) mouth = src.mouthOpen ?? mouth;
  return { eyes, eyelids, pupils: src.pupils ?? null, brows: src.brows ?? null, mouth };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}


function filterCss(filters: SceneFilterSpec[] | undefined): string {
  const out: string[] = [];
  for (const filter of filters ?? []) {
    if (filter.enabled === false) continue;
    const amount = Number(filter.amount);
    switch (filter.kind) {
      case 'brightness': out.push(`brightness(${clamp(Number.isFinite(amount) ? amount : 1, 0, 3)})`); break;
      case 'contrast': out.push(`contrast(${clamp(Number.isFinite(amount) ? amount : 1, 0, 3)})`); break;
      case 'saturation': out.push(`saturate(${clamp(Number.isFinite(amount) ? amount : 1, 0, 4)})`); break;
      case 'grayscale': out.push(`grayscale(${clamp(Number.isFinite(amount) ? amount : 1, 0, 1)})`); break;
      case 'blur': out.push(`blur(${clamp(Number.isFinite(amount) ? amount : 4, 0, 48)}px)`); break;
      case 'custom': {
        const css = typeof filter.metadata?.css === 'string' ? filter.metadata.css.trim() : '';
        if (css) out.push(css);
        break;
      }
      default: break;
    }
  }
  return out.join(' ');
}

function activeEffectStack(stack?: SceneEffectStack | null): boolean {
  return Boolean(stack?.mask && stack.mask.kind !== 'none') || Boolean(stack?.filters?.some(filter => filter.enabled !== false));
}

function mergeEffectStacks(...stacks: Array<SceneEffectStack | null | undefined>): SceneEffectStack {
  const filters: SceneFilterSpec[] = [];
  let mask: SceneMaskSpec | null = null;
  for (const stack of stacks) {
    if (!stack) continue;
    filters.push(...(stack.filters ?? []).map(filter => ({ ...filter })));
    if (stack.mask && stack.mask.kind !== 'none') mask = { ...stack.mask };
  }
  return { filters, mask };
}

export function visemeAt(cues: MouthCue[], localTime: number, leadMs = 0): Viseme {
  const t = Math.max(0, localTime + leadMs / 1000);
  return cues.find(cue => t >= cue.start && t < cue.end)?.viseme ?? 'SILENCE';
}

export function pseudoViseme(text: string, localTime: number, duration: number): Viseme {
  if (!text.trim() || duration <= 0) return 'SILENCE';
  const punctuation = (text.match(/[，。！？,.!?;；:：…—]/g) || []).length;
  const pace = clamp((Array.from(text).length - punctuation) / 8, 1, 8);
  const cycle = Math.max(0.11, 0.26 - pace * 0.015);
  const progress = clamp(localTime / duration, 0, 1);
  const roughChar = Math.floor(Array.from(text).length * progress);
  const before = Array.from(text)[Math.max(0, roughChar - 1)] ?? '';
  if (/[。！？!?…，,；;：:]/.test(before)) return 'SILENCE';
  return Math.sin((localTime / cycle) * Math.PI * 2) > 0.18 ? 'OPEN' : 'CLOSED';
}


export function revealText(line: Pick<PerformanceLine, 'text'|'textEffect'|'textEffectDuration'|'duration'>, localTime: number): string {
  if (line.textEffect === 'all' || !line.text) return line.text;
  const revealDuration = Math.max(0.05, Math.min(line.duration, line.textEffectDuration || line.duration));
  const progress = clamp(localTime / revealDuration, 0, 1);
  if (line.textEffect === 'l2l') {
    const parts = String(line.text).split(/\n/);
    if (parts.length <= 1) return progress < 0.5 ? '' : line.text;
    return parts.slice(0, Math.max(1, Math.ceil(parts.length * progress))).join('\n');
  }
  const chars = Array.from(line.text);
  const tuned = line.textEffect === 'run' ? Math.min(1, progress * 1.35) : progress;
  return chars.slice(0, Math.ceil(chars.length * tuned)).join('');
}

export function blinkAt(character: ReplayCharacter, localTime: number, speakingOpen = false, templateLayers?: CharacterLayerSet | null): boolean {
  const placeholder = !character.layers?.base && !character.images?.idle;
  const templateCanBlink = Boolean(templateLayers?.eyesClosed || templateLayers?.eyelidsClosed || (templateLayers?.eyeLeftClosed && templateLayers?.eyeRightClosed) || (templateLayers?.eyelidLeftClosed && templateLayers?.eyelidRightClosed));
  const canBlink = placeholder || Boolean(character.layers?.eyesClosed || character.layers?.eyelidsClosed || (character.layers?.eyeLeftClosed && character.layers?.eyeRightClosed) || (character.layers?.eyelidLeftClosed && character.layers?.eyelidRightClosed)) || Boolean(character.images?.blink) || templateCanBlink;
  if (!canBlink || speakingOpen) return false;
  const seed = ((hashString(character.id) % 1000) / 1000) * 2.2;
  const interval = 2.6 + (hashString(character.name) % 7) * 0.17;
  return (localTime + seed) % interval < 0.18;
}

function expressionSet(character: ReplayCharacter, expression: string): ImageSet {
  return expression && expression !== 'default' ? (character.expressions[expression] ?? {}) : character.images;
}

function expressionLayers(character: ReplayCharacter, expression: string): CharacterLayerSet {
  return expression && expression !== 'default' ? (character.layerExpressions?.[expression] ?? {}) : {};
}

export function selectCharacterLayers(
  character: ReplayCharacter,
  expression: string,
  viseme: Viseme,
  blinking: boolean
): CharacterLayerSelection {
  const base = character.layers ?? {};
  const expr = expressionLayers(character, expression);
  const eyelids = blinking
    ? (expr.eyelidsClosed ?? base.eyelidsClosed ?? null)
    : (expr.eyelidsOpen ?? base.eyelidsOpen ?? null);
  const eyes = blinking && !eyelids
    ? (expr.eyesClosed ?? base.eyesClosed ?? expr.eyesOpen ?? base.eyesOpen ?? null)
    : (expr.eyesOpen ?? base.eyesOpen ?? expr.eyesClosed ?? base.eyesClosed ?? null);
  const pupils = expr.pupils ?? base.pupils ?? null;
  const brows = expr.brows ?? base.brows ?? null;
  let mouth: string | null = expr.mouthClosed ?? base.mouthClosed ?? null;
  const preciseKeyByViseme: Partial<Record<Viseme, keyof CharacterLayerSet>> = {
    A: 'mouthA', I: 'mouthI', U: 'mouthU', E: 'mouthE', O: 'mouthO',
    SCHWA: 'mouthSchwa', AE: 'mouthAe', UU: 'mouthUu', OO: 'mouthOo',
    W: 'mouthW', F: 'mouthF', TH: 'mouthTh', M: 'mouthM'
  };
  const fallbackKeyByEnglishViseme: Partial<Record<Viseme, keyof CharacterLayerSet>> = {
    AE: 'mouthA', UU: 'mouthU', OO: 'mouthO', W: 'mouthU'
  };
  const preciseKey = preciseKeyByViseme[viseme];
  const precise = preciseKey ? (expr[preciseKey] ?? base[preciseKey] ?? null) : null;
  const fallbackKey = fallbackKeyByEnglishViseme[viseme];
  const oldSiteFallback = fallbackKey ? (expr[fallbackKey] ?? base[fallbackKey] ?? null) : null;
  if (precise || ENGLISH_SPECIAL_VISEMES.has(viseme)) {
    // Exact old-site behavior: dedicated EN image first; æ/ʊ/ɔ/w fall back to
    // A/U/O/U, while ə/f/th/m fall back to idle/closed.
    mouth = precise ?? oldSiteFallback ?? mouth;
  } else if (OPEN_VISEMES.has(viseme)) {
    mouth = expr.mouthOpen ?? base.mouthOpen ?? mouth;
  }
  return {
    base: expr.base ?? base.base ?? null,
    overlay: expr.overlay ?? base.overlay ?? null,
    eyes,
    eyelids,
    pupils,
    brows,
    mouth,
    blinking,
    viseme
  };
}

export function selectCharacterFrame(
  character: ReplayCharacter,
  expression: string,
  viseme: Viseme,
  blinking: boolean
): FrameSelection {
  const set = expressionSet(character, expression);
  const fallback = character.images;
  let ref = set.idle ?? fallback.idle ?? null;
  if (OPEN_VISEMES.has(viseme)) {
    const legacyFallback: Partial<Record<Viseme, 'A'|'I'|'U'|'E'|'O'>> = { AE:'A', UU:'U', OO:'O', W:'U' };
    const key = (viseme === 'A' || viseme === 'I' || viseme === 'U' || viseme === 'E' || viseme === 'O') ? viseme : legacyFallback[viseme];
    const precise = key ? set[key] ?? fallback[key] : null;
    ref = precise ?? set.open ?? fallback.open ?? ref;
  }
  if (blinking) ref = set.blink ?? fallback.blink ?? ref;
  return { ref, viseme, blinking };
}

export function locatePerformanceLine(performance: PerformanceDocument, time: number): { line: PerformanceLine; index: number; localTime: number } | null {
  if (!performance.lines.length) return null;
  const t = clamp(time, 0, Math.max(0, performance.duration));
  let previous = performance.lines[0]!;
  for (let index = 0; index < performance.lines.length; index += 1) {
    const line = performance.lines[index]!;
    if (t >= line.start && t < line.end) return { line, index, localTime: t - line.start };
    if (t < line.start) return { line: previous, index: Math.max(0, index - 1), localTime: previous.duration };
    previous = line;
  }
  const lastIndex = performance.lines.length - 1;
  return { line: performance.lines[lastIndex]!, index: lastIndex, localTime: performance.lines[lastIndex]!.duration };
}

function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const char of Array.from(String(text ?? ''))) {
    if (char === '\n') { lines.push(line); line = ''; continue; }
    const test = line + char;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = char; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 99,
  align: CanvasTextAlign = 'left'
): void {
  const chunks = Array.from(String(text ?? '').replace(/\n/g, '↵'));
  const lines: string[] = [];
  let line = '';
  ctx.textAlign = align;
  for (const char of chunks) {
    if (char === '↵') {
      lines.push(line);
      line = '';
      if (lines.length >= maxLines) break;
      continue;
    }
    const test = line + char;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = char;
      if (lines.length >= maxLines) break;
    } else line = test;
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.slice(0, maxLines).forEach((value, i) => ctx.fillText(value, x, y + i * lineHeight));
}

interface DiceMeta { expression?: string; result?: string; target?: string; outcome?: 'critical'|'success'|'fail'|'fumble'; }

export function parseDiceText(text: string): DiceMeta | null {
  const expression = text.match(/\b\d+d\d+(?:\s*[+\-*/]\s*\d+)?\b/i)?.[0];
  const pair = text.match(/(\d+)\s*[\/／]\s*(\d+)/);
  const lower = text.toLowerCase();
  let outcome: DiceMeta['outcome'];
  if (/大成功|critical/.test(lower)) outcome = 'critical';
  else if (/大失败|大失敗|fumble/.test(lower)) outcome = 'fumble';
  else if (/失败|失敗|fail/.test(lower)) outcome = 'fail';
  else if (/成功|success/.test(lower)) outcome = 'success';
  if (!expression && !pair && !outcome) return null;
  return { expression, result: pair?.[1], target: pair?.[2], outcome };
}

function outcomeColor(outcome?: DiceMeta['outcome']): string {
  return ({ critical:'#77f0b6', success:'#9fd0ff', fail:'#ef8a8a', fumble:'#ff6d6d' } as const)[outcome ?? 'success'] ?? '#f4d18b';
}

export function stageRect(position: StagePosition, count: number, width: number, height: number, index = 0, positions: StagePosition[] = []): { cx: number; maxW: number; maxH: number; floor: number } {
  const duplicateSlots = positions.length === count && new Set(positions.filter(value => value !== 'auto')).size < positions.filter(value => value !== 'auto').length;
  const needsSpread = count > 3 || duplicateSlots;
  let x: number;
  if (needsSpread) {
    const left = count >= 5 ? 0.10 : 0.14;
    const right = 1 - left;
    x = count <= 1 ? 0.5 : left + (right - left) * (Math.max(0, Math.min(count - 1, index)) / (count - 1));
  } else x = position === 'left' ? 0.22 : position === 'right' ? 0.78 : 0.5;
  // Keep normal VN casts at a stable apparent character size. Three-person shots
  // should gain density through horizontal overlap, not by shrinking every sprite
  // the moment a third actor enters. Only unusually crowded 4+ actor layouts
  // reduce the per-actor width budget.
  const maxW = width * (count <= 3 ? 0.31 : Math.max(0.14, Math.min(0.22, 0.88 / count)));
  return { cx: width * x, maxW, maxH: height * 0.71, floor: height * 0.88 };
}


function transformedStageRect(
  rect: { cx: number; maxW: number; maxH: number; floor: number },
  transform: PerformanceLine['stage'][number]['transform'],
  width: number,
  height: number,
  projection: PerformanceLine['sceneGraph']['projection'] = 'flat',
  camera?: PerformanceLine['cameraTransform']
): { cx: number; maxW: number; maxH: number; floor: number } {
  const authored = {
    x: transform?.x ?? rect.cx / Math.max(1, width),
    y: transform?.y ?? rect.floor / Math.max(1, height),
    scale: transform?.scale ?? 1,
    depth: transform?.depth ?? 0
  };
  const projected = projectStageTransform(authored, projection, camera);
  const scale = clamp(Number(projected.scale) || 1, 0.12, 4);
  return {
    cx: width * clamp(Number(projected.x), -0.5, 1.5),
    floor: height * clamp(Number(projected.y), -0.5, 1.5),
    maxW: rect.maxW * scale,
    maxH: rect.maxH * scale
  };
}


function mergeImageSet(base: ImageSet | undefined, override: ImageSet | undefined): ImageSet {
  return { ...(base ?? {}), ...(override ?? {}) };
}

function mergeLayerSet(base: CharacterLayerSet | undefined, override: CharacterLayerSet | undefined): CharacterLayerSet {
  return { ...(base ?? {}), ...(override ?? {}) };
}

function characterForStageFacing(character: ReplayCharacter, actor: PerformanceLine['stage'][number]): ReplayCharacter {
  if (character.stageFacing?.policy !== 'paired') return character;
  const requested = actor.transform?.facing;
  const native = character.stageFacing.nativeFacing;
  const direction = requested === 'left' || requested === 'right' ? requested : (native === 'left' || native === 'right' ? native : null);
  const variant = direction ? character.stageFacing.variants?.[direction] : null;
  if (!variant) return character;
  const expressions = { ...(character.expressions ?? {}) };
  for (const [name, set] of Object.entries(variant.expressions ?? {})) expressions[name] = mergeImageSet(expressions[name], set);
  const layerExpressions = { ...(character.layerExpressions ?? {}) };
  for (const [name, set] of Object.entries(variant.layerExpressions ?? {})) layerExpressions[name] = mergeLayerSet(layerExpressions[name], set);
  return {
    ...character,
    images: mergeImageSet(character.images, variant.images),
    expressions,
    layers: mergeLayerSet(character.layers, variant.layers),
    layerExpressions
  };
}

function shouldMirrorActor(character: ReplayCharacter, actor: PerformanceLine['stage'][number]): boolean {
  if (character.stageFacing?.policy !== 'flippable') return false;
  const native = character.stageFacing?.nativeFacing ?? 'neutral';
  const desired = actor.transform?.facing ?? native;
  if (native === 'neutral' || desired === 'neutral') return false;
  return desired !== native;
}

function initials(name: string): string {
  const chars = Array.from(name.trim());
  return chars.slice(0, 2).join('').toUpperCase() || '?';
}


function affineTriangle(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  src: [{x:number;y:number},{x:number;y:number},{x:number;y:number}],
  dst: [{x:number;y:number},{x:number;y:number},{x:number;y:number}]
): void {
  const [s0,s1,s2]=src,[d0,d1,d2]=dst;
  const det=s0.x*(s1.y-s2.y)+s1.x*(s2.y-s0.y)+s2.x*(s0.y-s1.y);
  if(Math.abs(det)<1e-8)return;
  const a=(d0.x*(s1.y-s2.y)+d1.x*(s2.y-s0.y)+d2.x*(s0.y-s1.y))/det;
  const c=(d0.x*(s2.x-s1.x)+d1.x*(s0.x-s2.x)+d2.x*(s1.x-s0.x))/det;
  const e=(d0.x*(s1.x*s2.y-s2.x*s1.y)+d1.x*(s2.x*s0.y-s0.x*s2.y)+d2.x*(s0.x*s1.y-s1.x*s0.y))/det;
  const b=(d0.y*(s1.y-s2.y)+d1.y*(s2.y-s0.y)+d2.y*(s0.y-s1.y))/det;
  const d=(d0.y*(s2.x-s1.x)+d1.y*(s0.x-s2.x)+d2.y*(s1.x-s0.x))/det;
  const f=(d0.y*(s1.x*s2.y-s2.x*s1.y)+d1.y*(s2.x*s0.y-s0.x*s2.y)+d2.y*(s0.x*s1.y-s1.x*s0.y))/det;
  ctx.save();
  ctx.beginPath();ctx.moveTo(d0.x,d0.y);ctx.lineTo(d1.x,d1.y);ctx.lineTo(d2.x,d2.y);ctx.closePath();ctx.clip();
  ctx.transform(a,b,c,d,e,f);ctx.drawImage(image,0,0);ctx.restore();
}

function drawLatticeImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  columns: number,
  rows: number,
  offsets: {x:number;y:number}[] | null,
  bounds: {x:number;y:number;w:number;h:number}={x:0,y:0,w:1,h:1}
): void {
  const lattice={columns:Math.max(2,Math.floor(columns)),rows:Math.max(2,Math.floor(rows))};
  const points=applyLatticeOffsets(lattice,offsets);
  const cols=lattice.columns, rs=lattice.rows;
  const at=(x:number,y:number)=>points[y*cols+x]!;
  const src=(x:number,y:number)=>({x:image.naturalWidth*(bounds.x+bounds.w*x/(cols-1)),y:image.naturalHeight*(bounds.y+bounds.h*y/(rs-1))});
  const dst=(p:{x:number;y:number})=>({x:(bounds.x+bounds.w*p.x)*width,y:(bounds.y+bounds.h*p.y)*height});
  for(let y=0;y<rs-1;y+=1)for(let x=0;x<cols-1;x+=1){
    const s00=src(x,y),s10=src(x+1,y),s01=src(x,y+1),s11=src(x+1,y+1);
    const d00=dst(at(x,y)),d10=dst(at(x+1,y)),d01=dst(at(x,y+1)),d11=dst(at(x+1,y+1));
    affineTriangle(ctx,image,[s00,s10,s11],[d00,d10,d11]);
    affineTriangle(ctx,image,[s00,s11,s01],[d00,d11,d01]);
  }
}

export class CanvasStageRenderer {
  private performance: PerformanceDocument;
  private readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readonly resolveAsset: BrowserAssetResolver;
  private imageCache = new Map<string, Promise<HTMLImageElement | null>>();
  private imageBoundsCache = new WeakMap<HTMLImageElement, {x:number;y:number;w:number;h:number}>();
  private objectUrls = new Set<string>();
  private scratchCanvases: HTMLCanvasElement[] = [];
  private maskCanvases: HTMLCanvasElement[] = [];
  private scratchDepth = 0;
  private customObjectOverrides = new Map<string, CustomObjectInteractionOverride>();
  private customObjectHitRegions: CustomObjectHitRegion[] = [];
  private stateStartCache = new Map<string, number>();
  private renderTail: Promise<unknown> = Promise.resolve();
  private renderTicket = 0;

  constructor(options: CanvasStageRendererOptions) {
    this.canvas = options.canvas;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is unavailable.');
    this.ctx = ctx;
    this.performance = options.performance; this.preloadCharacterImages();
    this.resolveAsset = options.resolveAsset;
  }

  setPerformance(performance: PerformanceDocument): void {
    this.performance = performance; this.preloadCharacterImages();
    this.stateStartCache.clear();
    this.clearCustomObjectInteractionOverrides();
  }

  get element(): HTMLCanvasElement { return this.canvas; }

  customObjectDefinition(objectId: string): CustomPresentationObject | null {
    return this.performance.customObjects?.find(object => object.id === objectId) ?? null;
  }

  setCustomObjectInteractionOverride(objectId: string, patch: CustomObjectInteractionOverride): void {
    const previous = this.customObjectOverrides.get(objectId) ?? {};
    this.customObjectOverrides.set(objectId, {
      ...previous,
      ...patch,
      transform: patch.transform ? { ...(previous.transform ?? {}), ...patch.transform } : previous.transform
    });
  }

  customObjectInteractionOverride(objectId: string): CustomObjectInteractionOverride | null {
    const value = this.customObjectOverrides.get(objectId);
    return value ? { ...value, transform: value.transform ? { ...value.transform } : undefined } : null;
  }

  clearCustomObjectInteractionOverrides(objectId?: string): void {
    if (objectId) this.customObjectOverrides.delete(objectId);
    else this.customObjectOverrides.clear();
  }

  customObjectHitTest(x: number, y: number): CustomObjectHitResult | null {
    for (let i = this.customObjectHitRegions.length - 1; i >= 0; i -= 1) {
      const region = this.customObjectHitRegions[i]!;
      const cx = region.x + region.width / 2, cy = region.y + region.height / 2;
      const radians = -(Number(region.rotation) || 0) * Math.PI / 180;
      const dx = x - cx, dy = y - cy;
      const rx = dx * Math.cos(radians) - dy * Math.sin(radians) + cx;
      const ry = dx * Math.sin(radians) + dy * Math.cos(radians) + cy;
      if (rx < region.x || rx > region.x + region.width || ry < region.y || ry > region.y + region.height) continue;
      const localX = clamp((rx - region.x) / Math.max(1, region.width), 0, 1);
      const localY = clamp((ry - region.y) / Math.max(1, region.height), 0, 1);
      const hotspot = [...region.hotspots].reverse().find(item => {
        if (item.stateId && item.stateId !== region.stateId) return false;
        return localX >= item.x && localX <= item.x + item.width && localY >= item.y && localY <= item.y + item.height;
      });
      return { objectId: region.objectId, stateId: region.stateId, hotspotId: hotspot?.id ?? null, localX, localY, region };
    }
    return null;
  }

  /** Loads character art ahead of use so a speaker's first line is not held back by decoding. */
  private preloadCharacterImages(): void {
    const refs = new Set<string>();
    for (const character of this.performance.characters) {
      if (!character.showOnStage) continue;
      for (const set of [character.images, ...Object.values(character.expressions ?? {})]) if (set?.idle) refs.add(set.idle);
    }
    const queue = [...refs];
    const worker = async (): Promise<void> => { for (let ref = queue.shift(); ref; ref = queue.shift()) await this.image(ref); };
    for (let i = 0; i < 3; i += 1) void worker();
  }

  clearAssetCache(): void {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls.clear();
    this.imageCache.clear();
    this.imageBoundsCache = new WeakMap();
  }

  destroy(): void { this.clearAssetCache(); this.scratchCanvases = []; this.maskCanvases = []; }

  private scratchCanvas(depth: number, mask = false): HTMLCanvasElement {
    const pool = mask ? this.maskCanvases : this.scratchCanvases;
    let canvas = pool[depth];
    if (!canvas) { canvas = document.createElement('canvas'); pool[depth] = canvas; }
    if (canvas.width !== this.canvas.width || canvas.height !== this.canvas.height) {
      canvas.width = this.canvas.width; canvas.height = this.canvas.height;
    }
    const ctx = canvas.getContext('2d');
    ctx?.setTransform(1, 0, 0, 1, 0, 0);
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /** Seconds since a persistent state began, so its entrance animation does not replay on every line. */
  private elapsedSince(key: string, line: PerformanceLine, localTime: number, same: (other: PerformanceLine) => boolean): number {
    const cacheKey = `${key}@${line.index}`;
    let start = this.stateStartCache.get(cacheKey);
    if (start === undefined) {
      let first = line.index - 1;
      while (first > 0 && same(this.performance.lines[first - 1]!)) first -= 1;
      start = this.performance.lines[first]?.start ?? line.start;
      this.stateStartCache.set(cacheKey, start);
    }
    return Math.max(0, line.start - start) + localTime;
  }

  private maskElapsed(mask: SceneMaskSpec, line: PerformanceLine, localTime: number): number {
    if (!mask.animation || mask.animation === 'none') return localTime;
    const json = JSON.stringify(mask);
    const carries = (other: PerformanceLine) => {
      const graph = other.sceneGraph;
      const stacks = [graph?.worldEffects, graph?.outputEffects, ...(graph?.layers ?? []).map(item => item.effects), ...(graph?.nodes ?? []).map(item => item.effects)];
      return stacks.some(stack => stack?.mask && JSON.stringify(stack.mask) === json);
    };
    return this.elapsedSince(`mask:${json}`, line, localTime, carries);
  }

  private async drawMask(mask: SceneMaskSpec, canvas: HTMLCanvasElement, line: PerformanceLine, localTime: number): Promise<void> {
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const { width, height } = canvas;
    const duration = Math.max(0.05, Number(mask.duration) || Number(line.state.cgPresentation?.duration) || 0.6);
    const raw = clamp(this.maskElapsed(mask, line, localTime) / duration, 0, 1);
    const progress = mask.animation && mask.animation !== 'none' ? replayEase('sigmoid', raw) : 1;
    const x = clamp(Number(mask.x ?? 0.5), -0.5, 1.5) * width;
    const y = clamp(Number(mask.y ?? 0.5), -0.5, 1.5) * height;
    if (mask.animation === 'wipe-left' || mask.animation === 'wipe-right') {
      const w = width * progress;
      ctx.fillStyle = '#fff';
      ctx.fillRect(mask.animation === 'wipe-right' ? width - w : 0, 0, w, height);
      return;
    }
    if (mask.kind === 'circle') {
      const radius = Math.max(1, Math.min(width, height) * clamp(Number(mask.radius ?? 0.42), 0.01, 1.5) * (mask.animation === 'reveal' ? progress : 1));
      const feather = clamp(Number(mask.feather ?? 0.08), 0, 0.95);
      const gradient = ctx.createRadialGradient(x, y, radius * Math.max(0, 1 - feather), x, y, radius);
      gradient.addColorStop(0, '#fff'); gradient.addColorStop(1, feather > 0 ? 'rgba(255,255,255,0)' : '#fff');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height); return;
    }
    if (mask.kind === 'rect') {
      const baseW = width * clamp(Number(mask.width ?? 0.7), 0.01, 2);
      const baseH = height * clamp(Number(mask.height ?? 0.7), 0.01, 2);
      const factor = mask.animation === 'reveal' ? progress : 1;
      const w = baseW * factor, h = baseH * factor;
      ctx.fillStyle = '#fff'; ctx.fillRect(x - w / 2, y - h / 2, w, h); return;
    }
    let ref = mask.assetId ?? null;
    if (mask.kind === 'node' && mask.nodeId) ref = line.sceneGraph?.nodes?.find(node => node.id === mask.nodeId)?.assetId ?? null;
    if ((mask.kind === 'asset' || mask.kind === 'node') && ref) {
      const image = await this.image(ref); if (!image) return;
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const dw = image.naturalWidth * scale, dh = image.naturalHeight * scale;
      ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
    }
  }

  private tintSurface(ctx: CanvasRenderingContext2D, color: string, amount: number, mode: GlobalCompositeOperation = 'source-atop'): void {
    const strength = clamp(Number(amount) || 0, 0, 1); if (!strength) return;
    ctx.save(); ctx.globalCompositeOperation = mode; ctx.globalAlpha = strength; ctx.fillStyle = color || '#ffffff';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height); ctx.restore();
  }

  private async withEffects(
    effects: SceneEffectStack | null | undefined,
    draw: () => Promise<void> | void,
    line: PerformanceLine,
    localTime: number,
    ambient?: { color: string; intensity: number } | null
  ): Promise<void> {
    const hasAmbient = Boolean(ambient && ambient.intensity > 0);
    if (!activeEffectStack(effects) && !hasAmbient) { await draw(); return; }
    const target = this.ctx;
    const depth = this.scratchDepth++;
    const scratch = this.scratchCanvas(depth, false); const scratchCtx = scratch.getContext('2d');
    if (!scratchCtx) { this.scratchDepth--; await draw(); return; }
    this.ctx = scratchCtx;
    try { await draw(); } catch (error) { this.scratchDepth--; throw error; } finally { this.ctx = target; }
    if (hasAmbient && ambient) this.tintSurface(scratchCtx, ambient.color, ambient.intensity);
    for (const filter of effects?.filters ?? []) if (filter.enabled !== false && filter.kind === 'tint') this.tintSurface(scratchCtx, filter.color ?? '#ffffff', Number(filter.amount ?? 0.25));
    const mask = effects?.mask;
    if (mask && mask.kind !== 'none') {
      const maskCanvas = this.scratchCanvas(depth, true);
      await this.drawMask(mask, maskCanvas, line, localTime);
      scratchCtx.save(); scratchCtx.globalCompositeOperation = mask.inverted ? 'destination-out' : 'destination-in'; scratchCtx.drawImage(maskCanvas, 0, 0); scratchCtx.restore();
    }
    target.save();
    const css = filterCss(effects?.filters); if (css) target.filter = css;
    target.drawImage(scratch, 0, 0); target.restore();
    this.scratchDepth--;
  }

  private nodeEffects(line: PerformanceLine, nodeId: string, layerId: SceneLayerId): { effects: SceneEffectStack; ambient: { color: string; intensity: number } | null; node?: SceneGraphNode } {
    const node = line.sceneGraph?.nodes?.find(item => item.id === nodeId);
    const layer = line.sceneGraph?.layers?.find(item => item.id === (node?.layerId ?? layerId));
    const effects = mergeEffectStacks(layer?.effects, node?.effects);
    const ambientConfig = line.sceneGraph?.ambientLight;
    const ambient = ambientConfig?.enabled && ambientConfig.layers?.includes(node?.layerId ?? layerId)
      ? { color: ambientConfig.color, intensity: ambientConfig.intensity }
      : null;
    return { effects, ambient, node };
  }

  private async sourceUrl(ref: string): Promise<string | null> {
    if (/^(data:|blob:|https?:)/i.test(ref)) return ref;
    const source = await this.resolveAsset(ref);
    if (!source) return null;
    if (typeof source === 'string') return source;
    const blob = source instanceof Blob ? source : new Blob([source instanceof Uint8Array ? source : source]);
    const url = URL.createObjectURL(blob);
    this.objectUrls.add(url);
    return url;
  }

  private async image(ref: string | null | undefined): Promise<HTMLImageElement | null> {
    if (!ref) return null;
    let promise = this.imageCache.get(ref);
    if (!promise) {
      promise = (async () => {
        const url = await this.sourceUrl(ref);
        if (!url) return null;
        const image = new Image();
        image.decoding = 'async';
        await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error(`Image failed to load: ${ref}`)); image.src = url; });
        return image;
      })().catch(() => { this.imageCache.delete(ref); return null; });
      this.imageCache.set(ref, promise);
    }
    return promise;
  }

  private character(id: string): ReplayCharacter | undefined {
    return this.performance.characters.find(character => character.id === id);
  }

  private drawPlaceholderActor(character: ReplayCharacter, rect: ReturnType<typeof stageRect>, viseme: Viseme, blinking: boolean, active: boolean): void {
    const bodyW = Math.min(rect.maxW * 0.62, this.canvas.width * 0.19);
    const bodyH = Math.min(rect.maxH * 0.78, this.canvas.height * 0.56);
    const x = rect.cx - bodyW / 2;
    const y = rect.floor - bodyH;
    this.ctx.save();
    this.ctx.fillStyle = `${character.color || '#8993aa'}38`;
    this.ctx.strokeStyle = character.color || '#8993aa';
    this.ctx.lineWidth = active ? 4 : 2;
    roundRect(this.ctx, x, y, bodyW, bodyH, Math.max(12, bodyW * 0.08));
    this.ctx.fill(); this.ctx.stroke();

    // Face markers deliberately stay primitive: they communicate mouth/blink state
    // even before the creator has prepared any art assets.
    const faceY = y + bodyH * 0.24;
    const eyeGap = bodyW * 0.16;
    this.ctx.fillStyle = 'rgba(0,0,0,.82)';
    if (blinking) {
      const ew = Math.max(12, bodyW * 0.12), eh = Math.max(3, bodyH * 0.008);
      this.ctx.fillRect(rect.cx - eyeGap - ew / 2, faceY, ew, eh);
      this.ctx.fillRect(rect.cx + eyeGap - ew / 2, faceY, ew, eh);
    } else {
      const ew = Math.max(8, bodyW * 0.065), eh = Math.max(8, bodyW * 0.065);
      this.ctx.fillRect(rect.cx - eyeGap - ew / 2, faceY - eh / 2, ew, eh);
      this.ctx.fillRect(rect.cx + eyeGap - ew / 2, faceY - eh / 2, ew, eh);
    }
    const mouthY = y + bodyH * 0.38;
    if (viseme === 'AE') {
      const mw=bodyW*.19,mh=bodyW*.085;this.ctx.fillRect(rect.cx-mw/2,mouthY-mh/2,mw,mh);
    } else if (viseme === 'UU' || viseme === 'W') {
      const mw=bodyW*(viseme==='W'?.055:.07),mh=bodyW*(viseme==='W'?.10:.13);this.ctx.fillRect(rect.cx-mw/2,mouthY-mh/2,mw,mh);
    } else if (viseme === 'OO') {
      const mw=bodyW*.10,mh=bodyW*.16;this.ctx.fillRect(rect.cx-mw/2,mouthY-mh/2,mw,mh);
    } else if (viseme === 'F') {
      const mw=bodyW*.16,mh=Math.max(4,bodyH*.012);this.ctx.fillRect(rect.cx-mw/2,mouthY,mw,mh);this.ctx.fillRect(rect.cx-mw*.28,mouthY-mh*1.7,mw*.56,mh*.55);
    } else if (viseme === 'TH') {
      const mw=bodyW*.12,mh=bodyW*.08;this.ctx.fillRect(rect.cx-mw/2,mouthY-mh/2,mw,mh);this.ctx.fillRect(rect.cx-mw*.24,mouthY+mh*.25,mw*.48,mh*.42);
    } else if (viseme === 'M' || viseme === 'SCHWA') {
      const mw=Math.max(16,bodyW*(viseme==='M'?.18:.14)),mh=Math.max(3,bodyH*.008);this.ctx.fillRect(rect.cx-mw/2,mouthY,mw,mh);
    } else if (OPEN_VISEMES.has(viseme)) {
      const mw = viseme === 'I' || viseme === 'E' ? bodyW * 0.15 : bodyW * 0.10;
      const mh = viseme === 'U' || viseme === 'O' ? bodyW * 0.12 : bodyW * 0.09;
      this.ctx.fillRect(rect.cx - mw / 2, mouthY - mh / 2, Math.max(10, mw), Math.max(9, mh));
    } else {
      const mw = Math.max(16, bodyW * 0.16), mh = Math.max(3, bodyH * 0.008);
      this.ctx.fillRect(rect.cx - mw / 2, mouthY, mw, mh);
    }
    this.ctx.fillStyle = '#fff';
    this.ctx.font = `700 ${Math.max(18, Math.min(34, bodyW * 0.12))}px system-ui`;
    this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
    wrapText(this.ctx, character.name, rect.cx, y + bodyH * 0.68, bodyW * 0.78, Math.max(24, bodyH * 0.08), 3, 'center');
    this.ctx.restore();
  }

  private alphaBounds(image: HTMLImageElement): {x:number;y:number;w:number;h:number} {
    const cached=this.imageBoundsCache.get(image);if(cached)return cached;
    try{
      const max=192,scale=Math.min(1,max/Math.max(image.naturalWidth,image.naturalHeight));const w=Math.max(1,Math.round(image.naturalWidth*scale)),h=Math.max(1,Math.round(image.naturalHeight*scale));
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('no canvas');ctx.clearRect(0,0,w,h);ctx.drawImage(image,0,0,w,h);const data=ctx.getImageData(0,0,w,h).data;let minX=w,minY=h,maxX=-1,maxY=-1;
      for(let y=0;y<h;y+=1)for(let x=0;x<w;x+=1)if(data[(y*w+x)*4+3]>8){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
      const result=maxX>=minX&&maxY>=minY?{x:minX/w,y:minY/h,w:Math.max(1,(maxX-minX+1))/w,h:Math.max(1,(maxY-minY+1))/h}:{x:0,y:0,w:1,h:1};this.imageBoundsCache.set(image,result);return result;
    }catch{const result={x:0,y:0,w:1,h:1};this.imageBoundsCache.set(image,result);return result;}
  }

  private puppetGeometry(character: ReplayCharacter, base: HTMLImageElement, rect: ReturnType<typeof stageRect>, focusScale: number): {x:number;y:number;dw:number;dh:number} {
    const layout=normalizePuppetRig(character.puppet).layout;
    const framingScale=({portrait:1.16,bust:1.10,half:1.04,full:1,auto:1} as const)[layout.framing]??1;
    const scale=Math.min(rect.maxH/base.naturalHeight,rect.maxW/base.naturalWidth)*focusScale*Math.max(0.1,layout.scale||1)*framingScale;
    const dw=base.naturalWidth*scale,dh=base.naturalHeight*scale;
    const anchorX=clamp(layout.anchorX, -1, 2), anchorY=clamp(layout.anchorY, -1, 2);
    return {dw,dh,x:rect.cx-dw*anchorX+dw*(layout.offsetX||0),y:rect.floor-dh*anchorY+dh*(layout.offsetY||0)};
  }

  private drawTemplatePartGeometry(character: ReplayCharacter, featureName: FaceTemplateFeatureName, baseGeometry: {x:number;y:number;dw:number;dh:number}, image: HTMLImageElement, baseImage: HTMLImageElement): {x:number;y:number;dw:number;dh:number} {
    const fit = character.faceFit;
    const feature = fit?.features?.[featureName];
    if (!feature) return baseGeometry;
    const baseScaleX = baseGeometry.dw / Math.max(1, baseImage.naturalWidth);
    const baseScaleY = baseGeometry.dh / Math.max(1, baseImage.naturalHeight);
    const projected = projectFaceFeature(featureName, feature, fit.orientation ?? 'front', fit.perspective ?? 1);
    const dw = Math.max(1, image.naturalWidth * baseScaleX * Math.max(0.15, feature.scaleX) * projected.scaleX);
    const dh = Math.max(1, image.naturalHeight * baseScaleY * Math.max(0.15, feature.scaleY) * projected.scaleY);
    const cx = baseGeometry.x + projected.centerX * baseGeometry.dw;
    const cy = baseGeometry.y + projected.centerY * baseGeometry.dh;
    return { x: cx - dw / 2, y: cy - dh / 2, dw, dh };
  }

  private async drawPuppetPart(ref: string | null, part: PuppetPartName, geometry: {x:number;y:number;dw:number;dh:number}, state: PuppetPartState, character: ReplayCharacter, options?: { faceFitDriven?: boolean; faceFeature?: FaceTemplateFeatureName; baseImage?: HTMLImageElement | null }): Promise<void> {
    const image=await this.image(ref);if(!image)return;
    const rig=normalizePuppetRig(character.puppet);const partRig=rig.parts?.[part];const lattice=partRig?.lattice;
    const featureName = options?.faceFeature ?? (part as FaceTemplateFeatureName);
    const baseGeometry = options?.faceFitDriven && options.baseImage ? this.drawTemplatePartGeometry(character, featureName, geometry, image, options.baseImage) : geometry;
    const {x,y,dw,dh}=baseGeometry;const bounds=this.alphaBounds(image);const pivotX=partRig?.pivotX??(bounds.x+bounds.w/2),pivotY=partRig?.pivotY??(bounds.y+bounds.h/2);
    const extraRotation = options?.faceFitDriven ? (character.faceFit?.features?.[featureName]?.rotation ?? 0) : 0;
    this.ctx.save();
    this.ctx.globalAlpha*=clamp(state.opacity,0,1);
    this.ctx.translate(x+pivotX*dw+state.translateX*dw,y+pivotY*dh+state.translateY*dh);
    this.ctx.rotate(state.rotation + extraRotation);
    this.ctx.scale(state.scaleX,state.scaleY);
    this.ctx.translate(-pivotX*dw,-pivotY*dh);
    if(lattice && !options?.faceFitDriven)drawLatticeImage(this.ctx,image,dw,dh,lattice.columns,lattice.rows,state.deform,bounds);
    else this.ctx.drawImage(image,0,0,dw,dh);
    this.ctx.restore();
  }

  private sideLayer(character: ReplayCharacter, expression: string, slot: keyof CharacterLayerSet): string | null {
    const expr = expressionLayers(character, expression);
    return (expr[slot] ?? character.layers?.[slot] ?? null) as string | null;
  }

  private sideTemplateSelection(character: ReplayCharacter, expression: string, template: FaceTemplate | null, blinking: boolean): Array<{part:PuppetPartName;feature:FaceTemplateFeatureName;ref:string|null}> {
    const tpl=template?.layers??{};
    const own=(slot:keyof CharacterLayerSet)=>this.sideLayer(character,expression,slot);
    const pick=(open:keyof CharacterLayerSet,closed:keyof CharacterLayerSet)=>blinking?(own(closed)??tpl[closed]??own(open)??tpl[open]??null):(own(open)??tpl[open]??own(closed)??tpl[closed]??null);
    return [
      {part:'eyes',feature:'leftEye',ref:pick('eyeLeftOpen','eyeLeftClosed')},
      {part:'eyes',feature:'rightEye',ref:pick('eyeRightOpen','eyeRightClosed')},
      {part:'eyelids',feature:'leftEyelid',ref:pick('eyelidLeftOpen','eyelidLeftClosed')},
      {part:'eyelids',feature:'rightEyelid',ref:pick('eyelidRightOpen','eyelidRightClosed')},
      {part:'pupils',feature:'leftPupil',ref:own('pupilLeft')??tpl.pupilLeft??null},
      {part:'pupils',feature:'rightPupil',ref:own('pupilRight')??tpl.pupilRight??null},
      {part:'brows',feature:'leftBrow',ref:own('browLeft')??tpl.browLeft??null},
      {part:'brows',feature:'rightBrow',ref:own('browRight')??tpl.browRight??null}
    ];
  }

  private faceTemplateFor(character: ReplayCharacter): FaceTemplate | null {
    const id = character.faceFit?.templateId;
    if (!id) return null;
    return this.performance.faceTemplates?.find(template => template.id === id) ?? null;
  }

  private async drawLayeredActor(character: ReplayCharacter, selection: CharacterLayerSelection, rect: ReturnType<typeof stageRect>, focusScale: number, expression: string): Promise<boolean> {
    const base = await this.image(selection.base);
    if (!base) return false;
    const geometry=this.puppetGeometry(character,base,rect,focusScale);
    const puppet=evaluatePuppet(character,expression,selection.viseme,selection.blinking);
    const template=this.faceTemplateFor(character);
    const templateSelection = selectLayerSetFaceParts(template?.layers, selection.viseme, selection.blinking);
    await this.drawPuppetPart(selection.base,'base',geometry,puppet.parts.base,character);

    const sideParts=this.sideTemplateSelection(character,expression,template,selection.blinking);
    const sideByPart=new Map<PuppetPartName,typeof sideParts>();
    for(const item of sideParts){const list=sideByPart.get(item.part)??[];list.push(item);sideByPart.set(item.part,list)}
    const combined: Array<[PuppetPartName,string|null,string|null]>=[
      ['eyes',selection.eyes,templateSelection.eyes??null],
      ['pupils',selection.pupils,templateSelection.pupils??null],
      ['eyelids',selection.eyelids,templateSelection.eyelids??null],
      ['brows',selection.brows,templateSelection.brows??null]
    ];
    for(const [part,localRef,templateRef] of combined){
      if(localRef){await this.drawPuppetPart(localRef,part,geometry,puppet.parts[part],character);continue}
      const sides=(sideByPart.get(part)??[]).filter(item=>!!item.ref);
      if(sides.length===2){for(const side of sides)await this.drawPuppetPart(side.ref,part,geometry,puppet.parts[part],character,{faceFitDriven:true,faceFeature:side.feature,baseImage:base});continue}
      if(templateRef)await this.drawPuppetPart(templateRef,part,geometry,puppet.parts[part],character,{faceFitDriven:true,faceFeature:part as FaceTemplateFeatureName,baseImage:base});
    }
    const mouthRef=selection.mouth??templateSelection.mouth??null;
    if(mouthRef)await this.drawPuppetPart(mouthRef,'mouth',geometry,puppet.parts.mouth,character,{faceFitDriven:!selection.mouth,faceFeature:'mouth',baseImage:base});
    if(selection.overlay)await this.drawPuppetPart(selection.overlay,'overlay',geometry,puppet.parts.overlay,character);
    return true;
  }

  private async drawCover(ref: string | null, alpha = 1, dx = 0, dy = 0): Promise<void> {
    if (!ref) return;
    const image = await this.image(ref);
    if (!image) return;
    const { width, height } = this.canvas;
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const dw = image.naturalWidth * scale;
    const dh = image.naturalHeight * scale;
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(image, (width - dw) / 2 + dx, (height - dh) / 2 + dy, dw, dh);
    this.ctx.restore();
  }

  private async drawBackground(index: number, line: PerformanceLine, localTime: number): Promise<void> {
    const current = line.state.background;
    const previous = index > 0 ? this.performance.lines[index - 1]?.state.background ?? null : null;
    if (!line.backgroundChanged || line.backgroundMethod === 'replace' || previous === current) {
      await this.drawCover(current, 0.68);
      return;
    }
    const { width } = this.canvas;
    const duration = Math.max(0.001, Math.min(line.duration, line.backgroundMethodDuration || 0.5));
    const t = clamp(localTime / duration, 0, 1);
    const eased = replayEase(line.transitionCurve, t);
    switch (line.backgroundMethod) {
      case 'delay':
        await this.drawCover(t < 1 ? previous : current, 0.68);
        break;
      case 'cross':
        await this.drawCover(previous, 0.68 * (1 - eased));
        await this.drawCover(current, 0.68 * eased);
        break;
      case 'black':
      case 'white': {
        if (t < 0.5) await this.drawCover(previous, 0.68);
        else await this.drawCover(current, 0.68);
        const phase = t < 0.5 ? t * 2 : (1 - t) * 2;
        this.ctx.save();
        this.ctx.globalAlpha = replayEase(line.transitionCurve, clamp(phase, 0, 1));
        this.ctx.fillStyle = line.backgroundMethod === 'white' ? '#fff' : '#000';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();
        break;
      }
      case 'push':
        await this.drawCover(previous, 0.68, -width * eased, 0);
        await this.drawCover(current, 0.68, width * (1 - eased), 0);
        break;
      case 'cover':
        await this.drawCover(previous, 0.68);
        await this.drawCover(current, 0.68, width * (1 - eased), 0);
        break;
      default:
        await this.drawCover(current, 0.68);
    }
  }

  private async drawCg(ref: string | null, line: PerformanceLine, localTime: number): Promise<void> {
    if (!ref) return;
    const image = await this.image(ref);
    if (!image) return;
    const { width, height } = this.canvas;
    const presentation = line.state.cgPresentation ?? { fit: 'contain', hideCharacters: false, hideTextbox: false, motion: 'none', duration: 0.6 };
    const baseScale = presentation.fit === 'cover'
      ? Math.max(width / image.naturalWidth, height / image.naturalHeight)
      : Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const presentationJson = JSON.stringify(presentation);
    const elapsed = this.elapsedSince(`cg:${ref}:${presentationJson}`, line, localTime, other => other.state.cg === ref && JSON.stringify(other.state.cgPresentation) === presentationJson);
    const t = clamp(elapsed / Math.max(0.05, Number(presentation.duration) || 0.6), 0, 1);
    const eased = replayEase('sigmoid', t);
    const motionScale = presentation.motion === 'slow-push' ? 1 + eased * 0.045 : 1;
    const dw = image.naturalWidth * baseScale * motionScale;
    const dh = image.naturalHeight * baseScale * motionScale;
    const pan = presentation.motion === 'pan-left' ? (1 - eased) * width * 0.035 : presentation.motion === 'pan-right' ? -(1 - eased) * width * 0.035 : 0;
    this.ctx.save();
    if (presentation.fit === 'contain') { this.ctx.fillStyle = 'rgba(0,0,0,.24)'; this.ctx.fillRect(0, 0, width, height); }
    this.ctx.globalAlpha = 0.2 + 0.8 * eased;
    this.ctx.drawImage(image, (width - dw) / 2 + pan, (height - dh) / 2, dw, dh);
    this.ctx.restore();
  }

  private async drawCustomObjects(line: PerformanceLine, space: 'world' | 'screen' = 'world', localTime = 0): Promise<void> {
    const runtime = line.state.customObjects ?? {};
    const definitions = this.performance.customObjects ?? [];
    const { width, height } = this.canvas;
    const states = Object.values(runtime).map(state => {
      if (!state) return state;
      const override = this.customObjectOverrides.get(state.objectId);
      if (!override) return state;
      return {
        ...state,
        visible: override.visible ?? state.visible,
        stateId: Object.prototype.hasOwnProperty.call(override, 'stateId') ? (override.stateId ?? null) : state.stateId,
        transform: { ...state.transform, ...(override.transform ?? {}) }
      } as CustomObjectRuntimeState;
    }).filter(state => state?.visible);
    if (space === 'world' && line.sceneGraph?.projection === '2.5d') states.sort((a, b) => {
      const nodeA = line.sceneGraph?.nodes?.find(node => node.kind === 'custom-object' && node.objectId === a.objectId);
      const nodeB = line.sceneGraph?.nodes?.find(node => node.kind === 'custom-object' && node.objectId === b.objectId);
      const pa = projectStageTransform({ ...a.transform, depth: a.transform?.depth ?? nodeA?.depth ?? 0 }, '2.5d', line.cameraTransform);
      const pb = projectStageTransform({ ...b.transform, depth: b.transform?.depth ?? nodeB?.depth ?? 0 }, '2.5d', line.cameraTransform);
      return (pb.viewDepth ?? pb.depth) - (pa.viewDepth ?? pa.depth);
    });
    for (const state of states) {
      const graphNode = line.sceneGraph?.nodes?.find(node => node.kind === 'custom-object' && node.objectId === state.objectId);
      // 0.48 scene graphs place presentation objects in ScreenSpace by default.
      // Old pre-scene-graph Performance JSON falls back to the historical WorldSpace behavior.
      const nodeSpace = graphNode?.space ?? 'world';
      if (nodeSpace !== space) continue;
      const object = definitions.find(item => item.id === state.objectId);
      if (!object) continue;
      const visual = object.states.find(item => item.id === state.stateId) ?? object.states[0];
      if (!visual?.assetId) continue;
      const image = await this.image(visual.assetId);
      if (!image) continue;
      const transform = state.transform ?? object.transform ?? { x: 0.5, y: 0.5, scale: 0.6, rotation: 0 };
      const projected = space === 'world'
        ? projectStageTransform(transform, line.sceneGraph?.projection ?? 'flat', line.cameraTransform)
        : { x: transform.x, y: transform.y, scale: transform.scale, depth: transform.depth ?? 0 };
      const maxW = width * Math.max(0.08, Math.min(1.35, projected.scale));
      const maxH = height * Math.max(0.08, Math.min(1.35, projected.scale));
      const scale = Math.min(maxW / image.naturalWidth, maxH / image.naturalHeight);
      const dw = image.naturalWidth * scale, dh = image.naturalHeight * scale;
      const cx = width * projected.x, cy = height * projected.y;
      const nodeFx = this.nodeEffects(line, graphNode?.id ?? `custom-object:${state.objectId}`, graphNode?.layerId ?? 'screen.presentation');
      await this.withEffects(nodeFx.effects, async () => {
        this.ctx.save();
        this.ctx.translate(cx, cy);
        this.ctx.rotate((Number(transform.rotation) || 0) * Math.PI / 180);
        this.ctx.shadowColor = 'rgba(0,0,0,.35)'; this.ctx.shadowBlur = 22;
        this.ctx.drawImage(image, -dw / 2, -dh / 2, dw, dh);
        this.ctx.restore();
        if (space === 'screen') {
          this.customObjectHitRegions.push({
            objectId: state.objectId,
            stateId: state.stateId ?? null,
            x: cx - dw / 2,
            y: cy - dh / 2,
            width: dw,
            height: dh,
            rotation: Number(transform.rotation) || 0,
            hotspots: (object.hotspots ?? []).map(hotspot => ({ ...hotspot }))
          });
        }
      }, line, localTime, nodeFx.ambient);
    }
  }

  private drawStructuredDice(line: PerformanceLine, localTime: number): void {
    const { width, height } = this.canvas;
    const rolls = line.diceRolls.slice(0, 4);
    if (!rolls.length) return;
    const panelW = width * 0.82;
    const panelH = Math.min(height * 0.46, 170 + rolls.length * 66);
    const x = (width - panelW) / 2;
    const y = (height - panelH) / 2;
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(9,11,16,.92)'; roundRect(this.ctx, x, y, panelW, panelH, 22); this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(255,255,255,.13)'; this.ctx.lineWidth = 1.5; this.ctx.stroke();
    this.ctx.fillStyle = '#f7d895'; this.ctx.font = '800 18px system-ui'; this.ctx.textAlign = 'left'; this.ctx.textBaseline = 'middle'; this.ctx.fillText('DICE', x + 26, y + 30);
    const settle = clamp((localTime - line.duration * 0.24) / Math.max(0.15, line.duration * 0.38), 0, 1);
    rolls.forEach((roll, i) => {
      const rowY = y + 66 + i * 66;
      const rolling = settle < 1;
      const pseudo = 1 + ((hashString(`${roll.label}:${i}`) + Math.floor(localTime * 24) * 17) % Math.max(1, roll.sides));
      const shown = rolling ? pseudo : roll.result;
      const success = roll.check == null ? null : roll.result <= roll.check;
      this.ctx.fillStyle = 'rgba(255,255,255,.055)'; roundRect(this.ctx, x + 20, rowY - 24, panelW - 40, 52, 12); this.ctx.fill();
      this.ctx.fillStyle = '#e9edf6'; this.ctx.font = '600 17px system-ui'; this.ctx.textAlign = 'left'; this.ctx.fillText(roll.label || `d${roll.sides}`, x + 36, rowY + 1);
      this.ctx.fillStyle = success == null ? '#f4d18b' : success ? '#9fd0ff' : '#ef8a8a';
      this.ctx.font = '900 30px ui-monospace,monospace'; this.ctx.textAlign = 'right';
      this.ctx.fillText(String(shown), x + panelW - 42, rowY + 1);
      this.ctx.font = '600 14px ui-monospace,monospace'; this.ctx.fillStyle = 'rgba(255,255,255,.58)';
      this.ctx.fillText(roll.check == null ? `d${roll.sides}` : `/ ${roll.check} · d${roll.sides}`, x + panelW - 42, rowY + 24);
    });
    this.ctx.restore();
  }


  private drawWheelStep(step: WheelStep, localTime: number, stepDuration: number, stepIndex: number, stepCount: number): void {
    const { width, height } = this.canvas;
    const options = step.options.filter(option => option.weight > 0);
    if (!options.length) return;
    const total = options.reduce((sum, option) => sum + option.weight, 0) || 1;
    const resultIndex = Math.max(0, options.findIndex(option => option.id === step.resultId || option.label === step.resultLabel));
    let cursor = -Math.PI / 2;
    let resultCenter = -Math.PI / 2;
    options.forEach((option, index) => {
      const sweep = option.weight / total * Math.PI * 2;
      if (index === resultIndex) resultCenter = cursor + sweep / 2;
      cursor += sweep;
    });
    const targetDeltaRaw = -Math.PI / 2 - resultCenter;
    const targetDelta = ((targetDeltaRaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const progress = clamp(localTime / Math.max(0.01, stepDuration), 0, 1);
    const spinProgress = replayEase('quadraticR', clamp(progress / 0.82, 0, 1));
    const turns = 5 + (hashString(`${step.title}:${step.resultLabel}`) % 3);
    const rotation = (turns * Math.PI * 2 + targetDelta) * spinProgress;

    const radius = Math.min(width * 0.255, height * 0.33);
    const cx = width / 2, cy = height * 0.47;
    const panelW = radius * 2 + width * 0.15, panelH = Math.min(height * 0.82, radius * 2 + 155);
    const panelX = (width - panelW) / 2, panelY = Math.max(18, cy - radius - 58);
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(8,10,15,.91)'; roundRect(this.ctx, panelX, panelY, panelW, panelH, 24); this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(255,255,255,.14)'; this.ctx.lineWidth = 1.5; this.ctx.stroke();
    this.ctx.fillStyle = '#eef2fb'; this.ctx.font = '800 20px system-ui'; this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle';
    this.ctx.fillText(step.title || '转盘', cx, panelY + 30);
    if (stepCount > 1) {
      this.ctx.fillStyle = 'rgba(255,255,255,.55)'; this.ctx.font = '600 13px system-ui';
      this.ctx.fillText(`${stepIndex + 1} / ${stepCount}`, cx, panelY + 53);
    }

    cursor = -Math.PI / 2 + rotation;
    options.forEach((option, index) => {
      const sweep = option.weight / total * Math.PI * 2;
      this.ctx.beginPath(); this.ctx.moveTo(cx, cy); this.ctx.arc(cx, cy, radius, cursor, cursor + sweep); this.ctx.closePath();
      const hue = (hashString(option.id || option.label) % 300) + 20;
      this.ctx.fillStyle = `hsl(${hue} 68% 67%)`; this.ctx.fill();
      this.ctx.strokeStyle = 'rgba(9,12,18,.72)'; this.ctx.lineWidth = 3; this.ctx.stroke();
      const mid = cursor + sweep / 2;
      if (sweep > 0.18) {
        const tx = cx + Math.cos(mid) * radius * 0.66, ty = cy + Math.sin(mid) * radius * 0.66;
        this.ctx.save(); this.ctx.translate(tx, ty); let angle = mid + Math.PI / 2; if (Math.cos(mid) < 0) angle += Math.PI; this.ctx.rotate(angle);
        this.ctx.fillStyle = '#10131b'; this.ctx.font = `800 ${Math.max(11, Math.min(17, radius * 0.07))}px system-ui`; this.ctx.textAlign = 'center';
        const label = option.label.length > 10 ? `${option.label.slice(0, 9)}…` : option.label;
        this.ctx.fillText(label, 0, 0); this.ctx.restore();
      }
      cursor += sweep;
    });
    this.ctx.beginPath(); this.ctx.arc(cx, cy, radius, 0, Math.PI * 2); this.ctx.strokeStyle = 'rgba(255,255,255,.88)'; this.ctx.lineWidth = 7; this.ctx.stroke();
    this.ctx.beginPath(); this.ctx.moveTo(cx - 15, cy - radius - 12); this.ctx.lineTo(cx + 15, cy - radius - 12); this.ctx.lineTo(cx, cy - radius + 20); this.ctx.closePath(); this.ctx.fillStyle = '#fff'; this.ctx.fill();
    this.ctx.beginPath(); this.ctx.arc(cx, cy, Math.max(26, radius * 0.12), 0, Math.PI * 2); this.ctx.fillStyle = '#121722'; this.ctx.fill(); this.ctx.strokeStyle = 'rgba(255,255,255,.5)'; this.ctx.lineWidth = 3; this.ctx.stroke();

    const settled = progress >= 0.82;
    this.ctx.fillStyle = settled ? '#f8dc94' : 'rgba(255,255,255,.62)'; this.ctx.font = settled ? '900 24px system-ui' : '700 17px system-ui'; this.ctx.textAlign = 'center';
    this.ctx.fillText(settled ? step.resultLabel : '转盘中…', cx, panelY + panelH - 48);
    if (step.note) { this.ctx.fillStyle = 'rgba(255,255,255,.45)'; this.ctx.font = '500 12px system-ui'; this.ctx.fillText(step.note.slice(0, 64), cx, panelY + panelH - 22); }
    this.ctx.restore();
  }

  private drawWheelEvent(line: PerformanceLine, localTime: number): void {
    const event = line.wheel;
    if (!event?.steps.length) return;
    const perStep = line.duration / event.steps.length;
    const stepIndex = Math.min(event.steps.length - 1, Math.max(0, Math.floor(localTime / Math.max(0.01, perStep))));
    const local = Math.max(0, localTime - stepIndex * perStep);
    this.drawWheelStep(event.steps[stepIndex]!, local, perStep, stepIndex, event.steps.length);
  }

  private drawHitPoint(line: PerformanceLine, localTime: number): void {
    const hp = line.hitPoint;
    if (!hp) return;
    const { width, height } = this.canvas;
    const w = width * 0.66, h = height * 0.25;
    const x = (width - w) / 2, y = (height - h) / 2;
    const p = replayEase('sincurve', clamp(localTime / Math.max(0.2, line.duration * 0.62), 0, 1));
    const value = hp.before + (hp.after - hp.before) * p;
    const ratio = clamp(value / Math.max(1, hp.max), 0, 1);
    const loss = hp.after < hp.before;
    this.ctx.save();
    this.ctx.fillStyle = 'rgba(9,11,16,.92)'; roundRect(this.ctx, x, y, w, h, 22); this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(255,255,255,.13)'; this.ctx.lineWidth = 1.5; this.ctx.stroke();
    this.ctx.fillStyle = '#f2f4fa'; this.ctx.font = '800 22px system-ui'; this.ctx.textAlign = 'left'; this.ctx.textBaseline = 'middle'; this.ctx.fillText(hp.label || 'HP', x + 30, y + 42);
    this.ctx.fillStyle = loss ? '#ef8a8a' : '#77f0b6'; this.ctx.font = '900 34px ui-monospace,monospace'; this.ctx.textAlign = 'right'; this.ctx.fillText(`${Math.round(value)} / ${hp.max}`, x + w - 30, y + 42);
    const bx = x + 30, by = y + h * 0.60, bw = w - 60, bh = 24;
    this.ctx.fillStyle = 'rgba(255,255,255,.10)'; roundRect(this.ctx, bx, by, bw, bh, 12); this.ctx.fill();
    this.ctx.fillStyle = ratio > 0.5 ? '#7ed6a5' : ratio > 0.2 ? '#f0bf72' : '#ef7c7c'; roundRect(this.ctx, bx, by, bw * ratio, bh, 12); this.ctx.fill();
    this.ctx.fillStyle = 'rgba(255,255,255,.55)'; this.ctx.font = '600 14px system-ui'; this.ctx.textAlign = 'left'; this.ctx.fillText(`${hp.before} → ${hp.after}`, bx, by + 46);
    this.ctx.restore();
  }

  private mediaDefinition(id: string | null | undefined): ReplayMediaDefinition | undefined {
    if (!id) return undefined;
    return this.performance.mediaDefinitions?.find(def => def.id === id || def.name === id);
  }

  private textStyle(id: string | null | undefined): ReplayTextDefinition | undefined {
    const def = this.mediaDefinition(id);
    return def?.type === 'text' || def?.type === 'richtext' ? def : undefined;
  }

  private applyTextStyle(style: ReplayTextDefinition | undefined, fallbackSize: number, fallbackColor = '#f4f6fb'): { lineHeight: number } {
    const sx = this.canvas.width / 1920;
    const size = Math.max(13, (style?.fontSize ?? fallbackSize) * sx);
    const family = style?.fontFamily && !style.fontFamily.includes('/') && !style.fontFamily.includes('\\') ? style.fontFamily : 'system-ui';
    this.ctx.font = `500 ${Math.round(size)}px ${family}`;
    this.ctx.fillStyle = style?.color ?? fallbackColor;
    this.ctx.textBaseline = 'top';
    this.ctx.textAlign = style?.align ?? 'left';
    this.ctx.lineWidth = Math.max(1, (style?.strokeWidth ?? 0) * sx);
    this.ctx.strokeStyle = style?.strokeColor ?? 'transparent';
    return { lineHeight: size * (style?.lineHeight ?? 1.3) };
  }

  private imageDefinition(id: string | null | undefined): ReplayImageDefinition | undefined {
    const def = this.mediaDefinition(id);
    return def?.type === 'image' ? def : undefined;
  }

  private dynamicBubbleSize(def: ReplayBubbleDefinition, main: string, style: ReplayTextDefinition | undefined, bg: HTMLImageElement | null): { width:number; height:number; left:number; top:number; right:number; bottom:number } {
    const baseW = bg?.naturalWidth || def.width || 760;
    const baseH = bg?.naturalHeight || def.height || 240;
    if (def.type !== 'dynamic-bubble') return { width:def.width || baseW, height:def.height || baseH, left:0, top:0, right:0, bottom:0 };
    const left = Math.max(0, def.mainTextX || 0);
    const top = Math.max(0, def.mainTextY || 0);
    const centerEndX = Math.max(left + 1, def.mainTextEndX ?? Math.min(baseW, left + 40));
    const centerEndY = Math.max(top + 1, def.mainTextEndY ?? Math.min(baseH, top + 40));
    const right = Math.max(0, baseW - centerEndX);
    const bottom = Math.max(0, baseH - centerEndY);
    const font = Math.max(8, style?.fontSize ?? 40);
    const limit = Math.max(1, style?.maxCharsPerLine ?? 20);
    const lines: string[] = [];
    for (const explicit of String(main || ' ').split(/\n|\[#\]|\[p\]|\[n\]|\[r\]/i)) {
      const chars = Array.from(explicit.replace(/\[[^\]]+\]/g, '　'));
      if (!chars.length) lines.push(' ');
      for (let i=0;i<chars.length;i+=limit) lines.push(chars.slice(i,i+limit).join(''));
    }
    const measured = Math.max(1, ...lines.map(line => Math.max(font, Array.from(line).length * font * 0.62)));
    const lineHeight = font * (def.lineDistance || style?.lineHeight || 1.3);
    const measuredH = Math.max(font, lines.length * lineHeight);
    const sourceCenterW = Math.max(1, centerEndX - left);
    const sourceCenterH = Math.max(1, centerEndY - top);
    const fit = def.fitAxis ?? 'free';
    const centerW = fit === 'vertical' ? sourceCenterW : measured;
    const centerH = fit === 'horizontal' ? sourceCenterH : measuredH;
    return { width:left + centerW + right, height:top + centerH + bottom, left, top, right, bottom };
  }

  private drawNineSlice(image: HTMLImageElement, x:number, y:number, w:number, h:number, left:number, top:number, right:number, bottom:number, fillMode:string|null|undefined): void {
    const sw=image.naturalWidth, sh=image.naturalHeight;
    const sx=[0,left,sw-right,sw], sy=[0,top,sh-bottom,sh];
    const dx=[x,x+left,x+w-right,x+w], dy=[y,y+top,y+h-bottom,y+h];
    const tile=(sX:number,sY:number,sW:number,sH:number,dX:number,dY:number,dW:number,dH:number)=>{
      if(sW<=0||sH<=0||dW<=0||dH<=0)return;
      if(fillMode!=='collage'){this.ctx.drawImage(image,sX,sY,sW,sH,dX,dY,dW,dH);return;}
      this.ctx.save();this.ctx.beginPath();this.ctx.rect(dX,dY,dW,dH);this.ctx.clip();
      for(let yy=dY;yy<dY+dH;yy+=sH)for(let xx=dX;xx<dX+dW;xx+=sW){
        const ww=Math.min(sW,dX+dW-xx), hh=Math.min(sH,dY+dH-yy);
        this.ctx.drawImage(image,sX,sY,ww,hh,xx,yy,ww,hh);
      }
      this.ctx.restore();
    };
    for(let col=0;col<3;col++)for(let row=0;row<3;row++)tile(sx[col]!,sy[row]!,sx[col+1]!-sx[col]!,sy[row+1]!-sy[row]!,dx[col]!,dy[row]!,dx[col+1]!-dx[col]!,dy[row+1]!-dy[row]!);
  }

  private async drawRichText(style: ReplayTextDefinition, text:string, x:number, y:number, maxWidth:number, lineHeight:number, maxLines:number, align:CanvasTextAlign): Promise<void> {
    type Token={kind:'text';value:string;bold:boolean;italic:boolean;underline:boolean;strike:boolean;fontSize:number;color:string;background:string|null}|{kind:'icon';ref:string;size:number};
    const lines: Token[][]=[[]]; let lineWidth=0; const widths=[0];
    const state={bold:false,italic:false,underline:false,strike:false,fontSize:style.fontSize,color:style.color,background:null as string|null};
    const measure=(token:Token)=>{if(token.kind==='icon')return token.size;this.ctx.font=`${token.italic?'italic ':''}${token.bold?'700':'500'} ${Math.max(8,token.fontSize)}px system-ui`;return this.ctx.measureText(token.value).width;};
    const newline=()=>{if(lines.length<maxLines){lines.push([]);widths.push(0);lineWidth=0;}};
    let full=false;const push=(token:Token)=>{if(full)return;const width=measure(token);if(lineWidth+width>maxWidth&&lineWidth>0){if(lines.length>=maxLines){full=true;return;}newline();}lines.at(-1)!.push(token);lineWidth+=width;widths[widths.length-1]=lineWidth;};
    const pattern=/\[([^\]]+)\]/g; let last=0, match:RegExpExecArray|null;
    const addPlain=(value:string)=>{for(const ch of Array.from(value)){if(ch==='\n'){newline();continue;}push({kind:'text',value:ch,bold:state.bold,italic:state.italic,underline:state.underline,strike:state.strike,fontSize:state.fontSize,color:state.color,background:state.background});}};
    while((match=pattern.exec(text))){addPlain(text.slice(last,match.index));const tag=match[1]!;last=match.index+match[0].length;
      if(['#','p','n','r'].includes(tag)){newline();continue;}
      if(tag==='^')continue;
      if(style.iconMap?.[tag]){push({kind:'icon',ref:style.iconMap[tag]!,size:style.fontSize});continue;}
      const off=tag.startsWith('/');const body=off?tag.slice(1):tag;const [cmd,arg]=body.split(':');
      if(cmd==='a'){state.bold=state.italic=state.underline=state.strike=false;state.fontSize=style.fontSize;state.color=style.color;state.background=null;continue;}
      if(cmd==='b')state.bold=!off;else if(cmd==='i')state.italic=!off;else if(cmd==='u')state.underline=!off;else if(cmd==='x')state.strike=!off;else if(cmd==='fs')state.fontSize=off?style.fontSize:(Number(arg)||style.fontSize);else if(cmd==='fg')state.color=off?style.color:(arg||style.color);else if(cmd==='bg')state.background=off?null:(arg||null);
    }
    addPlain(text.slice(last));
    for(let li=0;li<Math.min(lines.length,maxLines);li++){
      const tokens=lines[li]!, total=widths[li]||0;let cx=align==='center'?x-total/2:align==='right'?x-total:x;
      for(const token of tokens){if(token.kind==='icon'){const img=await this.image(token.ref);if(img){const ih=token.size,iw=img.naturalWidth/img.naturalHeight*ih;this.ctx.drawImage(img,cx,y+li*lineHeight+(lineHeight-ih)/2,iw,ih);cx+=iw;}else cx+=token.size;continue;}
        this.ctx.font=`${token.italic?'italic ':''}${token.bold?'700':'500'} ${Math.max(8,token.fontSize)}px system-ui`;const tw=this.ctx.measureText(token.value).width;const ty=y+li*lineHeight;
        if(token.background){this.ctx.fillStyle=token.background;this.ctx.fillRect(cx,ty,tw,lineHeight);}this.ctx.fillStyle=token.color;if(style.strokeWidth&&style.strokeColor){this.ctx.strokeStyle=style.strokeColor;this.ctx.lineWidth=style.strokeWidth;this.ctx.strokeText(token.value,cx,ty);}this.ctx.fillText(token.value,cx,ty);
        if(token.underline||token.strike){this.ctx.strokeStyle=token.color;this.ctx.lineWidth=Math.max(1,token.fontSize/15);const yy=ty+(token.strike?token.fontSize*.52:token.fontSize*.95);this.ctx.beginPath();this.ctx.moveTo(cx,yy);this.ctx.lineTo(cx+tw,yy);this.ctx.stroke();}cx+=tw;
      }
    }
  }

  private headerValue(spec: {target?:string|null}, headerParts:string[], index:number, line?:PerformanceLine): string {
    const target=(spec.target||'Name').toLowerCase();
    if(target==='hitpoint'&&line?.hitPoint)return `${Math.round(line.hitPoint.after)}/${line.hitPoint.max}`;
    if(target==='name')return headerParts[0]??line?.speakerName??'';
    return headerParts[index]??headerParts[0]??'';
  }

  private async bubbleLayout(def: ReplayBubbleDefinition | undefined, main:string): Promise<{width:number;height:number;bg:HTMLImageElement|null;left:number;top:number;right:number;bottom:number}> {
    const bg=await this.image(def?.backgroundAssetId??def?.backgroundSource??null);
    if(!def)return {width:760,height:240,bg,left:0,top:0,right:0,bottom:0};
    const style=this.textStyle(def.mainTextStyleId);const dynamic=this.dynamicBubbleSize(def,main,style,bg);
    return {...dynamic,bg};
  }

  private async drawBubbleDefinition(
    def: ReplayBubbleDefinition | undefined,
    header: string,
    main: string,
    fallbackColor = '#8b7cf0',
    placement?: {x:number;y:number},
    line?: PerformanceLine
  ): Promise<{width:number;height:number}> {
    const { width, height } = this.canvas; const sx=width/1920, sy=height/1080;
    const layout=await this.bubbleLayout(def,main);const scale=def?.scale??1;
    const w=Math.max(width*.12,layout.width*sx*scale), h=Math.max(height*.07,layout.height*sy*scale);
    const x=placement?.x??(def?.x??160)*sx, y=placement?.y??(def?.y??660)*sy;
    this.ctx.save();
    if(layout.bg){this.ctx.globalAlpha=.96;if(def?.type==='dynamic-bubble')this.drawNineSlice(layout.bg,x,y,w,h,layout.left*sx*scale,layout.top*sy*scale,layout.right*sx*scale,layout.bottom*sy*scale,def.fillMode);else this.ctx.drawImage(layout.bg,x,y,w,h);}else{this.ctx.fillStyle='rgba(10,12,17,.90)';roundRect(this.ctx,x,y,w,h,Math.max(10,18*sx));this.ctx.fill();this.ctx.strokeStyle=`${fallbackColor}88`;this.ctx.lineWidth=Math.max(1,2*sx);this.ctx.stroke();}
    const mainStyle=this.textStyle(def?.mainTextStyleId);const headerParts=String(header||'').split('|');const headers=def?.headers?.length?def.headers:[{textStyleId:def?.headerTextStyleId,x:def?.headerTextX??40,y:def?.headerTextY??24,target:'Name',align:def?.headerAlign??'left'}];
    for(let i=0;i<headers.length;i++){const hd=headers[i]!,value=this.headerValue(hd,headerParts,i,line);if(!value)continue;const style=this.textStyle(hd.textStyleId);let hx=(hd.x??40),hy=(hd.y??24);if(def?.type==='dynamic-bubble'){if((def.mainTextEndX??Infinity)<hx)hx+=layout.width-(layout.left+Math.max(1,(def.mainTextEndX??layout.left+1)-layout.left)+layout.right);if((def.mainTextEndY??Infinity)<hy)hy+=layout.height-(layout.top+Math.max(1,(def.mainTextEndY??layout.top+1)-layout.top)+layout.bottom);}const px=x+hx*sx*scale,py=y+hy*sy*scale;this.applyTextStyle(style,34,'#fff');this.ctx.textAlign=hd.align??'left';if(style?.strokeWidth&&style.strokeColor)this.ctx.strokeText(value,px,py);this.ctx.fillText(value,px,py,Math.max(80,w-50*sx));}
    const mx=x+(def?.mainTextX??50)*sx*scale,my=y+(def?.mainTextY??88)*sy*scale;const styled=this.applyTextStyle(mainStyle,38,'#f4f6fb');const align=def?.align??mainStyle?.align??'left';const textX=align==='center'?x+w/2:align==='right'?x+w-40*sx:mx;const maxWidth=def?.type==='dynamic-bubble'?Math.max(20,w-(layout.left+layout.right)*sx*scale):Math.max(120,w-(mx-x)-45*sx);
    if(mainStyle?.type==='richtext')await this.drawRichText(mainStyle,main,textX,my,maxWidth,styled.lineHeight,def?.lineCountEstimate??8,align);else wrapText(this.ctx,main,textX,my,maxWidth,styled.lineHeight,def?.lineCountEstimate??5,align);
    this.ctx.restore();return {width:w,height:h};
  }

  private chatParticipant(def: ReplayChatWindowDefinition, speakerName:string): ReplayChatParticipantDefinition | undefined {
    return def.participants?.find(p=>p.key===speakerName)??def.participants?.find(p=>p.key.toLowerCase()===speakerName.toLowerCase());
  }

  private chatHistory(line:PerformanceLine,def:ReplayChatWindowDefinition):PerformanceLine[]{
    const idx=Math.max(0,line.index-1);const out:PerformanceLine[]=[];
    for(let i=idx;i>=0;i--){const item=this.performance.lines[i]!;const style=item.bubble?.definitionId??item.dialogueStyleId;if(style===def.id||style===def.name)out.push(item);if(item.chapterTitle||item.sceneTitle)break;}
    return out.reverse();
  }

  private async drawChatWindow(line:PerformanceLine,def:ReplayChatWindowDefinition,localTime:number,fallbackColor:string):Promise<void>{
    const {width,height}=this.canvas,sx=width/1920,sy=height/1080;const bg=await this.image(def.backgroundAssetId??def.backgroundSource??null);const x=def.x*sx,y=def.y*sy;const outerW=(bg?.naturalWidth??def.width??1920)*sx*(def.scale??1),outerH=(bg?.naturalHeight??def.height??1080)*sy*(def.scale??1);
    this.ctx.save();if(bg)this.ctx.drawImage(bg,x,y,outerW,outerH);else{this.ctx.fillStyle='rgba(12,16,24,.92)';roundRect(this.ctx,x,y,outerW,outerH,18*sx);this.ctx.fill();this.ctx.strokeStyle=`${fallbackColor}88`;this.ctx.stroke();}this.ctx.restore();
    const subX=x+(def.subX??40)*sx,subY=y+(def.subY??40)*sy,subW=(def.subWidth??(def.width??1200))*sx,subH=(def.subHeight??(def.height??600))*sy;let bottom=subY+subH;const history=this.chatHistory(line,def);
    for(let hidx=history.length-1;hidx>=0;hidx--){const item=history[hidx]!;const participant=this.chatParticipant(def,item.speakerName);const bdefRaw=this.mediaDefinition(participant?.bubbleDefinitionId);const bdef=bdefRaw&&['bubble','dynamic-bubble'].includes(bdefRaw.type)?bdefRaw as ReplayBubbleDefinition:undefined;const isCurrent=item.lineId===line.lineId;const main=isCurrent?revealText({...item,text:item.bubble?.mainText??item.text,textEffect:item.bubble?.textEffect??item.textEffect,textEffectDuration:item.bubble?.textEffectDuration??item.textEffectDuration},localTime):(item.bubble?.mainText??item.text);const head=item.bubble?.headerText||item.speakerName;const layout=await this.bubbleLayout(bdef,main);const bw=Math.min(subW,Math.max(180,layout.width*sx*(bdef?.scale??1))),bh=Math.max(70,layout.height*sy*(bdef?.scale??1));bottom-=bh;if(bottom<subY)break;const align=participant?.align??'left';const bx=align==='right'?subX+subW-bw:subX;await this.drawBubbleDefinition(bdef,head,main,this.character(item.speakerId)?.color||fallbackColor,{x:bx,y:bottom},item);
      const avatar=this.imageDefinition(participant?.avatarDefinitionId);if(avatar){const img=await this.image(avatar.assetId??avatar.source??null);if(img){const ah=Math.min(bh,img.naturalHeight*sy*(avatar.scale||1)),aw=img.naturalWidth/img.naturalHeight*ah;const ax=align==='right'?x+(def.avatarRight??1910)*sx-aw:x+(def.avatarLeft??10)*sx;this.ctx.drawImage(img,ax,bottom+bh-ah,aw,ah);}}
      bottom-=Math.max(0,def.messageGap)*sy;
    }
  }

  private async drawBubbleEvent(line: PerformanceLine, localTime: number): Promise<boolean> {
    if (!line.bubble && !line.dialogueStyleId) return false;
    const event = line.bubble; const def = this.mediaDefinition(event?.definitionId ?? line.dialogueStyleId); const rawMain=event?.mainText??line.text;const speaker=this.character(line.speakerId);const color=speaker?.color||'#8b7cf0';
    if(def?.type==='chat-window'){await this.drawChatWindow(line,def,localTime,color);return true;}
    const bubbleDef=def&&['bubble','balloon','dynamic-bubble'].includes(def.type)?def as ReplayBubbleDefinition:undefined;const effectLine={text:rawMain,textEffect:event?.textEffect??line.textEffect,textEffectDuration:event?.textEffectDuration??line.textEffectDuration,duration:line.duration};const main=revealText(effectLine,localTime);const header=event?.headerText||(line.type==='dialogue'?line.speakerName:'');await this.drawBubbleDefinition(bubbleDef,header,main,color,undefined,line);return true;
  }

  /** Shrinks to fit the whole line (sized from the full text so typing effects don't resize), then ellipsizes. */
  private drawFittedText(displayText: string, fullText: string, x: number, y: number, maxWidth: number, maxHeight: number, baseSize: number, minSize: number, ratio: number, align: CanvasTextAlign, weight = ''): void {
    let size = baseSize, fullLines = 0;
    for (;; size -= 1) {
      this.ctx.font = `${weight} ${size}px system-ui`.trim();
      fullLines = wrapTextLines(this.ctx, fullText, maxWidth).length;
      if (fullLines * size * ratio <= maxHeight || size <= minSize) break;
    }
    const lineHeight = size * ratio, maxLines = Math.max(1, Math.floor(maxHeight / lineHeight));
    const lines = wrapTextLines(this.ctx, displayText, maxWidth);
    const shown = lines.slice(0, maxLines);
    if (fullLines > maxLines && lines.length >= maxLines) shown[maxLines - 1] = `${Array.from(shown[maxLines - 1]!).slice(0, -1).join('')}…`;
    this.ctx.textAlign = align;
    shown.forEach((value, index) => this.ctx.fillText(value, x, y + index * lineHeight));
  }

  private drawSceneBanner(line: PerformanceLine, localTime: number): void {
    if (!line.sceneTitle) return;
    const alpha = Math.min(clamp(localTime / 0.25, 0, 1), clamp((2.9 - localTime) / 0.5, 0, 1));
    if (alpha <= 0) return;
    const { width, height } = this.canvas;
    const size = Math.round(Math.max(20, width * 0.02)), x = width * 0.045, y = height * 0.06;
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.font = `700 ${size}px system-ui`;
    this.ctx.textAlign = 'left'; this.ctx.textBaseline = 'middle';
    const textWidth = this.ctx.measureText(line.sceneTitle).width, h = size * 2.1;
    this.ctx.fillStyle = 'rgba(8,10,15,.74)'; roundRect(this.ctx, x, y, textWidth + size * 2.2, h, h / 2); this.ctx.fill();
    this.ctx.fillStyle = '#f2f4fa'; this.ctx.fillText(line.sceneTitle, x + size * 1.1, y + h / 2);
    this.ctx.restore();
  }

  private async drawDialogueAndBanner(line: PerformanceLine, progress: number, localTime: number): Promise<void> {
    await this.drawDialogue(line, progress, localTime);
    this.drawSceneBanner(line, localTime);
  }

  private async drawDialogue(line: PerformanceLine, progress: number, localTime: number): Promise<void> {
    if (line.type === 'command') return;
    const displayText = revealText(line, localTime);
    const { width, height } = this.canvas;
    const speaker = this.character(line.speakerId);
    if (line.type === 'bubble' || line.dialogueStyleId) { if (await this.drawBubbleEvent(line, localTime)) return; }
    if (line.type === 'wheel' && line.wheel) { this.drawWheelEvent(line, localTime); return; }
    if (line.type === 'hitpoint' && line.hitPoint) { this.drawHitPoint(line, localTime); return; }
    if (line.type === 'dice' && line.diceRolls.length) { this.drawStructuredDice(line, localTime); return; }
    if (line.type === 'system' || line.type === 'narration') {
      const x = width * 0.16, y = height * 0.34, w = width * 0.68, h = height * 0.26;
      this.ctx.fillStyle = 'rgba(10,12,17,.84)'; roundRect(this.ctx, x, y, w, h, 18); this.ctx.fill();
      this.ctx.strokeStyle = 'rgba(255,255,255,.13)'; this.ctx.stroke();
      this.ctx.fillStyle = '#e5eaf4'; this.ctx.font = `${Math.max(20, width * 0.019)}px system-ui`; this.ctx.textBaseline = 'top';
      this.drawFittedText(displayText, line.text, width / 2, y + h * 0.22, w * 0.82, h * 0.72, Math.round(Math.max(20, width * 0.019)), Math.round(width * 0.0125), 1.39, 'center');
      return;
    }
    const margin = width * 0.055;
    const boxWidth = width - margin * 2;
    const boxHeight = line.type === 'dice' ? height * 0.27 : height * 0.28;
    const x = margin, y = height - boxHeight - margin * 0.58;
    const accent = speaker?.color || '#8b7cf0';
    this.ctx.fillStyle = 'rgba(10,12,17,.89)'; roundRect(this.ctx, x, y, boxWidth, boxHeight, 18); this.ctx.fill();
    this.ctx.strokeStyle = 'rgba(255,255,255,.12)'; this.ctx.lineWidth = 1.5; this.ctx.stroke();
    this.ctx.font = '700 16px system-ui';
    const nameWidth = Math.min(230, Math.max(110, this.ctx.measureText(speaker?.name || line.speakerName).width + 36));
    this.ctx.fillStyle = accent; roundRect(this.ctx, x + 16, y - 17, nameWidth, 34, 9); this.ctx.fill();
    this.ctx.fillStyle = '#fff'; this.ctx.font = '700 16px system-ui'; this.ctx.textAlign = 'left'; this.ctx.textBaseline = 'middle'; this.ctx.fillText(speaker?.name || line.speakerName, x + 30, y);
    if (line.type === 'dice') {
      const meta = parseDiceText(line.text) ?? {};
      this.ctx.fillStyle = 'rgba(240,185,91,.12)'; roundRect(this.ctx, x + 20, y + 34, boxWidth - 40, boxHeight - 58, 12); this.ctx.fill();
      if (meta.expression) { this.ctx.fillStyle = '#f7d895'; this.ctx.font = '700 18px ui-monospace,monospace'; this.ctx.textBaseline = 'top'; this.ctx.fillText(meta.expression, x + 34, y + 46); }
      if (meta.result && meta.target) { this.ctx.fillStyle = outcomeColor(meta.outcome); this.ctx.font = '800 34px ui-monospace,monospace'; this.ctx.textAlign = 'right'; this.ctx.fillText(`${meta.result} / ${meta.target}`, x + boxWidth - 34, y + 42); }
      this.ctx.fillStyle = '#f4f6fb'; this.ctx.font = '500 18px system-ui'; this.ctx.textAlign = 'left'; this.ctx.textBaseline = 'bottom'; wrapText(this.ctx, displayText, x + 34, y + boxHeight - 52, boxWidth - 68, 26, 2, 'left');
    } else {
      this.ctx.fillStyle = '#f4f6fb'; this.ctx.textBaseline = 'top'; this.drawFittedText(displayText, line.text, x + 28, y + 40, boxWidth - 56, boxHeight - 58, Math.round(width * 23 / 1280), Math.round(width * 15 / 1280), 1.43, 'left', '500');
    }
    this.ctx.fillStyle = 'rgba(255,255,255,.12)'; roundRect(this.ctx, x + 20, y + boxHeight - 14, boxWidth - 40, 4, 2); this.ctx.fill();
    this.ctx.fillStyle = accent; roundRect(this.ctx, x + 20, y + boxHeight - 14, (boxWidth - 40) * clamp(progress, 0, 1), 4, 2); this.ctx.fill();
  }

  private async renderLineContent(index: number, localTime = 0): Promise<void> {
    const line = this.performance.lines[index];
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.fillStyle = this.performance.settings.bgColor || '#171924';
    this.ctx.fillRect(0, 0, width, height);
    if (!line) return;
    const progress = clamp(localTime / Math.max(0.001, line.duration), 0, 1);
    const cameraProgress = replayEase(line.cameraCurve, progress);
    const framing = line.cameraTransform ?? { x: 0.5, y: 0.5, zoom: 1 };
    const pushZoom = line.camera === 'push' ? 1 + Math.min(0.07, cameraProgress * 0.07) : 1;
    const finalZoom = clamp((Number(framing.zoom) || 1) * pushZoom, 1, 4.5);
    const shakeAmp = line.camera === 'shake' ? 7 * (1 - cameraProgress) : 0;

    const drawWorld = async () => {
      // Camera framing transforms WorldSpace while dialogue/presentation remain ScreenSpace.
      this.ctx.save();
      if (shakeAmp) this.ctx.translate(Math.sin(localTime * 42) * shakeAmp, Math.cos(localTime * 35) * shakeAmp * 0.65);
      this.ctx.translate(width / 2, height / 2);
      this.ctx.scale(finalZoom, finalZoom);
      this.ctx.translate(-width * clamp(Number(framing.x), 0, 1), -height * clamp(Number(framing.y), 0, 1));

      const bgFx = this.nodeEffects(line, 'background', 'world.background');
      await this.withEffects(bgFx.effects, () => this.drawBackground(index, line, localTime), line, localTime, bgFx.ambient);

      const cgFx = this.nodeEffects(line, 'cg', 'world.cg');
      await this.withEffects(cgFx.effects, () => this.drawCg(line.state.cg, line, localTime), line, localTime, cgFx.ambient);

      const frontFx = this.nodeEffects(line, 'fx:world-gradient', 'world.front-fx');
      await this.withEffects(frontFx.effects, () => {
        const gradient = this.ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, 'rgba(5,6,9,.04)'); gradient.addColorStop(1, 'rgba(5,6,9,.58)');
        this.ctx.fillStyle = gradient; this.ctx.fillRect(0, 0, width, height);
      }, line, localTime, frontFx.ambient);

      const stageEntries = line.stage.map((actor, actorIndex) => ({ actor, actorIndex }));
      if (line.sceneGraph?.projection === '2.5d') stageEntries.sort((a, b) => {
        const depth = (entry: typeof a) => {
          const rect = stageRect(entry.actor.position, line.stage.length, width, height, entry.actorIndex, line.stage.map(item => item.position));
          const p = projectStageTransform({ x: rect.cx / width, y: rect.floor / height, scale: 1, ...entry.actor.transform }, '2.5d', framing);
          return p.viewDepth ?? p.depth;
        };
        const depthA = depth(a), depthB = depth(b);
        return depthB - depthA || a.actorIndex - b.actorIndex;
      });
      if (!(line.state.cg && line.state.cgPresentation?.hideCharacters)) for (const { actor, actorIndex } of stageEntries) {
        const sourceCharacter = this.character(actor.characterId);
        if (!sourceCharacter) continue;
        const character = characterForStageFacing(sourceCharacter, actor);
        const actorFx = this.nodeEffects(line, `character:${actor.characterId}`, 'world.characters');
        await this.withEffects(actorFx.effects, async () => {
          const isCurrent = actor.active;
          const stageMotion = actor.motion ? evaluateRplGenMotion(actor.motion, localTime, line.duration, { width, height }, line.cameraCurve)
            : isCurrent ? evaluateRplGenMotion(line.stageMethod, localTime, line.duration, { width, height }, line.cameraCurve)
            : { alpha: 1, dx: 0, dy: 0, dz: 0 };
          const baseRect = stageRect(actor.position, line.stage.length, width, height, actorIndex, line.stage.map(item => item.position));
          const authoredTransform = actor.transform ?? { x: baseRect.cx / width, y: baseRect.floor / height, scale: 1, depth: 0 };
          const motionTransform = stageMotion.dz
            ? { ...authoredTransform, depth: clamp((Number(authoredTransform.depth) || 0) + stageMotion.dz, 0, 1) }
            : authoredTransform;
          const rect = transformedStageRect(baseRect, motionTransform, width, height, line.sceneGraph?.projection ?? 'flat', framing);
          let viseme: Viseme = 'SILENCE';
          if (isCurrent) {
            if (line.mouth === 'off') viseme = 'SILENCE';
            else {
              // Cues and audio share a clock that starts when the voice actually starts.
              const pre = Math.max(0, Number(line.audioMix?.preRoll) || 0), post = Math.max(0, Number(line.audioMix?.postRoll) || 0), offset = Number(line.audioMix?.voiceOffset) || 0;
              const voiceStart = line.audioAssetId ? pre + offset : 0;
              const mouthTime = localTime - voiceStart;
              const lead = (Number(this.performance.settings.mouthLeadMs) || 0) / 1000;
              if (line.mouthCues.length) viseme = mouthTime + lead < 0 ? 'SILENCE' : visemeAt(line.mouthCues, mouthTime, this.performance.settings.mouthLeadMs);
              else if (mouthTime >= 0) viseme = pseudoViseme(line.text, mouthTime, line.audioAssetId ? Math.max(0.05, line.duration - pre - post - Math.max(0, offset)) : line.duration);
            }
          }
          const blinking = blinkAt(character, localTime, isCurrent && OPEN_VISEMES.has(viseme), this.faceTemplateFor(character)?.layers);
          const selection = selectCharacterFrame(character, line.state.expressions[actor.characterId] ?? 'default', viseme, blinking);
          const layerSelection = selectCharacterLayers(character, line.state.expressions[actor.characterId] ?? 'default', viseme, blinking);
          const focusMode = this.performance.settings.dimOthers ? (this.performance.settings.speakerFocus ?? 'subtle') : 'none';
          let alpha = 1, focusScale = 1;
          if (focusMode === 'subtle') { alpha = isCurrent ? 1 : 0.78; focusScale = isCurrent ? 1.02 : 0.985; }
          else if (focusMode === 'strong') { alpha = isCurrent ? 1 : 0.48; focusScale = isCurrent ? 1.045 : 0.96; }
          if (line.camera === 'focus-speaker') { if (!isCurrent) alpha *= 0.52; else focusScale *= 1.08; }
          alpha *= stageMotion.alpha;
          this.ctx.save(); this.ctx.globalAlpha = alpha; this.ctx.translate(stageMotion.dx, stageMotion.dy);
          const expressionName = line.state.expressions[actor.characterId] ?? 'default';
          const hasLayerModel = Boolean(layerSelection.base || layerSelection.overlay || layerSelection.eyes || layerSelection.eyelids || layerSelection.pupils || layerSelection.brows || layerSelection.mouth);
          const mirror = shouldMirrorActor(character, actor);
          this.ctx.save();
          if (mirror) { this.ctx.translate(rect.cx * 2, 0); this.ctx.scale(-1, 1); }
          const layeredDrawn = hasLayerModel ? await this.drawLayeredActor(character, layerSelection, rect, focusScale, expressionName) : false;
          const image = layeredDrawn ? null : await this.image(selection.ref);
          if (image) {
            const geometry = this.puppetGeometry(character, image, rect, focusScale);
            const { dw, dh, x, y } = geometry;
            this.ctx.shadowColor = isCurrent ? 'rgba(0,0,0,.42)' : 'rgba(0,0,0,.24)'; this.ctx.shadowBlur = isCurrent ? 28 : 18;
            this.ctx.drawImage(image, x, y, dw, dh);
          } else if (!layeredDrawn) this.drawPlaceholderActor(character, rect, viseme, blinking, isCurrent);
          this.ctx.restore();
          if (this.performance.settings.showNameTags) {
            this.ctx.font = '700 14px system-ui'; const nameWidth = Math.max(74, this.ctx.measureText(character.name).width + 26), nameY = rect.floor - 26;
            this.ctx.fillStyle = 'rgba(10,12,17,.74)'; roundRect(this.ctx, rect.cx - nameWidth / 2, nameY, nameWidth, 26, 9); this.ctx.fill();
            this.ctx.strokeStyle = `${character.color || '#8b7cf0'}88`; this.ctx.stroke(); this.ctx.fillStyle = '#fff'; this.ctx.textAlign = 'center'; this.ctx.textBaseline = 'middle'; this.ctx.fillText(character.name, rect.cx, nameY + 13);
          }
          this.ctx.restore();
        }, line, localTime, actorFx.ambient);
      }
      await this.drawCustomObjects(line, 'world', localTime);
      this.ctx.restore();
    };

    await this.withEffects(line.sceneGraph?.worldEffects, drawWorld, line, localTime);
    await this.drawCustomObjects(line, 'screen', localTime);

    if (!(line.state.cg && line.state.cgPresentation?.hideTextbox)) {
      const presentationType = line.type === 'dice' ? ['system:dice','screen.presentation'] as const
        : line.type === 'wheel' ? ['system:wheel','screen.presentation'] as const
        : line.type === 'hitpoint' ? ['system:hitpoint','screen.presentation'] as const
        : ['ui:dialogue','screen.dialogue'] as const;
      const uiFx = this.nodeEffects(line, presentationType[0], presentationType[1]);
      await this.withEffects(uiFx.effects, () => this.drawDialogueAndBanner(line, progress, localTime), line, localTime, uiFx.ambient);
    }
    if (line.transition === 'fade' && localTime < 0.42) {
      const transitionFx = this.nodeEffects(line, 'fx:transition', 'screen.fx');
      await this.withEffects(transitionFx.effects, () => {
        this.ctx.save(); this.ctx.globalAlpha = 1 - replayEase(line.transitionCurve, clamp(localTime / 0.42, 0, 1)); this.ctx.fillStyle = '#000'; this.ctx.fillRect(0, 0, width, height); this.ctx.restore();
      }, line, localTime, transitionFx.ambient);
    }
  }

  /** Frames run one at a time and a superseded request is skipped, so a slow old frame can't cover a newer one. */
  renderLine(index: number, localTime = 0): Promise<void> {
    const ticket = ++this.renderTicket;
    const run = async (): Promise<void> => { if (ticket === this.renderTicket) await this.drawFrame(index, localTime); };
    const result = this.renderTail.then(run, run);
    this.renderTail = result.catch(() => {});
    return result;
  }

  private async drawFrame(index: number, localTime: number): Promise<void> {
    this.customObjectHitRegions = [];
    const line = this.performance.lines[index];
    const { width, height } = this.canvas;
    this.ctx.clearRect(0, 0, width, height);
    if (!line) {
      this.ctx.fillStyle = this.performance.settings.bgColor || '#171924'; this.ctx.fillRect(0, 0, width, height); return;
    }
    await this.withEffects(line.sceneGraph?.outputEffects, () => this.renderLineContent(index, localTime), line, localTime);
  }

  async renderAt(time: number): Promise<{ index: number; localTime: number } | null> {
    const located = locatePerformanceLine(this.performance, time);
    if (!located) return null;
    await this.renderLine(located.index, located.localTime);
    return { index: located.index, localTime: located.localTime };
  }
}
