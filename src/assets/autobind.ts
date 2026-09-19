import type { MediaAsset, ReplayProject } from '../core/types.js';

function base(path: string): string {
  return path.replace(/\\/g, '/').split('/').at(-1)?.replace(/\.[^.]+$/, '').toLowerCase() ?? '';
}

export interface BindingSuggestion {
  assetId: string;
  target: string;
  confidence: number;
  reason: string;
}

export function suggestAssetBindings(project: ReplayProject): BindingSuggestion[] {
  const out: BindingSuggestion[] = [];
  for (const asset of project.assets) {
    const path = (asset.sourcePath ?? asset.name).replace(/\\/g, '/');
    const lower = path.toLowerCase();
    if (asset.kind === 'character') {
      for (const character of project.characters) {
        if (!lower.includes(character.name.toLowerCase())) continue;
        const kind = /(?:^|[/_.-])blink(?:[/_.-]|$)/.test(lower) ? 'blink' : /(?:^|[/_.-])open(?:[/_.-]|$)/.test(lower) ? 'open' : 'idle';
        out.push({ assetId: asset.id, target: `character:${character.id}:${kind}`, confidence: kind === 'idle' ? .82 : .92, reason: `path contains character name + ${kind}` });
      }
    }
    if (asset.kind === 'voice') {
      const match = base(path).match(/^(\d+)[ _.-]?(.*)$/);
      if (match) {
        const index = Number(match[1]) - 1;
        if (project.lines[index]) out.push({ assetId: asset.id, target: `line:${project.lines[index]!.id}:voice`, confidence: .95, reason: 'numbered voice file' });
      }
    }
  }
  return out.sort((a,b) => b.confidence - a.confidence);
}

export function applyBinding(project: ReplayProject, asset: MediaAsset, target: string): boolean {
  const [kind, id, slot] = target.split(':');
  if (kind === 'character') {
    const character = project.characters.find(c => c.id === id);
    if (!character || !slot || !['idle','open','blink'].includes(slot)) return false;
    character.images[slot as 'idle'|'open'|'blink'] = asset.id;
    return true;
  }
  if (kind === 'line' && slot === 'voice') {
    const line = project.lines.find(l => l.id === id);
    if (!line) return false;
    line.audioAssetId = asset.id;
    return true;
  }
  return false;
}
