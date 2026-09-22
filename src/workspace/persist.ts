import { makeId } from '../core/id.js';
import type { MediaAsset, ReplayLine, ReplayProject } from '../core/types.js';
import type { PreparedSpeech } from '../speech/service.js';
import { speechInputFingerprint, StaleSpeechError } from '../speech/job.js';
import { generatedVoicePath, projectUri } from './layout.js';
import type { PersistedAssetResult, ProjectWorkspace, WorkspaceData } from './types.js';
function assetEdit(asset: MediaAsset): PreparedSpeech['audioEdit'] { return asset.metadata?.audioEdit as PreparedSpeech['audioEdit']; }

function assertPreparedCurrent(project: ReplayProject, line: ReplayLine, prepared: PreparedSpeech): void {
  if (!project.lines.includes(line) || line.text !== prepared.displayText
      || (prepared.inputFingerprint && prepared.inputFingerprint !== speechInputFingerprint(project, line))) {
    throw new StaleSpeechError();
  }
  const bound = project.assets.find(a => a.id === line.audioAssetId);
  if(prepared.audioEdit){
    if((line.audioAssetId ?? null)!==prepared.audioEdit.sourceAssetId || bound?.metadata?.contentRevision!==prepared.audioEdit.sourceRevision)throw new StaleSpeechError('原录音已改变，请重新载入曲线编辑器。');
  }else if (line.audioAssetId && !bound?.metadata?.generated) throw new StaleSpeechError('本句已绑定手工音频，生成结果未覆盖它。');
}

export function generatedSpeechAsset(project: ReplayProject, line: ReplayLine, prepared: PreparedSpeech): MediaAsset {
  assertPreparedCurrent(project, line, prepared);
  if (!prepared.ttsResult) throw new Error('没有可采用的生成音频');
  const character = project.characters.find(c => c.id === line.speakerId);
  if (!character) throw new Error('当前台词角色不存在');
  const previous = !prepared.audioEdit ? project.assets.find(a => a.kind === 'voice' && a.metadata?.generated && a.metadata.generatedLineId===line.id && !a.metadata?.audioEdit
    && !project.assets.some(b=>assetEdit(b)?.sourceAssetId===a.id)) : undefined;
  const revision = makeId('take');
  const mime = prepared.ttsResult.mime || 'audio/wav';
  const path = generatedVoicePath(character, line, mime, revision);
  return {
    id: previous?.id ?? makeId('asset'), kind: 'voice', name: `${character.name} · ${line.id}`,
    uri: projectUri(path), sourcePath: path, mime,
    metadata: { ...previous?.metadata, generated: true, generatedLineId: line.id, characterId: character.id,
      ...(prepared.audioEdit ? {audioEdit:structuredClone(prepared.audioEdit)} : {}),
      ttsProvider: prepared.ttsProvider, targetLanguage: prepared.targetLanguage, speechText: prepared.speechText,
      inputFingerprint: prepared.inputFingerprint, duration: prepared.ttsResult.duration,
      contentRevision: revision, updatedAt: new Date().toISOString() }
  };
}

export function adoptGeneratedSpeechAsset(project: ReplayProject, line: ReplayLine, asset: MediaAsset): void {
  const index = project.assets.findIndex(a => a.id === asset.id);
  if (index < 0) project.assets.push(asset); else project.assets[index] = asset;
  line.audioAssetId = asset.id;
  if(assetEdit(asset)?.kind==='curve-instruct' || assetEdit(asset)?.kind==='restore' || assetEdit(asset)?.resetMouthTiming){
    // A newly performed or restored recording has a different timing reference.
    delete line.mouthCues;
    if(line.mouth==='timed')line.mouth='auto';
  }
}

export async function persistGeneratedSpeech(
  workspace: ProjectWorkspace, project: ReplayProject, line: ReplayLine, prepared: PreparedSpeech
): Promise<PersistedAssetResult | null> {
  if (!prepared.ttsResult) return null;
  const asset = generatedSpeechAsset(project, line, prepared);
  const originalAudioId = line.audioAssetId;
  await workspace.assertProjectCurrent?.();
  // A new revision path protects the previously saved audio if the manifest save conflicts/fails.
  await workspace.write(asset.sourcePath!, prepared.ttsResult.audio, asset.mime);
  assertPreparedCurrent(project, line, prepared);
  if (line.audioAssetId !== originalAudioId) throw new StaleSpeechError();
  const candidate = structuredClone(project);
  adoptGeneratedSpeechAsset(candidate, candidate.lines.find(l => l.id === line.id)!, asset);
  await workspace.saveProject(candidate);
  assertPreparedCurrent(project, line, prepared);
  if (line.audioAssetId !== originalAudioId) throw new StaleSpeechError();
  adoptGeneratedSpeechAsset(project, line, asset);
  return { assetId: asset.id, path: asset.sourcePath! };
}

export async function persistAssetFile(
  workspace: ProjectWorkspace, project: ReplayProject, asset: MediaAsset, data: WorkspaceData, path: string
): Promise<PersistedAssetResult> {
  await workspace.assertProjectCurrent?.();
  await workspace.write(path, data, asset.mime);
  asset.uri = projectUri(path);
  asset.sourcePath = path;
  asset.metadata = { ...asset.metadata, contentRevision: makeId('media'), updatedAt: new Date().toISOString() };
  if (!project.assets.some(item => item.id === asset.id)) project.assets.push(asset);
  await workspace.saveProject(project);
  return { assetId: asset.id, path };
}
