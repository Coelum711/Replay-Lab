import { generatedSpeechAsset, adoptGeneratedSpeechAsset, captureSpeechGuard, StaleSpeechError } from '../dist/index.js';

/**
 * Same-origin pages share one authoring project and one workspace writer.
 * The facade keeps window lifecycle/refresh concerns out of speech providers.
 * It deliberately does not clone a second independently savable project.
 */
export class ProjectLinkHost {
  constructor(options) { Object.assign(this, options); this.version=1; }
  assert(project) {
    if (this.owner.closed || this.getProject()!==project) throw new StaleSpeechError('Studio 已关闭或切换工程；结果未写入新工程。请重新打开声音页。');
  }
  state() { return {project:this.getProject(), workspace:this.getWorkspace(), selectedLineId:this.getSelectedLineId()}; }
  async changed(project, immediate=false) { this.assert(project); return this.onChanged(immediate); }
  async adopt(project,line,prepared) {
    this.assert(project);
    const guard=captureSpeechGuard(project,line),workspace=this.getWorkspace();
    const asset=generatedSpeechAsset(project,line,prepared);
    const blob=new Blob([prepared.ttsResult.audio],{type:prepared.ttsResult.mime});
    if(workspace){
      await workspace.assertProjectCurrent?.();
      await workspace.write(asset.sourcePath,blob,asset.mime);
    }
    this.assert(project);guard();
    if(this.getWorkspace()!==workspace)throw new StaleSpeechError('保存目录已切换；音频没有写入新目录。');
    adoptGeneratedSpeechAsset(project,line,asset);
    this.putAudio(asset.id,blob);
    const saved=await this.changed(project,true);
    return {assetId:asset.id,path:asset.sourcePath,saved:!workspace||saved};
  }
}
