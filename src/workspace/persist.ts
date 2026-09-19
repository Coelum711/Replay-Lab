import { makeId } from '../core/id.js';
import type { MediaAsset, ReplayLine, ReplayProject } from '../core/types.js';
import type { PreparedSpeech } from '../speech/service.js';
import type { TtsResult } from '../tts/types.js';
import { generatedVoicePath, projectUri } from './layout.js';
import type { PersistedAssetResult, ProjectWorkspace, WorkspaceData } from './types.js';

function audioPayload(result: TtsResult): WorkspaceData {
  return result.audio;
}

export async function persistGeneratedSpeech(
  workspace: ProjectWorkspace,
  project: ReplayProject,
  line: ReplayLine,
  prepared: PreparedSpeech
): Promise<PersistedAssetResult | null> {
  if (!prepared.ttsResult) return null;
  await workspace.assertProjectCurrent?.();
  const character = project.characters.find(c => c.id === line.speakerId);
  if (!character) throw new Error(`Character not found for line ${line.id}`);
  const mime = prepared.ttsResult.mime || 'audio/wav';
  const path = generatedVoicePath(character, line, mime);
  await workspace.write(path, audioPayload(prepared.ttsResult), mime);

  let asset = project.assets.find(item => item.kind === 'voice' && item.metadata?.generatedLineId === line.id) as MediaAsset | undefined;
  if (!asset) {
    asset = {
      id: makeId('asset'),
      kind: 'voice',
      name: `${character.name} · ${line.id}`,
      uri: projectUri(path),
      sourcePath: path,
      mime,
      metadata: {}
    };
    project.assets.push(asset);
  }
  asset.uri = projectUri(path);
  asset.sourcePath = path;
  asset.mime = mime;
  asset.metadata = {
    ...asset.metadata,
    generated: true,
    generatedLineId: line.id,
    characterId: character.id,
    ttsProvider: prepared.ttsProvider,
    targetLanguage: prepared.targetLanguage,
    speechText: prepared.speechText,
    duration: prepared.ttsResult.duration,
    updatedAt: new Date().toISOString()
  };
  line.audioAssetId = asset.id;
  await workspace.saveProject(project);
  return { assetId: asset.id, path };
}

export async function persistAssetFile(
  workspace: ProjectWorkspace,
  project: ReplayProject,
  asset: MediaAsset,
  data: WorkspaceData,
  path: string
): Promise<PersistedAssetResult> {
  await workspace.assertProjectCurrent?.();
  await workspace.write(path, data, asset.mime);
  asset.uri = projectUri(path);
  asset.sourcePath = path;
  if (!project.assets.some(item => item.id === asset.id)) project.assets.push(asset);
  await workspace.saveProject(project);
  return { assetId: asset.id, path };
}
