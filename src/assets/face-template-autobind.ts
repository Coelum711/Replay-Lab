import type { CharacterLayerSet } from '../core/types.js';

export type FaceTemplateLayerSlot = keyof CharacterLayerSet;

export interface FaceTemplatePartGuess {
  path: string;
  slot: FaceTemplateLayerSlot | null;
  confidence: number;
  reason: string;
}

export interface FaceTemplateBindingPlanItem extends FaceTemplatePartGuess {
  conflict: boolean;
}

export interface FaceTemplateBindingPlan {
  items: FaceTemplateBindingPlanItem[];
  recognized: number;
  unknown: number;
  conflicts: number;
}


export interface FaceTemplateNamingExample {
  slot: FaceTemplateLayerSlot;
  label: string;
  examples: string[];
}

/**
 * User-facing naming examples. Keep these next to the classifier so Studio help
 * cannot silently drift away from the actual parser vocabulary.
 */
export const FACE_TEMPLATE_NAMING_EXAMPLES: FaceTemplateNamingExample[] = [
  { slot: 'eyesOpen', label: '双眼 · 睁开', examples: ['eyes_open.png', 'eyes/open.png', 'eyes.png'] },
  { slot: 'eyesClosed', label: '双眼 · 闭眼', examples: ['eyes_closed.png', 'eyes_blink.png', 'eyes/closed.png'] },
  { slot: 'eyeLeftOpen', label: '画面左眼 · 睁开', examples: ['eye_left_open.png', 'eyes/left/open.png', 'left_eye.png'] },
  { slot: 'eyeRightOpen', label: '画面右眼 · 睁开', examples: ['eye_right_open.png', 'eyes/right/open.png', 'right_eye.png'] },
  { slot: 'browLeft', label: '画面左眉', examples: ['brow_left.png', 'brows/left.png', '左眉.png'] },
  { slot: 'browRight', label: '画面右眉', examples: ['brow_right.png', 'brows/right.png', '右眉.png'] },
  { slot: 'pupils', label: '双瞳孔', examples: ['pupils.png', 'iris.png', '瞳孔.png'] },
  { slot: 'mouthClosed', label: '嘴 · 闭合', examples: ['mouth_closed.png', 'mouth_rest.png', 'mouth.png'] },
  { slot: 'mouthOpen', label: '嘴 · 张开', examples: ['mouth_open.png', 'mouth/open.png', '张嘴.png'] },
  { slot: 'mouthA', label: '嘴 A', examples: ['mouth_A.png', 'mouth/A.png'] },
  { slot: 'mouthAe', label: '嘴 æ', examples: ['mouth_AE.png', 'mouth/AE.png'] },
  { slot: 'mouthTh', label: '嘴 TH/DH', examples: ['mouth_th.png', 'mouth/TH.png'] }
];

function normalizedTokens(path: string): string[] {
  return path
    .replace(/\\/g, '/')
    .replace(/\.[^.\/]+$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\/_.\-\s]+/)
    .map(token => token.trim())
    .filter(Boolean);
}

function hasAny(tokens: string[], aliases: string[]): boolean {
  return aliases.some(alias => tokens.includes(alias) || (/[^\x00-\x7f]/.test(alias) && tokens.some(token => token.includes(alias))));
}

function sideOf(tokens: string[]): 'left' | 'right' | null {
  if (hasAny(tokens, ['left','lhs','l','左','左侧','画面左'])) return 'left';
  if (hasAny(tokens, ['right','rhs','r','右','右侧','画面右'])) return 'right';
  return null;
}

function stateOf(tokens: string[]): 'open' | 'closed' | null {
  if (hasAny(tokens, ['closed','close','blink','shut','闭','闭眼','合','闭合'])) return 'closed';
  if (hasAny(tokens, ['open','opened','睁','睁眼','开','张开'])) return 'open';
  return null;
}

function mouthViseme(tokens: string[]): FaceTemplateLayerSlot | null {
  const exact: Array<[string[], FaceTemplateLayerSlot]> = [
    [['schwa','ə'], 'mouthSchwa'],
    [['ae','æ'], 'mouthAe'],
    [['uu','ʊ'], 'mouthUu'],
    [['oo','ɔ'], 'mouthOo'],
    [['th','dh','θ','ð'], 'mouthTh'],
    [['fv','f-v','f','v'], 'mouthF'],
    [['mbp','m-b-p','m','b','p'], 'mouthM'],
    [['w'], 'mouthW'],
    [['a'], 'mouthA'],
    [['i'], 'mouthI'],
    [['u'], 'mouthU'],
    [['e'], 'mouthE'],
    [['o'], 'mouthO']
  ];
  for (const [aliases, slot] of exact) if (hasAny(tokens, aliases)) return slot;
  return null;
}

/**
 * Filename/path classifier for reusable Face Template art. Left/right are
 * screen-space. It deliberately returns null for uncertain files rather than
 * guessing a destructive binding.
 */
export function classifyFaceTemplatePartFilename(path: string): FaceTemplatePartGuess {
  const tokens = normalizedTokens(path);
  const side = sideOf(tokens);
  const state = stateOf(tokens);
  const eye = hasAny(tokens, ['eye','eyes','眼','眼睛']);
  const eyelid = hasAny(tokens, ['eyelid','eyelids','lid','lids','眼皮']);
  const pupil = hasAny(tokens, ['pupil','pupils','iris','瞳孔','虹膜']);
  const brow = hasAny(tokens, ['brow','brows','eyebrow','eyebrows','眉','眉毛']);
  const mouth = hasAny(tokens, ['mouth','mouths','lip','lips','嘴','嘴巴','口型']);

  if (eyelid) {
    if (side && state) return { path, slot: `${side === 'left' ? 'eyelidLeft' : 'eyelidRight'}${state === 'open' ? 'Open' : 'Closed'}` as FaceTemplateLayerSlot, confidence: .99, reason: `${side} eyelid + ${state}` };
    if (!side && state) return { path, slot: state === 'open' ? 'eyelidsOpen' : 'eyelidsClosed', confidence: .97, reason: `eyelids + ${state}` };
    if (side) return { path, slot: side === 'left' ? 'eyelidLeftOpen' : 'eyelidRightOpen', confidence: .82, reason: `${side} eyelid；未写状态，暂按睁眼推定` };
    return { path, slot: 'eyelidsOpen', confidence: .80, reason: 'eyelids；未写状态，暂按睁眼推定' };
  }
  if (pupil) {
    if (side) return { path, slot: side === 'left' ? 'pupilLeft' : 'pupilRight', confidence: .98, reason: `${side} pupil` };
    return { path, slot: 'pupils', confidence: .94, reason: 'combined pupils' };
  }
  if (brow) {
    if (side) return { path, slot: side === 'left' ? 'browLeft' : 'browRight', confidence: .98, reason: `${side} brow` };
    return { path, slot: 'brows', confidence: .94, reason: 'combined brows' };
  }
  if (eye) {
    if (side && state) return { path, slot: `${side === 'left' ? 'eyeLeft' : 'eyeRight'}${state === 'open' ? 'Open' : 'Closed'}` as FaceTemplateLayerSlot, confidence: .99, reason: `${side} eye + ${state}` };
    if (!side && state) return { path, slot: state === 'open' ? 'eyesOpen' : 'eyesClosed', confidence: .97, reason: `combined eyes + ${state}` };
    if (side) return { path, slot: side === 'left' ? 'eyeLeftOpen' : 'eyeRightOpen', confidence: .84, reason: `${side} eye；未写状态，暂按睁眼推定` };
    return { path, slot: 'eyesOpen', confidence: .82, reason: 'eyes；未写状态，暂按睁眼推定' };
  }
  if (mouth) {
    const viseme = mouthViseme(tokens);
    if (viseme) return { path, slot: viseme, confidence: .99, reason: `mouth viseme ${String(viseme).replace(/^mouth/, '')}` };
    if (state) return { path, slot: state === 'open' ? 'mouthOpen' : 'mouthClosed', confidence: .97, reason: `mouth + ${state}` };
    if (hasAny(tokens, ['idle','neutral','default','rest','闭嘴','默认'])) return { path, slot: 'mouthClosed', confidence: .92, reason: 'neutral/rest mouth' };
    return { path, slot: 'mouthClosed', confidence: .80, reason: 'mouth；未写状态，暂按默认闭嘴推定' };
  }
  return { path, slot: null, confidence: 0, reason: '没有识别到眼睛 / 眼皮 / 瞳孔 / 眉毛 / 嘴部关键词' };
}

export function planFaceTemplateBindings(paths: string[]): FaceTemplateBindingPlan {
  const guesses = paths.map(classifyFaceTemplatePartFilename);
  const counts = new Map<string, number>();
  for (const guess of guesses) if (guess.slot) counts.set(guess.slot, (counts.get(guess.slot) ?? 0) + 1);
  const items = guesses.map(guess => ({ ...guess, conflict: !!guess.slot && (counts.get(guess.slot) ?? 0) > 1 }));
  return {
    items,
    recognized: items.filter(item => item.slot).length,
    unknown: items.filter(item => !item.slot).length,
    conflicts: items.filter(item => item.conflict).length
  };
}
