import { makeId } from '../core/id.js';
import { createProject } from '../core/project.js';
import type { MediaAsset, ReplayProject } from '../core/types.js';
import type { ImporterRegistry } from './registry.js';
import type { VirtualFile } from './types.js';
import { looksLikeRplGenMediaDef, parseRplGenMediaDef } from './rplgen-mediadef.js';

const LOG_EXT = new Set(['.txt','.log','.html','.htm','.json','.rgl']);
const IMAGE_EXT = new Set(['.png','.jpg','.jpeg','.webp','.gif','.apng']);
const AUDIO_EXT = new Set(['.wav','.mp3','.ogg','.m4a','.flac','.aac']);

function extension(path: string): string {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i).toLowerCase() : '';
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function classifyAsset(path: string): MediaAsset['kind'] {
  const p = path.toLowerCase();
  if (/\b(backgrounds?|bg)\b/.test(p)) return 'background';
  if (/\bcg\b/.test(p)) return 'cg';
  if (/\bbgm\b/.test(p)) return 'bgm';
  if (/\bambient|ambience|amb\b|environment|环境声|氛围声/.test(p)) return 'ambient';
  if (/\bsfx|se\b/.test(p)) return 'sfx';
  if (/\bvoice|voices|vo\b/.test(p)) return 'voice';
  if (/\bcharacters?|tachie|立绘|立ち絵\b/.test(p)) return 'character';
  return 'other';
}

export interface FolderImportResult {
  project: ReplayProject;
  ignored: string[];
}

export async function importVirtualFolder(files: VirtualFile[], registry: ImporterRegistry): Promise<FolderImportResult> {
  const sorted = [...files].sort((a,b) => naturalCompare(a.relativePath, b.relativePath));
  const project = createProject(sorted[0]?.relativePath.split('/')[0] ?? 'Imported replay folder');
  const ignored: string[] = [];
  const assetFiles: VirtualFile[] = [];

  for (const file of sorted) {
    const ext = extension(file.relativePath);
    if (LOG_EXT.has(ext)) {
      const text = await file.text();
      if (looksLikeRplGenMediaDef(text)) {
        const defs = parseRplGenMediaDef(text);
        const existing = new Set((project.mediaDefinitions ?? []).map(def => def.id));
        for (const def of defs) if (!existing.has(def.id)) { project.mediaDefinitions.push(def); existing.add(def.id); }
        continue;
      }
      const importer = registry.choose(text, { sourceName: file.relativePath, mime: file.type });
      if (!importer) { ignored.push(file.relativePath); continue; }
      const partial = importer.parse(text, { title: file.relativePath.replace(/\.[^.]+$/, ''), sourceName: file.relativePath, mime: file.type });
      const firstIndex = project.lines.length;
      const idMap = new Map<string,string>();
      for (const character of partial.characters) {
        let target = project.characters.find(c => c.name === character.name);
        if (!target) { target = { ...character, id: makeId('char') }; project.characters.push(target); }
        idMap.set(character.id, target.id);
      }
      for (const line of partial.lines) {
        project.lines.push({ ...line, id: makeId('line'), speakerId: idMap.get(line.speakerId) ?? line.speakerId });
      }
      const existingDefs = new Set((project.mediaDefinitions ?? []).map(def => def.id));
      for (const def of partial.mediaDefinitions ?? []) if (!existingDefs.has(def.id)) { project.mediaDefinitions.push(structuredClone(def)); existingDefs.add(def.id); }
      if (project.lines[firstIndex]) project.lines[firstIndex]!.chapterTitle = file.relativePath.replace(/\.[^.]+$/, '');
    } else if (IMAGE_EXT.has(ext) || AUDIO_EXT.has(ext)) {
      assetFiles.push(file);
    } else ignored.push(file.relativePath);
  }

  for (const file of assetFiles) {
    project.assets.push({ id: makeId('asset'), kind: classifyAsset(file.relativePath), name: file.name, sourcePath: file.relativePath, mime: file.type });
  }
  return { project, ignored };
}
