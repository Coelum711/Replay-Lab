import type { CharacterLayerSet } from '../core/types.js';
import type { FaceTemplateLayerSlot } from './face-template-autobind.js';
import { classifyFaceTemplatePartFilename } from './face-template-autobind.js';

export type FacePackageTargetKind = 'shared' | 'character' | 'new-character' | 'unresolved';
export type FacePackageSlot = FaceTemplateLayerSlot | 'base';

export interface FacePackageCharacterRef {
  id: string;
  name: string;
  aliases?: string[];
}

export interface FacePackageBindingItem {
  path: string;
  slot: FacePackageSlot | null;
  confidence: number;
  partReason: string;
  targetKind: FacePackageTargetKind;
  targetId: string | null;
  targetLabel: string;
  targetReason: string;
  proposedCharacterName?: string | null;
  conflict: boolean;
}

export interface FacePackageBindingPlan {
  items: FacePackageBindingItem[];
  shared: number;
  character: number;
  newCharacter: number;
  unresolved: number;
  unknownPart: number;
  conflicts: number;
}

const SHARED_DIR_ALIASES = new Set([
  'common', 'shared', 'template', 'default', 'face-template', 'facetemplate',
  '通用', '共享', '模板', '共用', '公共'
]);

const GENERIC_ROOT_DIRS = new Set([
  'faces', 'face', 'characters', 'character', 'chars', 'roles', 'sprites', 'sprite',
  'art', 'assets', 'images', 'image', 'base', 'misc', 'other', 'others', 'extras', 'extra', 'unknown',
  '立绘', '角色', '素材', '脸部', '五官', '其他', '杂项'
]);

const PART_DIRS = new Set([
  'eye','eyes','eyelid','eyelids','pupil','pupils','iris','brow','brows','eyebrow','eyebrows',
  'mouth','mouths','lip','lips','left','right','open','closed','close','blink',
  '眼','眼睛','眼皮','瞳孔','虹膜','眉','眉毛','嘴','嘴巴','口型','左','右','睁眼','闭眼'
]);

const BASE_ALIASES = new Set([
  'base','body','portrait','standing','stand','sprite','character','idle','default',
  '立绘','底图','人物','角色图','身体','本体','半身','胸像','全身'
]);

function stripExtension(value: string): string {
  return value.replace(/\.[^.\/]+$/, '');
}

function routeKey(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]+/g, '');
}

function pathSegments(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').filter(Boolean);
}

function normalizedTokens(path: string): string[] {
  return stripExtension(path.replace(/\\/g, '/'))
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .normalize('NFKC')
    .toLowerCase()
    .split(/[\/_.\-\s]+/)
    .map(token => token.trim())
    .filter(Boolean);
}

function filenameCharacterPrefix(path: string, characters: FacePackageCharacterRef[]): FacePackageCharacterRef | null {
  const segments = pathSegments(path);
  const base = stripExtension(segments.at(-1) ?? '');
  const lowered = base.normalize('NFKC').toLowerCase();
  const matches = characters.filter(character => [character.name, ...(character.aliases ?? [])].some(value => {
    const name = value.normalize('NFKC').trim().toLowerCase();
    if (!name) return false;
    if (lowered === name) return true;
    return lowered.startsWith(name + '_') || lowered.startsWith(name + '-') || lowered.startsWith(name + '.') || lowered.startsWith(name + ' ');
  }));
  return matches.length === 1 ? matches[0]! : null;
}

function candidateNewCharacterDir(path: string): string | null {
  const dirs = pathSegments(path).slice(0, -1);
  // File-system directory imports preserve the selected package root as the
  // first segment. When there is deeper structure, do not accidentally turn
  // an arbitrary package name into a character.
  const startIndex = dirs.length >= 2 ? 1 : 0;
  for (let index = startIndex; index < dirs.length; index += 1) {
    const raw = dirs[index]!.normalize('NFKC').trim();
    const key = raw.toLowerCase();
    if (!raw || SHARED_DIR_ALIASES.has(key) || PART_DIRS.has(key) || GENERIC_ROOT_DIRS.has(key)) continue;
    return raw;
  }
  return null;
}

function classifyTarget(path: string, characters: FacePackageCharacterRef[]): Pick<FacePackageBindingItem, 'targetKind'|'targetId'|'targetLabel'|'targetReason'|'proposedCharacterName'> {
  const segments = pathSegments(path);
  const dirs = segments.slice(0, -1);
  const sharedHits = dirs.filter(segment => SHARED_DIR_ALIASES.has(segment.normalize('NFKC').trim().toLowerCase()));
  const characterHits = new Map<string, FacePackageCharacterRef>();
  const byKey = new Map<string, FacePackageCharacterRef[]>();
  for (const character of characters) for (const value of [character.name, ...(character.aliases ?? [])]) {
    const key = routeKey(value); if (!key) continue;
    const list = byKey.get(key) ?? []; if (!list.some(item => item.id === character.id)) list.push(character); byKey.set(key, list);
  }
  for (const segment of dirs) {
    for (const match of byKey.get(routeKey(segment)) ?? []) characterHits.set(match.id, match);
  }

  if (sharedHits.length && characterHits.size) {
    return { targetKind: 'unresolved', targetId: null, targetLabel: '未确定', targetReason: '路径同时命中共享目录和角色目录', proposedCharacterName: null };
  }
  if (sharedHits.length) {
    return { targetKind: 'shared', targetId: null, targetLabel: '共享模板', targetReason: `共享目录：${sharedHits[0]}`, proposedCharacterName: null };
  }
  if (characterHits.size === 1) {
    const character = [...characterHits.values()][0]!;
    return { targetKind: 'character', targetId: character.id, targetLabel: character.name, targetReason: `角色目录：${character.name}`, proposedCharacterName: null };
  }
  if (characterHits.size > 1) {
    return { targetKind: 'unresolved', targetId: null, targetLabel: '未确定', targetReason: '路径同时命中多个角色目录', proposedCharacterName: null };
  }

  const prefix = filenameCharacterPrefix(path, characters);
  if (prefix) {
    return { targetKind: 'character', targetId: prefix.id, targetLabel: prefix.name, targetReason: `文件名前缀：${prefix.name}`, proposedCharacterName: null };
  }

  const proposed = candidateNewCharacterDir(path);
  if (proposed) {
    return { targetKind: 'new-character', targetId: null, targetLabel: proposed, targetReason: `素材包角色目录：${proposed}`, proposedCharacterName: proposed };
  }
  return { targetKind: 'unresolved', targetId: null, targetLabel: '未确定', targetReason: '没有明确的 common/shared/template、现有角色目录或可用角色目录名', proposedCharacterName: null };
}

function classifyPackagePart(path: string, targetKind: FacePackageTargetKind): Pick<FacePackageBindingItem, 'slot'|'confidence'|'partReason'> {
  const face = classifyFaceTemplatePartFilename(path);
  if (face.slot) return { slot: face.slot, confidence: face.confidence, partReason: face.reason };
  const segments = pathSegments(path);
  const basename = segments.at(-1) ?? path;
  const tokens = normalizedTokens(basename);
  const directoryTokens = segments.slice(0, -1).flatMap(segment => normalizedTokens(segment));
  const insideFacePartFolder = directoryTokens.some(token => PART_DIRS.has(token));
  if (!insideFacePartFolder && tokens.some(token => BASE_ALIASES.has(token))) {
    if (targetKind === 'shared') return { slot: null, confidence: 0, partReason: '角色底图不能写入共享模板；请放到具体角色目录' };
    return { slot: 'base', confidence: .98, partReason: '角色底图 / 立绘' };
  }
  return { slot: null, confidence: face.confidence, partReason: face.reason };
}

/**
 * Route a mixed character-art package into a shared face template, existing
 * character overrides, or explicit new-character proposals. Text-only import
 * never calls this planner, so no-art projects remain unaffected.
 */
export function planFacePackageBindings(paths: string[], characters: FacePackageCharacterRef[]): FacePackageBindingPlan {
  const raw = paths.map(path => {
    const target = classifyTarget(path, characters);
    const part = classifyPackagePart(path, target.targetKind);
    return {
      path,
      ...part,
      ...target,
      conflict: false
    } satisfies FacePackageBindingItem;
  });

  const counts = new Map<string, number>();
  for (const item of raw) {
    if (!item.slot || item.targetKind === 'unresolved') continue;
    const targetKey = item.targetKind === 'shared'
      ? 'shared'
      : item.targetKind === 'character'
        ? `character:${item.targetId}`
        : `new-character:${routeKey(item.proposedCharacterName ?? item.targetLabel)}`;
    const key = `${targetKey}:${item.slot}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const items = raw.map(item => {
    if (!item.slot || item.targetKind === 'unresolved') return item;
    const targetKey = item.targetKind === 'shared'
      ? 'shared'
      : item.targetKind === 'character'
        ? `character:${item.targetId}`
        : `new-character:${routeKey(item.proposedCharacterName ?? item.targetLabel)}`;
    return { ...item, conflict: (counts.get(`${targetKey}:${item.slot}`) ?? 0) > 1 };
  });

  return {
    items,
    shared: items.filter(item => item.targetKind === 'shared' && !!item.slot).length,
    character: items.filter(item => item.targetKind === 'character' && !!item.slot).length,
    newCharacter: items.filter(item => item.targetKind === 'new-character' && !!item.slot).length,
    unresolved: items.filter(item => item.targetKind === 'unresolved').length,
    unknownPart: items.filter(item => !item.slot).length,
    conflicts: items.filter(item => item.conflict).length
  };
}
