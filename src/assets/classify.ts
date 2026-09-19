import type { AssetKind } from '../core/types.js';

export function classifyAssetPath(path: string): AssetKind {
  const p = path.toLowerCase();
  if (/\b(backgrounds?|bg)\b/.test(p)) return 'background';
  if (/\bcg\b/.test(p)) return 'cg';
  if (/\bbgm\b/.test(p)) return 'bgm';
  if (/\bsfx|sound[ _-]?effects?|se\b/.test(p)) return 'sfx';
  if (/\bvoice|voices|vo\b/.test(p)) return 'voice';
  if (/\bcharacters?|tachie|立绘|立ち絵\b/.test(p)) return 'character';
  return 'other';
}
