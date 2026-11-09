import { makeId } from '../core/id.js';
import type { MediaAsset, ReplayLine, ReplayProject } from '../core/types.js';

/**
 * Voice takes keep earlier generations of a line. The line's bound asset always
 * holds the active take, so switching takes never changes what the line points at.
 */
const TAKE_CONTENT_KEYS = ['ttsProvider', 'targetLanguage', 'speechText', 'inputFingerprint', 'duration', 'mouthCues', 'contentRevision', 'updatedAt'] as const;

export function listVoiceTakes(project: ReplayProject, line: ReplayLine): MediaAsset[] {
  return project.assets
    .filter(asset => asset.kind === 'voice' && asset.metadata?.takeOfLineId === line.id)
    .sort((a, b) => String(b.metadata?.archivedAt ?? '').localeCompare(String(a.metadata?.archivedAt ?? '')));
}

/** Stores the active generated take before it is replaced. Hand-imported audio is left alone. */
export function archiveActiveTake(project: ReplayProject, line: ReplayLine): MediaAsset | null {
  const active = project.assets.find(asset => asset.id === line.audioAssetId);
  if (!active?.sourcePath || !active.metadata?.generated) return null;
  const existing = listVoiceTakes(project, line).find(take => take.sourcePath === active.sourcePath);
  if (existing) return existing;
  const { generatedLineId: _lineId, ...metadata } = active.metadata;
  const take: MediaAsset = {
    ...active,
    id: makeId('take'),
    name: `${active.name} · 历史版本`,
    metadata: { ...metadata, takeOfLineId: line.id, archivedAt: new Date().toISOString() }
  };
  project.assets.push(take);
  return take;
}

/** Makes an archived take active; the previously active take takes its place in the list. */
export function activateVoiceTake(project: ReplayProject, line: ReplayLine, takeId: string): void {
  const active = project.assets.find(asset => asset.id === line.audioAssetId);
  const take = listVoiceTakes(project, line).find(asset => asset.id === takeId);
  if (!active || !take) throw new Error('找不到要切换的配音版本。');
  for (const key of ['uri', 'sourcePath', 'mime'] as const) {
    const value = active[key];
    active[key] = take[key];
    take[key] = value;
  }
  active.metadata ??= {};
  take.metadata ??= {};
  for (const key of TAKE_CONTENT_KEYS) {
    const value = active.metadata[key];
    if (take.metadata[key] === undefined) delete active.metadata[key]; else active.metadata[key] = take.metadata[key];
    if (value === undefined) delete take.metadata[key]; else take.metadata[key] = value;
  }
  take.metadata.archivedAt = new Date().toISOString();
}
