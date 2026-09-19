/*
 * Bulk media relocation adapted from RplGenStudio / TRPG-Replay-Generator
 * core/GUI_Relocate.py (GPL-3.0).
 * Original project: https://github.com/DanDDXuanX/TRPG-Replay-Generator
 *
 * Replay Lab keeps the same useful workflow: collect unresolved media, choose
 * one directory, recursively search exact filenames, then apply all matches.
 */
import type { MediaAsset, ReplayProject } from '../core/types.js';

export interface RelinkCandidateFile {
  path: string;
  name?: string;
  size?: number;
}

export type RelinkStatus = 'matched' | 'ambiguous' | 'missing';

export interface MediaRelinkMatch {
  assetId: string;
  assetName: string;
  expectedName: string;
  oldPath?: string;
  status: RelinkStatus;
  matches: RelinkCandidateFile[];
  selectedPath?: string;
}

function baseName(path: string): string {
  const normalized = String(path ?? '').replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function expectedFilename(asset: MediaAsset): string {
  return baseName(asset.name || asset.sourcePath || asset.uri || asset.id);
}

/**
 * Build a relocation plan by exact basename, mirroring RplGen's recursive
 * directory relocation behavior but retaining ambiguities instead of silently
 * taking whichever duplicate filename was encountered last.
 */
export function planMediaRelink(project: ReplayProject, files: Iterable<RelinkCandidateFile>): MediaRelinkMatch[] {
  const byName = new Map<string, RelinkCandidateFile[]>();
  for (const file of files) {
    const filename = (file.name || baseName(file.path)).trim();
    if (!filename) continue;
    const bucket = byName.get(filename) ?? [];
    bucket.push(file);
    byName.set(filename, bucket);
  }

  return project.assets.map(asset => {
    const expectedName = expectedFilename(asset);
    const matches = [...(byName.get(expectedName) ?? [])].sort((a, b) => a.path.localeCompare(b.path));
    return {
      assetId: asset.id,
      assetName: asset.name,
      expectedName,
      oldPath: asset.sourcePath,
      status: matches.length === 1 ? 'matched' : matches.length > 1 ? 'ambiguous' : 'missing',
      matches,
      selectedPath: matches.length === 1 ? matches[0]!.path : undefined
    } satisfies MediaRelinkMatch;
  });
}

export function applyMediaRelinkPlan(
  project: ReplayProject,
  plan: Iterable<MediaRelinkMatch>,
  options: { includeAmbiguousSelections?: boolean } = {}
): number {
  let changed = 0;
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  for (const item of plan) {
    const asset = assets.get(item.assetId);
    if (!asset || !item.selectedPath) continue;
    if (item.status === 'ambiguous' && !options.includeAmbiguousSelections) continue;
    if (asset.sourcePath === item.selectedPath) continue;
    asset.sourcePath = item.selectedPath;
    asset.uri = item.selectedPath.startsWith('assets/') ? `project://${item.selectedPath}` : asset.uri;
    changed += 1;
  }
  return changed;
}
