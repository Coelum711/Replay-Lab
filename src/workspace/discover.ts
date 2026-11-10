import { makeId } from '../core/id.js';
import type { AssetKind, MediaAsset, ReplayProject } from '../core/types.js';
import { projectUri } from './layout.js';
import type { WorkspaceFileInfo } from './types.js';

/** RPG Maker style: a file dropped into one of these folders shows up as that kind of asset. */
export const ASSET_FOLDER_KINDS: ReadonlyArray<readonly [string, AssetKind]> = [
  ['assets/characters/', 'character'], ['assets/backgrounds/', 'background'], ['assets/cg/', 'cg'],
  ['assets/bgm/', 'bgm'], ['assets/ambient/', 'ambient'], ['assets/sfx/', 'sfx'], ['assets/voice/imported/', 'voice']
];
const AUDIO = { mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/ogg', webm: 'audio/webm' } as Record<string, string>;
const IMAGE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' } as Record<string, string>;
const AUDIO_KINDS = new Set<AssetKind>(['bgm', 'ambient', 'sfx', 'voice']);

export function mimeForPath(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO[ext] ?? IMAGE[ext] ?? null;
}

/** Kind for a project-relative path, or null when the folder is not a watched asset folder. */
export function assetKindForPath(path: string): AssetKind | null {
  const clean = path.replace(/\\/g, '/').replace(/^\.?\//, '');
  return ASSET_FOLDER_KINDS.find(([folder]) => clean.startsWith(folder))?.[1] ?? null;
}

/**
 * Files in the watched folders that no asset points at yet. Hidden files, unknown types and
 * files of the wrong medium (an image in assets/sfx) are skipped.
 */
export function discoverFolderAssets(project: ReplayProject, files: readonly WorkspaceFileInfo[]): MediaAsset[] {
  const known = new Set(project.assets.flatMap(asset => [asset.sourcePath, asset.uri]).filter(Boolean).map(value => String(value).replace(/^project:\/\/?/, '').replace(/\\/g, '/')));
  const out: MediaAsset[] = [];
  for (const file of files) {
    const path = file.path.replace(/\\/g, '/').replace(/^\.?\//, '');
    const name = path.split('/').pop() ?? '';
    if (!name || name.startsWith('.') || known.has(path) || known.has(projectUri(path).replace(/^project:\/\/?/, ''))) continue;
    const kind = assetKindForPath(path);
    const mime = mimeForPath(path);
    if (!kind || !mime || AUDIO_KINDS.has(kind) !== mime.startsWith('audio/')) continue;
    out.push({ id: makeId('asset'), kind, name: name.replace(/\.[^.]+$/, ''), uri: projectUri(path), sourcePath: path, mime,
      metadata: { discoveredInFolder: true, ...(file.size ? { size: file.size } : {}) } });
    known.add(path);
  }
  return out;
}
