import { bodyBlendFromName, bodyFrontFromName, bodyKey, parseBodyLayerName } from './body.js';
import type { CharacterBodyBlend } from './types.js';

/** A PSD-like layer tree node (ag-psd shape, reduced to what the planner needs). */
export interface BodyImportNode {
  name?: string;
  hidden?: boolean;
  /** PSD blend mode name, e.g. "normal", "multiply", "pass through". */
  blendMode?: string;
  opacity?: number;
  /** Clipping mask onto the layer below. */
  clipping?: boolean;
  children?: BodyImportNode[];
  /** Opaque handle for a pixel layer (leaf). */
  ref?: unknown;
}

export interface BodyImportSlice {
  /** Pixel layers to flatten into one image, bottom to top, each with its effective opacity. */
  sources: Array<{ ref: unknown; opacity: number; name: string }>;
  blend: CharacterBodyBlend;
  opacity: number;
  front: boolean;
  /** Body keys ("outfit/pose") that use this slice. */
  keys: string[];
  label: string;
}

export interface BodyImportPlan {
  outfits: string[];
  poses: Record<string, string[]>;
  slices: BodyImportSlice[];
  /** key → slice indexes, bottom to top. */
  bodies: Record<string, number[]>;
  /** Layers left out because they belong to the face (expressions keep handling those). */
  skippedFace: string[];
  /** Layers whose blend mode is not supported; imported as normal. */
  approximated: string[];
}

const FACE = /^(脸|面部|五官|表情|眼|眼睛|眼白|瞳孔|嘴|嘴巴|口|眉|眉毛|face|eyes?|pupils?|mouth|brows?)([_\s\-（(]|$)/i;

function blendOf(node: BodyImportNode): { blend: CharacterBodyBlend; exact: boolean } {
  const mode = String(node.blendMode ?? 'normal').toLowerCase();
  if (mode === 'multiply') return { blend: 'multiply', exact: true };
  if (mode === 'screen') return { blend: 'screen', exact: true };
  if (mode === 'overlay') return { blend: 'overlay', exact: true };
  if (node.clipping) return { blend: 'clip', exact: mode === 'normal' };
  return { blend: 'normal', exact: mode === 'normal' || mode === 'pass through' };
}

interface Leaf { node: BodyImportNode; name: string; outfit?: string; pose?: string; front: boolean; opacity: number; blend: CharacterBodyBlend; exact: boolean; nameBlend?: CharacterBodyBlend; }

/**
 * Splits a layered drawing into outfit × pose bodies by layer / group names
 * ("服装_外套", "手_抱臂", "手_托腮_前", or "外套/抱臂"). Untagged layers are shared by
 * every body; face groups are skipped. Consecutive normal layers used by the same bodies
 * are flattened into one slice so a 60-layer file becomes a handful of images.
 */
export function planBodyImport(roots: BodyImportNode[]): BodyImportPlan {
  const leaves: Leaf[] = [];
  const skippedFace: string[] = [];
  const walk = (nodes: BodyImportNode[], ctx: { outfit?: string; pose?: string; front: boolean; opacity: number; face: boolean; blend?: CharacterBodyBlend }) => {
    for (const node of nodes) {
      if (node.hidden) continue;
      const name = String(node.name ?? '').trim();
      const tag = parseBodyLayerName(name);
      const next = {
        outfit: tag?.outfit ?? ctx.outfit,
        pose: tag?.pose ?? ctx.pose,
        front: ctx.front || bodyFrontFromName(name),
        opacity: ctx.opacity * Math.max(0, Math.min(1, node.opacity ?? 1)),
        face: ctx.face || (!tag && FACE.test(name)),
        blend: bodyBlendFromName(name) ?? ctx.blend
      };
      if (node.children) { walk(node.children, next); continue; }
      if (node.ref == null) continue;
      if (next.face && !next.outfit && !next.pose) { skippedFace.push(name || '(未命名)'); continue; }
      const { blend, exact } = blendOf(node);
      leaves.push({ node, name, outfit: next.outfit, pose: next.pose, front: next.front, opacity: next.opacity, blend, exact, nameBlend: next.blend });
    }
  };
  // ag-psd lists children bottom to top, which is also our draw order.
  walk(roots, { front: false, opacity: 1, face: false });

  const outfits = [...new Set(leaves.map(l => l.outfit).filter((v): v is string => !!v))];
  if (!outfits.length) outfits.push('默认');
  const poses: Record<string, string[]> = {};
  for (const outfit of outfits) {
    const list = [...new Set(leaves.filter(l => !l.outfit || l.outfit === outfit).map(l => l.pose).filter((v): v is string => !!v))];
    poses[outfit] = list.length ? list : ['默认'];
  }
  const memberOf = (leaf: Leaf) => outfits.flatMap(outfit => poses[outfit]!.filter(pose =>
    (!leaf.outfit || leaf.outfit === outfit) && (!leaf.pose || leaf.pose === pose)).map(pose => bodyKey(outfit, pose)));

  const approximated: string[] = [];
  const slices: BodyImportSlice[] = [];
  for (const leaf of leaves) {
    const keys = memberOf(leaf);
    if (!keys.length) continue;
    // A layer whose own blend is normal can still be marked as a shadow by name (e.g. "阴影").
    const blend = leaf.blend === 'normal' && leaf.nameBlend ? leaf.nameBlend : leaf.blend;
    if (!leaf.exact) approximated.push(leaf.name || '(未命名)');
    const last = slices.at(-1);
    const signature = keys.join('|');
    if (blend === 'normal' && last && last.blend === 'normal' && last.front === leaf.front && last.keys.join('|') === signature) {
      last.sources.push({ ref: leaf.node.ref, opacity: leaf.opacity, name: leaf.name });
      continue;
    }
    slices.push({
      sources: [{ ref: leaf.node.ref, opacity: blend === 'normal' ? leaf.opacity : 1, name: leaf.name }],
      blend, opacity: blend === 'normal' ? 1 : leaf.opacity, front: leaf.front, keys, label: leaf.name
    });
  }
  const bodies: Record<string, number[]> = {};
  for (const outfit of outfits) for (const pose of poses[outfit]!) {
    const key = bodyKey(outfit, pose);
    bodies[key] = slices.map((slice, index) => slice.keys.includes(key) ? index : -1).filter(index => index >= 0);
  }
  for (const slice of slices) slice.label = slice.sources.length > 1 ? `${slice.sources[0]!.name}…${slice.sources.at(-1)!.name}` : slice.sources[0]!.name;
  return { outfits, poses, slices, bodies, skippedFace, approximated };
}
