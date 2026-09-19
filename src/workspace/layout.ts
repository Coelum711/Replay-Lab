import type { AssetKind, ReplayCharacter, ReplayLine } from '../core/types.js';

export const PROJECT_MANIFEST_PATH = 'project.replaylab.json';

export const WORKSPACE_DIRECTORIES = Object.freeze([
  'assets/characters',
  'assets/backgrounds',
  'assets/cg',
  'assets/bgm',
  'assets/ambient',
  'assets/sfx',
  'assets/voice/imported',
  'assets/voice/generated',
  'cache',
  'exports'
]);

export function sanitizePathPart(value: string): string {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
  return (normalized || 'unnamed').slice(0, 96);
}

export function extensionForMime(mime = ''): string {
  const m = mime.toLowerCase();
  if (m.includes('wav')) return 'wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('webm')) return 'webm';
  if (m.includes('flac')) return 'flac';
  if (m.includes('png')) return 'png';
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif')) return 'gif';
  return 'bin';
}

export function assetDirectory(kind: AssetKind): string {
  switch (kind) {
    case 'character': return 'assets/characters';
    case 'background': return 'assets/backgrounds';
    case 'cg': return 'assets/cg';
    case 'bgm': return 'assets/bgm';
    case 'ambient': return 'assets/ambient';
    case 'sfx': return 'assets/sfx';
    case 'voice': return 'assets/voice/imported';
    default: return 'assets/other';
  }
}

export function generatedVoicePath(character: ReplayCharacter, line: ReplayLine, mime = 'audio/wav'): string {
  const charFolder = `${sanitizePathPart(character.name)}__${sanitizePathPart(character.id)}`;
  const ext = extensionForMime(mime);
  return `assets/voice/generated/${charFolder}/${sanitizePathPart(line.id)}.${ext}`;
}

export function projectUri(path: string): string {
  return `project://${path.replace(/^\/+/, '')}`;
}
