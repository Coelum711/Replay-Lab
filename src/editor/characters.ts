import type { CharacterLayerSet, ImageSet, ReplayCharacter, ReplayProject } from '../core/types.js';
import { defaultFaceFit } from '../core/face.js';
import { addCharacterAlias, normalizeCharacterNameKey } from '../core/character-name.js';
import { defaultPuppetRig } from '../puppet/rig.js';

export interface CharacterDuplicateSuggestion {
  keepId: string;
  mergeId: string;
  keepName: string;
  mergeName: string;
  reason: string;
  confidence: number;
}

export interface MergeCharactersResult {
  keepId: string;
  removedId: string;
  linesReassigned: number;
  stageRefsReassigned: number;
  assetMetadataReassigned: number;
  aliasesAdded: string[];
  filled: string[];
  conflicts: string[];
}

export interface CharacterMergeConflictGroup {
  id: 'identity' | 'stage' | 'appearance' | 'speech' | 'other';
  label: string;
  paths: string[];
}

export interface CharacterMergePlan extends MergeCharactersResult {
  keepName: string;
  mergeName: string;
  conflictGroups: CharacterMergeConflictGroup[];
}

export function suggestCharacterDuplicates(project: ReplayProject): CharacterDuplicateSuggestion[] {
  const suggestions: CharacterDuplicateSuggestion[] = [];
  const chars = project.characters;
  for (let i = 0; i < chars.length; i += 1) for (let j = i + 1; j < chars.length; j += 1) {
    const a = chars[i]!, b = chars[j]!;
    const aName = normalizeCharacterNameKey(a.name), bName = normalizeCharacterNameKey(b.name);
    const aAliases = new Set((a.aliases ?? []).map(normalizeCharacterNameKey).filter(Boolean));
    const bAliases = new Set((b.aliases ?? []).map(normalizeCharacterNameKey).filter(Boolean));
    let reason = '', confidence = 0;
    if (aName && aName === bName) { reason = '角色名仅大小写 / 全半角 / 空格标点不同'; confidence = 1; }
    else if ((aName && bAliases.has(aName)) || (bName && aAliases.has(bName))) { reason = '一个角色名命中了另一个角色已记录的 alias'; confidence = .99; }
    else {
      const overlap = [...aAliases].find(key => bAliases.has(key));
      if (overlap) { reason = '两个角色共享同一个已记录 alias'; confidence = .97; }
    }
    if (reason) suggestions.push({ keepId: a.id, mergeId: b.id, keepName: a.name, mergeName: b.name, reason, confidence });
  }
  return suggestions.sort((a, b) => b.confidence - a.confidence || a.keepName.localeCompare(b.keepName));
}

function fillImageSet(target: ImageSet, source: ImageSet, prefix: string, conflicts: string[], filled: string[]): void {
  for (const key of ['idle','open','blink','A','I','U','E','O'] as const) {
    const s = source?.[key]; if (!s) continue;
    if (!target[key]) { target[key] = s; filled.push(`${prefix}.${key}`); }
    else if (target[key] !== s) conflicts.push(`${prefix}.${key}`);
  }
}

function fillLayerSet(target: CharacterLayerSet, source: CharacterLayerSet, prefix: string, conflicts: string[], filled: string[]): void {
  for (const [key, value] of Object.entries(source ?? {})) {
    if (!value) continue;
    const slot = key as keyof CharacterLayerSet;
    if (!target[slot]) { target[slot] = value as never; filled.push(`${prefix}.${key}`); }
    else if (target[slot] !== value) conflicts.push(`${prefix}.${key}`);
  }
}

function hasVisual(character: ReplayCharacter): boolean {
  return Boolean(character.layers?.base || character.images?.idle || Object.values(character.layers ?? {}).some(Boolean) || Object.values(character.images ?? {}).some(Boolean));
}

function rigIsDefault(character: ReplayCharacter): boolean {
  return JSON.stringify(character.puppet ?? defaultPuppetRig()) === JSON.stringify(defaultPuppetRig());
}

function fitIsDefault(character: ReplayCharacter): boolean {
  return JSON.stringify(character.faceFit ?? defaultFaceFit()) === JSON.stringify(defaultFaceFit());
}

function facingIsDefault(character: ReplayCharacter): boolean {
  return JSON.stringify(character.stageFacing ?? { policy: 'flippable', nativeFacing: 'left' }) === JSON.stringify({ policy: 'flippable', nativeFacing: 'left' });
}

function uniqueMapped(ids: string[] | undefined, removedId: string, keepId: string): string[] | undefined {
  if (!ids) return ids;
  return [...new Set(ids.map(id => id === removedId ? keepId : id))];
}

function applyCharacterMerge(project: ReplayProject, keepId: string, mergeId: string): MergeCharactersResult {
  if (keepId === mergeId) throw new Error('不能把角色合并到自己。');
  const keep = project.characters.find(c => c.id === keepId);
  const source = project.characters.find(c => c.id === mergeId);
  if (!keep || !source) throw new Error('找不到要合并的角色。');

  const conflicts: string[] = [];
  const filled: string[] = [];
  const aliasesAdded: string[] = [];
  for (const alias of [source.name, ...(source.aliases ?? [])]) if (addCharacterAlias(keep, alias)) aliasesAdded.push(alias);
  keep.aliases = (keep.aliases ?? []).filter(alias => normalizeCharacterNameKey(alias) !== normalizeCharacterNameKey(keep.name));

  if (keep.kind !== source.kind) conflicts.push('kind');
  if (keep.showOnStage !== source.showOnStage) conflicts.push('showOnStage');
  if (keep.defaultPosition === 'auto' && source.defaultPosition !== 'auto') { keep.defaultPosition = source.defaultPosition; filled.push('defaultPosition'); }
  else if (keep.defaultPosition !== 'auto' && source.defaultPosition !== 'auto' && keep.defaultPosition !== source.defaultPosition) conflicts.push('defaultPosition');
  if (facingIsDefault(keep) && !facingIsDefault(source)) { keep.stageFacing = structuredClone(source.stageFacing); filled.push('stageFacing'); }
  else if (!facingIsDefault(keep) && !facingIsDefault(source) && JSON.stringify(keep.stageFacing) !== JSON.stringify(source.stageFacing)) conflicts.push('stageFacing');

  const keepHadVisual = hasVisual(keep), sourceHasVisual = hasVisual(source);
  keep.images ??= {}; source.images ??= {}; fillImageSet(keep.images, source.images, 'images', conflicts, filled);
  keep.expressions ??= {}; for (const [name, set] of Object.entries(source.expressions ?? {})) { keep.expressions[name] ??= {}; fillImageSet(keep.expressions[name]!, set, `expressions.${name}`, conflicts, filled); }
  keep.layers ??= {}; fillLayerSet(keep.layers, source.layers ?? {}, 'layers', conflicts, filled);
  keep.layerExpressions ??= {}; for (const [name, set] of Object.entries(source.layerExpressions ?? {})) { keep.layerExpressions[name] ??= {}; fillLayerSet(keep.layerExpressions[name]!, set, `layerExpressions.${name}`, conflicts, filled); }

  if (!keepHadVisual && sourceHasVisual) {
    keep.puppet = structuredClone(source.puppet ?? defaultPuppetRig()); if (!rigIsDefault(source)) filled.push('puppet');
    keep.faceFit = structuredClone(source.faceFit ?? defaultFaceFit()); if (!fitIsDefault(source)) filled.push('faceFit');
  } else {
    if (rigIsDefault(keep) && !rigIsDefault(source)) { keep.puppet = structuredClone(source.puppet); filled.push('puppet'); }
    else if (!rigIsDefault(source) && !rigIsDefault(keep) && JSON.stringify(keep.puppet) !== JSON.stringify(source.puppet)) conflicts.push('puppet');
    if (fitIsDefault(keep) && !fitIsDefault(source)) { keep.faceFit = structuredClone(source.faceFit); filled.push('faceFit'); }
    else if (!fitIsDefault(source) && !fitIsDefault(keep) && JSON.stringify(keep.faceFit) !== JSON.stringify(source.faceFit)) conflicts.push('faceFit');
  }

  if (!keep.voice && source.voice) { keep.voice = structuredClone(source.voice); filled.push('voice'); }
  else if (keep.voice && source.voice && JSON.stringify(keep.voice) !== JSON.stringify(source.voice)) conflicts.push('voice');
  keep.speech ??= { defaultLanguage: null, voices: {} };
  if (source.speech) {
    if (!keep.speech.defaultLanguage && source.speech.defaultLanguage) { keep.speech.defaultLanguage = source.speech.defaultLanguage; filled.push('speech.defaultLanguage'); }
    else if (keep.speech.defaultLanguage && source.speech.defaultLanguage && keep.speech.defaultLanguage !== source.speech.defaultLanguage) conflicts.push('speech.defaultLanguage');
    if (keep.speech.pauseScale == null && source.speech.pauseScale != null) { keep.speech.pauseScale = source.speech.pauseScale; filled.push('speech.pauseScale'); }
    else if (keep.speech.pauseScale != null && source.speech.pauseScale != null && keep.speech.pauseScale !== source.speech.pauseScale) conflicts.push('speech.pauseScale');
    if (!keep.speech.translationProvider && source.speech.translationProvider) { keep.speech.translationProvider = source.speech.translationProvider; filled.push('speech.translationProvider'); }
    if (!keep.speech.ttsProvider && source.speech.ttsProvider) { keep.speech.ttsProvider = source.speech.ttsProvider; filled.push('speech.ttsProvider'); }
    keep.speech.voices ??= {}; for (const [lang, voice] of Object.entries(source.speech.voices ?? {})) { if (!keep.speech.voices[lang]) { keep.speech.voices[lang] = structuredClone(voice); filled.push(`speech.voices.${lang}`); } else if (JSON.stringify(keep.speech.voices[lang]) !== JSON.stringify(voice)) conflicts.push(`speech.voices.${lang}`); }
    keep.speech.accents ??= {}; for (const [lang, accent] of Object.entries(source.speech.accents ?? {})) { if (!keep.speech.accents[lang]) { keep.speech.accents[lang] = structuredClone(accent); filled.push(`speech.accents.${lang}`); } else if (JSON.stringify(keep.speech.accents[lang]) !== JSON.stringify(accent)) conflicts.push(`speech.accents.${lang}`); }
  }

  let linesReassigned = 0, stageRefsReassigned = 0;
  for (const line of project.lines) {
    if (line.speakerId === mergeId) { line.speakerId = keepId; linesReassigned += 1; }
    const beforeStage = JSON.stringify([line.stageIds, line.stagePositions, line.stageTransforms, line.scene?.enterIds, line.scene?.exitIds]);
    line.stageIds = uniqueMapped(line.stageIds, mergeId, keepId);
    if (line.stagePositions?.[mergeId] !== undefined) {
      if (line.stagePositions[keepId] === undefined) line.stagePositions[keepId] = line.stagePositions[mergeId]!;
      else if (line.stagePositions[keepId] !== line.stagePositions[mergeId]) conflicts.push('stagePositions');
      delete line.stagePositions[mergeId];
    }
    if (line.stageTransforms?.[mergeId] !== undefined) {
      if (line.stageTransforms[keepId] === undefined) line.stageTransforms[keepId] = structuredClone(line.stageTransforms[mergeId]);
      else if (JSON.stringify(line.stageTransforms[keepId]) !== JSON.stringify(line.stageTransforms[mergeId])) conflicts.push('stageTransforms');
      delete line.stageTransforms[mergeId];
    }
    if (line.scene) {
      line.scene.enterIds = uniqueMapped(line.scene.enterIds, mergeId, keepId);
      line.scene.exitIds = uniqueMapped(line.scene.exitIds, mergeId, keepId);
    }
    if (beforeStage !== JSON.stringify([line.stageIds, line.stagePositions, line.stageTransforms, line.scene?.enterIds, line.scene?.exitIds])) stageRefsReassigned += 1;
  }

  let assetMetadataReassigned = 0;
  for (const asset of project.assets) {
    if (asset.metadata?.characterId === mergeId) {
      asset.metadata = { ...asset.metadata, characterId: keepId };
      assetMetadataReassigned += 1;
    }
  }

  project.characters = project.characters.filter(c => c.id !== mergeId);
  return { keepId, removedId: mergeId, linesReassigned, stageRefsReassigned, assetMetadataReassigned, aliasesAdded, filled: [...new Set(filled)], conflicts: [...new Set(conflicts)] };
}

function mergeConflictGroup(path: string): CharacterMergeConflictGroup['id'] {
  if (path === 'kind' || path === 'showOnStage' || path === 'defaultPosition') return 'identity';
  if (path === 'stageFacing') return 'appearance';
  if (path === 'stagePositions' || path === 'stageTransforms') return 'stage';
  if (path === 'puppet' || path === 'faceFit' || path.startsWith('images.') || path.startsWith('layers.') || path.startsWith('expressions.') || path.startsWith('layerExpressions.')) return 'appearance';
  if (path === 'voice' || path.startsWith('speech.')) return 'speech';
  return 'other';
}

const MERGE_CONFLICT_LABELS: Record<CharacterMergeConflictGroup['id'], string> = {
  identity: '角色身份 / 默认行为',
  stage: '舞台位置',
  appearance: '立绘 / Face Fit',
  speech: '声音 / 朗读',
  other: '其他设置'
};

/**
 * Pure preview of a character merge. The caller receives the exact impact that
 * mergeCharacters() would produce, without mutating the supplied project.
 */
export function planCharacterMerge(project: ReplayProject, keepId: string, mergeId: string): CharacterMergePlan {
  const keep = project.characters.find(character => character.id === keepId);
  const source = project.characters.find(character => character.id === mergeId);
  if (!keep || !source) throw new Error('找不到要合并的角色。');
  const result = applyCharacterMerge(structuredClone(project), keepId, mergeId);
  const grouped = new Map<CharacterMergeConflictGroup['id'], string[]>();
  for (const path of result.conflicts) {
    const id = mergeConflictGroup(path);
    const paths = grouped.get(id) ?? []; paths.push(path); grouped.set(id, paths);
  }
  return {
    ...result,
    keepName: keep.name,
    mergeName: source.name,
    conflictGroups: [...grouped.entries()].map(([id, paths]) => ({ id, label: MERGE_CONFLICT_LABELS[id], paths }))
  };
}

export function mergeCharacters(project: ReplayProject, keepId: string, mergeId: string): MergeCharactersResult {
  return applyCharacterMerge(project, keepId, mergeId);
}

/** Character ids that are actually referenced by the current script.
 * Retained production-only characters are intentionally excluded. */
export function collectScriptCharacterIds(project: ReplayProject): Set<string> {
  const ids = new Set<string>();
  for (const line of project.lines) {
    if (line.speakerId) ids.add(line.speakerId);
    for (const id of line.stageIds ?? []) ids.add(id);
    for (const id of Object.keys(line.stagePositions ?? {})) ids.add(id);
    for (const id of Object.keys(line.stageTransforms ?? {})) ids.add(id);
    for (const id of line.scene?.enterIds ?? []) ids.add(id);
    for (const id of line.scene?.exitIds ?? []) ids.add(id);
  }
  return ids;
}
