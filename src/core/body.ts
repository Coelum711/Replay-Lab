import type { CharacterBodyArt, CharacterBodyLayer, ReplayCharacter } from './types.js';

/** Body art keys are "outfit/pose". */
export function bodyKey(outfit: string, pose: string): string {
  return `${outfit}/${pose}`;
}

export function splitBodyKey(key: string): { outfit: string; pose: string } {
  const at = key.indexOf('/');
  return at < 0 ? { outfit: key, pose: '' } : { outfit: key.slice(0, at), pose: key.slice(at + 1) };
}

function hasLayers(art: CharacterBodyArt | undefined): art is CharacterBodyArt {
  return !!art?.layers?.some(layer => !!layer?.asset);
}

function bodyKeys(character: ReplayCharacter): string[] {
  return Object.entries(character.bodies ?? {}).filter(([, art]) => hasLayers(art)).map(([key]) => key);
}

export function hasBodyArt(character: ReplayCharacter | null | undefined): boolean {
  return !!character && bodyKeys(character).length > 0;
}

/** Outfits in the order their first body appears. */
export function characterOutfits(character: ReplayCharacter): string[] {
  return [...new Set(bodyKeys(character).map(key => splitBodyKey(key).outfit))];
}

/** Poses drawn for an outfit, or for any outfit when none is given. */
export function characterPoses(character: ReplayCharacter, outfit?: string | null): string[] {
  return [...new Set(bodyKeys(character).map(splitBodyKey).filter(item => !outfit || item.outfit === outfit).map(item => item.pose))];
}

export function defaultOutfit(character: ReplayCharacter): string | null {
  const outfits = characterOutfits(character);
  return character.defaultOutfit && outfits.includes(character.defaultOutfit) ? character.defaultOutfit : outfits[0] ?? null;
}

export function defaultPose(character: ReplayCharacter, outfit: string): string | null {
  const poses = characterPoses(character, outfit);
  return character.defaultPose && poses.includes(character.defaultPose) ? character.defaultPose : poses[0] ?? null;
}

export interface ResolvedBody {
  key: string;
  outfit: string;
  pose: string;
  /** True when the requested combination was missing and a fallback was used. */
  fallback: boolean;
  back: CharacterBodyLayer[];
  front: CharacterBodyLayer[];
}

/**
 * Body for outfit × pose. Missing combinations fall back to the outfit's default pose,
 * then to the default outfit with the requested pose, then to the default body.
 */
export function resolveBody(character: ReplayCharacter, outfit?: string | null, pose?: string | null): ResolvedBody | null {
  const bodies = character.bodies ?? {};
  const wantOutfit = outfit && characterOutfits(character).includes(outfit) ? outfit : defaultOutfit(character);
  if (!wantOutfit) return null;
  const candidates: string[] = [];
  if (pose) candidates.push(bodyKey(wantOutfit, pose));
  const outfitPose = defaultPose(character, wantOutfit);
  if (outfitPose) candidates.push(bodyKey(wantOutfit, outfitPose));
  const baseOutfit = defaultOutfit(character);
  if (baseOutfit && pose) candidates.push(bodyKey(baseOutfit, pose));
  if (baseOutfit) { const p = defaultPose(character, baseOutfit); if (p) candidates.push(bodyKey(baseOutfit, p)); }
  const key = candidates.find(candidate => hasLayers(bodies[candidate]));
  if (!key) return null;
  const layers = bodies[key]!.layers.filter(layer => !!layer?.asset);
  let back = layers.filter(layer => !layer.front);
  let front = layers.filter(layer => layer.front);
  if (!back.length) { back = front; front = []; }
  const split = splitBodyKey(key);
  return { key, ...split, fallback: key !== candidates[0], back, front };
}

/**
 * Body layer roles from imported layer / group names, e.g. "服装_外套", "手_抱臂", "阴影_抱臂"
 * or "外套/抱臂/阴影". Returns null when the name does not mention a pose or outfit.
 */
/** "阴影" / "shadow" → multiply, "高光" → screen, "叠加" → overlay. */
export function bodyBlendFromName(raw: string): CharacterBodyLayer['blend'] | undefined {
  const name = String(raw ?? '');
  return /(阴影|正片叠底|multiply|shadow)/i.test(name) ? 'multiply'
    : /(高光|滤色|screen|highlight)/i.test(name) ? 'screen'
    : /(叠加|overlay)/i.test(name) ? 'overlay' : undefined;
}

/** "…_前", "…（前）" or "front" marks art drawn in front of the face. */
export function bodyFrontFromName(raw: string): boolean {
  const name = String(raw ?? '').trim();
  return /[（(\[](前|前景|front)[)）\]]$/i.test(name) || /(^|[_\s])(前|前景|front)([_\s]|$)/i.test(name);
}

export function parseBodyLayerName(raw: string): { outfit?: string; pose?: string; blend?: CharacterBodyLayer['blend']; front?: boolean } | null {
  const name = String(raw ?? '').trim();
  if (!name) return null;
  const front = bodyFrontFromName(name);
  const blend = bodyBlendFromName(name);
  // The keyword must start the name or follow a separator, and be followed by one ("手臂" is not a pose tag).
  const outfitMatch = name.match(/(?:^|[_\s/])(?:服装|衣服|outfit)[_\s:：-]+([^_\s/]+)/i);
  const poseMatch = name.match(/(?:^|[_\s/])(?:手|姿势|pose|arms?)[_\s:：-]+([^_\s/]+)/i);
  const out: { outfit?: string; pose?: string; blend?: CharacterBodyLayer['blend']; front?: boolean } = {};
  if (outfitMatch) out.outfit = outfitMatch[1];
  if (poseMatch) out.pose = poseMatch[1];
  if (!out.outfit && !out.pose && name.includes('/')) {
    const parts = name.split('/').map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) { out.outfit = parts[0]; out.pose = parts[1]; }
  }
  if (!out.outfit && !out.pose) return null;
  if (blend) out.blend = blend;
  if (front) out.front = true;
  return out;
}
