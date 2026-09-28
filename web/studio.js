import { StageDirectEditorController } from './stage-editor-controller.js';
import { SceneViewportController } from './scene-viewport-controller.js';
import { CameraDirectEditorController } from './camera-editor-controller.js';
import { CharacterIdentityController } from './character-identity-controller.js';
import { FacePackageController } from './face-package-controller.js';
import { FaceFitController, FACE_FEATURE_LABELS, FACE_BASIC_FEATURES, FACE_SPLIT_FEATURES, faceFeatureEditorMarkup } from './face-fit-controller.js';
import { CharacterSpeechController } from './character-speech-controller.js';
import { ProjectLinkHost } from './project-link.js';
import { diagnoseWorkspaceAssets } from './workspace-diagnostics.js';
import { createExportSession } from './export-session.js';
import './desktop-client.js';
import { VirtualScriptList } from './virtual-script-list.js';
import { CustomObjectEditorController } from './custom-object-editor-controller.js';
import { AudioWorkbenchController } from './audio-workbench-controller.js';
import {
  createDefaultImporterRegistry,
  importVirtualFolder,
  compilePerformance,
  exportPerformanceJson,
  exportYmmScript,
  exportCsvScript,
  exportTyranoScript,
  BrowserFileSystemWorkspace,
  isWorkspaceConflictError,
  CanvasStageRenderer,
  BrowserReplayPlayer,
  locatePerformanceLine,
  makeId,
  assetDirectory,
  sanitizePathPart,
  persistAssetFile,
  ProjectHistory,
  buildScriptOutline,
  searchReplayLines,
  applyBatchEdit,
  copyPerformanceSettings,
  pastePerformanceSettings,
  applyPerformancePatch,
  BUILTIN_PERFORMANCE_PRESETS,
  diagnoseProject,
  collectReferencedAssetRefs,
  collectScriptCharacterIds,
  buildScriptRenderRows,
  buildDirectorBeats,
  setDirectorBeatTiming,
  moveOutlineGroup,
  effectiveOutlineAt,
  renameChapter,
  renameScene,
  splitChapterAt,
  splitSceneAt,
  mergeSceneWithPrevious,
  mergeChapterWithPrevious,
  moveLinesBeforeStructureAware,
  moveLinesOneStepStructureAware,
  deleteLinesStructureAware,
  moveSceneToChapter,
  outlineGroupLineIds,
  duplicateOutlineGroup,
  deleteOutlineGroup,
  planMediaRelink,
  IndexedDbProjectRecoveryStore,
  createProject,
  normalizeReplayProject,
  createCharacter,
  createCustomObject,
  createLine,
  createFaceTemplate,
  faceTemplateLayerSubset,
  defaultFaceFit,
  normalizeFaceFit,
  orientationLabel,
  projectFaceFeature,
  unprojectFaceFeatureX,
  FACE_TEMPLATE_LAYER_SLOTS,
  FACE_TEMPLATE_NAMING_EXAMPLES,
  planFaceTemplateBindings,
  normalizeCharacterNameKey,
  searchAccents,
  getAccentProfile,
  resolveSpeechPauseScale,
  normalizePuppetRig,
  setExpressionLatticeWarp,
  expressionLatticeWarp,
  zeroLatticeOffsets,
  parseStoryScript,
  reimportScriptPreservingSetup,
  appendWheelHistoryToProject,
  VNReplayRuntime,
  parseDirectorCommand,
  formatDirectorCommand,
  CustomObjectInteractionController,
  bakeCustomObjectInteractionTake,
  buildAudioSchedule
} from '../dist/index.js';

const $ = selector => document.querySelector(selector);
if(!window.name)window.name='replaylab-studio';
const registry = createDefaultImporterRegistry();
let project = null;
let performanceDoc = null;
let selectedIndex = 0;
let selectedBeatId = null;
let stageDirectEditor = null;
let cameraDirectEditor = null;
let sceneViewport = null;
let playbackCursorTime = 0;
let workspace = null;
let workspaceConflict = false;
let workspaceSummary = { media: null, projectSaved: false };
let renderer = null;
let player = null;
let stageMiniObserver = null;
let stageMiniRaf = 0;
let stageMiniVisible = false;
let stageMiniLastFrame = 0;
let playtestRenderer = null;
let playtestMediaPlayer = null;
let playtestRuntime = null;
let playtestObjectInteraction = null;
let playtestObjectDrag = null;
let playtestRecordingPending = false;
let playtestObjectHintTimer = null;
let playtestOriginIndex = 0;
let saveTimer = null;
let editVersion = 0;
const runtimeFiles = new Map();
const history = new ProjectHistory({limit:120,coalesceMs:750});
const recoveryStore = new IndexedDbProjectRecoveryStore();
const voiceHost = new ProjectLinkHost({
  owner:window, getProject:()=>project, getWorkspace:()=>workspace,
  getSelectedLineId:()=>currentLine()?.id,
  putAudio:(id,blob)=>runtimeFiles.set(id,blob), readAudio:id=>resolveAsset(id),
  async onChanged(immediate){
    scheduleSave('声音工作台修改','voice-workbench');
    invalidateMediaCaches();renderAll();
    return immediate ? await saveIfConnected() : true;
  }
});
let voiceWindow=null;
function openVoiceWorkbench(){
  if(!voiceWindow||voiceWindow.closed)voiceWindow=window.open('./index.html','replaylab-voice');
  if(!voiceWindow){$('#importStatus').textContent='浏览器拦截了声音窗口，请允许本机页面弹出窗口。';return;}
  if(typeof voiceWindow.__connectReplayLabHost==='function')voiceWindow.__connectReplayLabHost(voiceHost);
  voiceWindow.focus();
}
window.addEventListener('message',event=>{
  if(event.origin===location.origin&&event.source===voiceWindow&&event.data?.type==='replaylab:voice-ready'){
    voiceWindow.__connectReplayLabHost?.(voiceHost);
  }
});
let recoveryTimer = null;
let recoverySnapshot = null;
const selectedLineIds = new Set();
const collapsedGroups = new Set();
let searchHits = [];
let searchCursor = -1;
let lastSelectionIndex = null;
let performanceClipboard = null;
let activeView = 'script';
let selectedCharacterId = null;
let characterBrowser = { projectId: null, query: '', kind: '', scrollTop: 0 };
let scriptVirtualList = null;
let objectEditors = [];
let audioWorkbench = null;
let virtualRenderToken = 0;
const VIRTUAL_THRESHOLD = 300;
const TANSTACK_VIRTUAL_MODULE = 'https://cdn.jsdelivr.net/npm/@tanstack/virtual-core@3.17.9/+esm';
const MEDIABUNNY_BROWSER_MODULE = 'https://cdn.jsdelivr.net/npm/mediabunny@1.56.0/+esm';
const UI_PREFS_KEY='replaylab-studio-ui-v2';
let uiPrefs={advanced:false,activeView:'script',layout:'edit',leftWidth:310,rightWidth:390,characterUsedOnly:false,workbenchTab:'performance',workbenchSize:'standard',contextTab:'properties',disclosures:{}};
try{uiPrefs={...uiPrefs,...JSON.parse(localStorage.getItem(UI_PREFS_KEY)||'{}'),disclosures:{...(JSON.parse(localStorage.getItem(UI_PREFS_KEY)||'{}').disclosures||{})}}}catch{}
if(['script','characters','assets','mediaDefs'].includes(uiPrefs.activeView))activeView=uiPrefs.activeView;
function saveUiPrefs(){try{localStorage.setItem(UI_PREFS_KEY,JSON.stringify(uiPrefs))}catch{}}
function clampNumber(value,min,max){return Math.max(min,Math.min(max,Number(value)||0))}
function applyLayoutPrefs(){
  uiPrefs.leftWidth=clampNumber(uiPrefs.leftWidth||310,240,520);
  uiPrefs.rightWidth=clampNumber(uiPrefs.rightWidth||390,300,560);
  if(!['normal','edit','stage','output'].includes(uiPrefs.layout))uiPrefs.layout='edit';
  document.documentElement.style.setProperty('--left-panel',`${uiPrefs.leftWidth}px`);
  document.documentElement.style.setProperty('--right-panel',`${uiPrefs.rightWidth}px`);
  document.body.classList.remove('layout-edit','layout-stage','layout-output');
  if(uiPrefs.layout==='edit')document.body.classList.add('layout-edit');
  if(uiPrefs.layout==='stage')document.body.classList.add('layout-stage');
  if(uiPrefs.layout==='output')document.body.classList.add('layout-output');
  if($('#layoutMode'))$('#layoutMode').value=uiPrefs.layout;
}
function setLayoutMode(mode){uiPrefs.layout=mode;applyLayoutPrefs();syncCenterContext();saveUiPrefs()}
function bindSplitter(id,side){
  const el=$(id);if(!el)return;
  let startX=0,startWidth=0;
  const move=e=>{const delta=e.clientX-startX;uiPrefs[side==='left'?'leftWidth':'rightWidth']=clampNumber(startWidth+(side==='left'?delta:-delta),side==='left'?240:300,side==='left'?520:560);applyLayoutPrefs()};
  const up=e=>{el.classList.remove('dragging');el.releasePointerCapture?.(e.pointerId);window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);saveUiPrefs()};
  el.addEventListener('pointerdown',e=>{if(window.innerWidth<=1150)return;startX=e.clientX;startWidth=side==='left'?uiPrefs.leftWidth:uiPrefs.rightWidth;el.classList.add('dragging');el.setPointerCapture?.(e.pointerId);window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)});
  el.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const step=e.shiftKey?30:10;const dir=e.key==='ArrowRight'?1:-1;const key=side==='left'?'leftWidth':'rightWidth';uiPrefs[key]=clampNumber(uiPrefs[key]+(side==='left'?dir:-dir)*step,side==='left'?240:300,side==='left'?520:560);applyLayoutPrefs();saveUiPrefs()});
}
function setAdvancedUi(enabled){uiPrefs.advanced=!!enabled;document.body.classList.toggle('advanced-ui',!!enabled);$('#advancedToggle').checked=!!enabled;if(!enabled&&activeView==='mediaDefs'){setContentView('script')}saveUiPrefs()}
function bindDisclosurePrefs(){for(const details of document.querySelectorAll('details[data-ui-key]')){const key=details.dataset.uiKey;if(Object.prototype.hasOwnProperty.call(uiPrefs.disclosures,key))details.open=!!uiPrefs.disclosures[key];details.addEventListener('toggle',()=>{uiPrefs.disclosures[key]=details.open;if(key==='batch')syncBatchMode();saveUiPrefs()})}}

function escapeHtml(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function has(obj,key){return !!obj&&Object.prototype.hasOwnProperty.call(obj,key)}
function downloadText(name,text,type='text/plain;charset=utf-8'){downloadBlob(name,new Blob([text],{type}))}
function downloadBlob(name,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2500)}
function currentLine(){return project?.lines[selectedIndex]||null}
function currentPerf(){return performanceDoc?.lines[selectedIndex]||null}
function currentBeat(){return selectedBeatId&&project?buildDirectorBeats(project).find(beat=>beat.id===selectedBeatId)||null:null}
function charName(id){return project?.characters.find(c=>c.id===id)?.name||'?'}
function positionLabel(value){return ({auto:'自动',left:'左',center:'中',right:'右'})[value]||value}
function characterKindLabel(value){return ({normal:'角色',npc:'NPC',kp:'KP / GM',system:'系统'})[value]||value}
function mediaTypeLabel(value){return ({text:'文本',richtext:'富文本',image:'图像',bubble:'气泡',balloon:'多标题气泡','dynamic-bubble':'自适应气泡','chat-window':'聊天窗'})[value]||value}
const EXPORT_PRESETS={
  compact:{video:1_200_000,audio:96_000,label:'较小'},
  balanced:{video:2_000_000,audio:128_000,label:'均衡'},
  high:{video:3_500_000,audio:160_000,label:'较高'}
};
function formatBytes(bytes){if(!Number.isFinite(bytes)||bytes<=0)return '—';const units=['B','KB','MB','GB'];let value=bytes,i=0;while(value>=1024&&i<units.length-1){value/=1024;i++}return `${value>=100||i===0?value.toFixed(0):value.toFixed(1)} ${units[i]}`}
function selectedExportPreset(){return EXPORT_PRESETS[$('#exportQuality')?.value]||EXPORT_PRESETS.balanced}
function updateExportEstimate(){const p=selectedExportPreset(),duration=performanceDoc?.duration||0;$('#exportEstimate').textContent=duration?`约 ${formatBytes(duration*(p.video+p.audio)/8)}`:'—'}
function virtualFile(file){return {name:file.name,relativePath:file.webkitRelativePath||file.name,type:file.type,async text(){return await file.text()}}}
function mutationKey(){const el=document.activeElement;return el?.id||el?.dataset?.slot||el?.dataset?.view||'edit'}
function updateHistoryUi(){const state=history.state();$('#undoEdit').disabled=!state.canUndo;$('#redoEdit').disabled=!state.canRedo;$('#historyState').textContent=state.canUndo?`${state.cursor} 步可撤销`:'暂无修改'}
function emitProjectState(){if(project)document.dispatchEvent(new CustomEvent('replaylab:project-state',{detail:{title:project.title,hasContent:!!workspace||project.lines.length>0,connected:!!workspace}}))}
function setSaveStatus(text,tone=''){$('#projectState').textContent=text;$('#projectState').className=`status ${tone}`.trim();emitProjectState()}
function scheduleRecovery(){if(!project)return;clearTimeout(recoveryTimer);recoveryTimer=setTimeout(()=>void saveRecoverySnapshot(),500)}
async function saveRecoverySnapshot(){if(!project)return;const owner=project;try{await recoveryStore.save(project,{label:project.title||'临时工程',workspaceId:workspace?.id||null,workspaceLabel:workspace?.label||null});if(project===owner&&!workspace)setSaveStatus('未保存到文件夹')}catch(error){console.warn('Recovery save failed',error);if(project===owner&&!workspace)setSaveStatus('自动备份失败 · 请保存','warn')}}
function scheduleSave(label='编辑',key=mutationKey()){if(!project)return;editVersion++;history.capture(project,label,key);updateHistoryUi();scheduleRecovery();if(!workspace||workspaceConflict)return;setSaveStatus('有修改待保存','warn');clearTimeout(saveTimer);saveTimer=setTimeout(()=>void saveIfConnected(),350)}
function mediaKinds(){return new Set(['voice','bgm','ambient','sfx'])}
function targetLineIds(){return selectedLineIds.size?[...selectedLineIds]:(currentLine()?[currentLine().id]:[])}
function confirmReplaceCurrent(action='导入'){if(!project?.lines?.length)return true;return confirm(`${action}会替换整个当前工程：${project.lines.length} 行剧本，以及现有角色素材绑定、共享模板和声音/演出设置都会被新导入内容替换。若这些内容需要保留，请取消并勾选“重新导入时保留角色素材 / 声音 / 模板”，或先导出 Project JSON。继续吗？`)}
function preservingSetupOnReimport(){return !!project?.lines?.length&&!!$('#preserveSetupOnReimport')?.checked}
function confirmScriptReimport(action='重新导入剧本'){if(!project?.lines?.length)return true;if(!preservingSetupOnReimport())return confirmReplaceCurrent(action);return confirm(`${action}会替换当前 ${project.lines.length} 行剧本，但保留现有角色、素材、共享脸模板、声音和工程设置；新出现的角色仍会正常创建。此操作可用 Undo 撤销。继续吗？`)}
function applyScriptReimport(imported,label='重新导入剧本'){
  const result=reimportScriptPreservingSetup(project,imported);
  project=normalizeReplayProject(result.project);selectedIndex=0;selectedBeatId=null;selectedLineIds.clear();collapsedGroups.clear();searchCursor=-1;performanceClipboard=null;if(!project.characters.some(c=>c.id===selectedCharacterId))selectedCharacterId=project.characters[0]?.id||null;invalidateMediaCaches();scheduleSave(label,'script-reimport');renderAll();
  const ambiguity=result.report.ambiguousNames.length?` · ${result.report.ambiguousNames.length} 个导入名字有歧义，已保留为独立角色等待确认合并`:'';
  const retained=result.report.unusedRetainedCharacters?` · 另保留 ${result.report.unusedRetainedCharacters} 个当前新剧本未使用的旧角色（素材不会删除）`:'';
  const lineReuse=result.report.reusedLineAuthoring?` · 保留 ${result.report.reusedLineAuthoring} 句已有演出`:'';const commandReuse=result.report.preservedCommands?` · 保留 ${result.report.preservedCommands} 条导演指令`:'';
  $('#importStatus').textContent=`${label}：${result.report.lines} 行 · 复用 ${result.report.reusedCharacters} 个已有角色 · 新建 ${result.report.createdCharacters} 个角色${lineReuse}${commandReuse}${retained}${ambiguity}`;
  $('#importDetails').open=false;
  return result;
}
function syncBatchMode(){document.body.classList.toggle('batch-mode',!!selectedLineIds.size||!!$('#batchDetails')?.open)}
function updateSelectionUi(){const n=selectedLineIds.size;$('#selectionCount').textContent=`${n} 已选`;$('#selectionCount').hidden=!n;$('#batchSummary').textContent=n?`${n} 句已选`:'未选择';$('#selectionTools').hidden=!n;$('#pastePerformanceSelected').disabled=!performanceClipboard||!n;$('#deleteSelected').disabled=!n;$('#applyBatch').disabled=!n;syncBatchMode()}
function refreshSearch(){searchHits=project?searchReplayLines(project,$('#scriptSearch')?.value||''):[];if(searchCursor>=searchHits.length)searchCursor=searchHits.length-1;$('#searchCount').textContent=searchHits.length?`${searchCursor>=0?searchCursor+1:0}/${searchHits.length}`:'0'}
function updateToolbarOptions(){if(!project)return;$('#batchSpeaker').innerHTML='<option value="">角色：不改</option>'+project.characters.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');$('#performancePreset').innerHTML=BUILTIN_PERFORMANCE_PRESETS.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml(p.label)}</option>`).join('')}
function expandForIndex(index){const entry=buildScriptOutline(project.lines)[index];if(!entry)return;collapsedGroups.delete(entry.chapterKey);collapsedGroups.delete(entry.sceneKey)}

async function resolveAsset(ref){
  if(!ref)return null;
  if(/^(data:|blob:|https?:)/i.test(ref))return ref;
  const asset=project?.assets.find(a=>a.id===ref||a.name===ref||a.sourcePath===ref||a.sourcePath?.endsWith('/'+ref));
  if(!asset)return null;
  if(runtimeFiles.has(asset.id))return runtimeFiles.get(asset.id);
  if(workspace&&asset.sourcePath){try{if(await workspace.exists(asset.sourcePath))return await workspace.read(asset.sourcePath)}catch{}}
  if(asset.uri&&!asset.uri.startsWith('project://'))return asset.uri;
  return null;
}

function invalidateMediaCaches(){renderer?.clearAssetCache();player?.clearAudioCache();faceFitController?.clearImageCache()}

async function setProject(next,label=''){
  closePlaytest(); player?.stop(); invalidateMediaCaches(); project=normalizeReplayProject(next); selectedIndex=0;selectedBeatId=null;selectedLineIds.clear();collapsedGroups.clear();searchCursor=-1;performanceClipboard=null;selectedCharacterId=project.characters[0]?.id||null;history.reset(project,label||'打开工程');$('#pastePerformance').disabled=true;
  await saveIfConnected(); scheduleRecovery(); renderAll();
  $('#importStatus').textContent=`${label?label+' · ':''}${project.lines.length} 行 · ${project.characters.length} 角色`;
}

function showWorkspaceConflict(error){
  workspaceConflict=true;clearTimeout(saveTimer);
  $('#projectState').textContent='目录有新版本 · 已暂停保存';$('#projectState').className='status warn';
  $('#reloadWorkspace').hidden=false;$('#saveProject').disabled=true;
  $('#workspaceDetail').textContent=`检测到另一个 Replay Lab 窗口或程序修改了工程目录。为避免覆盖，本页已停止自动保存。若要保留本页改动，请先导出 Project JSON；然后点“重新载入目录版本”。${error?.message?` · ${error.message}`:''}`;
  emitProjectState();
}
async function chooseWorkspace(recentId){
  const previousWorkspace=workspace;
  try{
    const chosen=await BrowserFileSystemWorkspace.choose({recentId:typeof recentId==='string'?recentId:undefined});
    const existing=await chosen.loadProject();
    if(existing&&project?.lines?.length&&!confirm(`所选目录已有工程「${existing.title||'未命名 Replay'}」。打开它会替换当前 ${project.lines.length} 行工程。继续吗？`)){workspace=previousWorkspace;return}
    workspace=chosen;workspaceConflict=false;workspaceSummary={media:null,projectSaved:false};$('#reloadWorkspace').hidden=true;
    if(existing){runtimeFiles.clear();project=normalizeReplayProject(existing);selectedIndex=0;selectedBeatId=null;selectedLineIds.clear();collapsedGroups.clear();performanceClipboard=null;history.reset(project,'打开目录工程')}else if(project){
      await workspace.saveProject(project);
      for(const asset of project.assets){const file=runtimeFiles.get(asset.id);if(!file)continue;const path=`${assetDirectory(asset.kind)}/${asset.id}_${sanitizePathPart(file.name)}`;await persistAssetFile(workspace,project,asset,file,path)}
      await workspace.saveProject(project);
    }
    $('#projectState').textContent='已保存到文件夹';$('#projectState').className='status ok';$('#saveProject').disabled=false;
    await refreshWorkspace();invalidateMediaCaches();renderAll();
  }catch(error){workspace=previousWorkspace;if(isWorkspaceConflictError(error))showWorkspaceConflict(error);else if(error?.name!=='AbortError'){$('#workspaceDetails').open=true;$('#workspaceDetail').textContent=`目录连接失败：${error.message||error}`;setSaveStatus('目录连接失败 · 请重试','warn')}}
}
function renderWorkspaceSummary(){
  if(!workspace)return;
  const media=Number.isFinite(workspaceSummary.media)?`${workspaceSummary.media} 个素材`:'素材统计未刷新';
  $('#workspaceDetail').textContent=`${workspace.label} · ${media} · ${workspaceSummary.projectSaved?'工程已保存':'尚未保存工程文件'}`;
}
async function refreshWorkspace(){
  if(!workspace||workspaceConflict)return;
  const files=await workspace.list();
  workspaceSummary={media:files.filter(f=>f.path.startsWith('assets/')).length,projectSaved:files.some(f=>f.path==='project.replaylab.json')};
  renderWorkspaceSummary();
}
async function saveIfConnected(){
  if(!workspace||!project||workspaceConflict)return false;
  const owner=project,directory=workspace,version=editVersion;
  setSaveStatus('正在保存…');
  try{
    await directory.saveProject(owner);
    if(project!==owner||workspace!==directory)return false;
    // Saving the manifest must stay cheap. Asset counts only change on explicit
    // asset/workspace operations, which already call refreshWorkspace().
    workspaceSummary.projectSaved=true;
    renderWorkspaceSummary();
    setSaveStatus(version===editVersion?'已保存到文件夹':'有修改待保存',version===editVersion?'ok':'warn');
    return true;
  }
  catch(error){if(project!==owner||workspace!==directory)return false;if(isWorkspaceConflictError(error)){showWorkspaceConflict(error);return false}$('#workspaceDetail').textContent=`保存失败：${error.message||error}`;setSaveStatus('保存失败 · 请重试','warn');return false}
}

function compile(){
  if(!project)return;
  $('#projectTitle').value=project.title||'';
  if($('#globalPauseScale')){$('#globalPauseScale').value=String(project.settings.speechPauseScale??1);$('#globalPauseScaleValue').textContent=`${Number(project.settings.speechPauseScale??1).toFixed(1)}×`;}
  if($('#projectSpeechLanguage')) $('#projectSpeechLanguage').value=project.settings.speechLanguage||'auto';
  $('#projectTtsProvider').value=project.settings.ttsProvider||'replaylab-free';
  const ready=project.lines.length>0;
  $('#emptyState').hidden=ready;$('#stageReady').hidden=!ready;if($('#workbench'))$('#workbench').hidden=!ready;$('#exportWebm').disabled=!ready||exportBusy;$('#exportMp4').disabled=!ready||exportBusy;syncCenterContext();
  if(!ready){
    player?.stop();performanceDoc=null;$('#compileState').textContent='等待 Log';$('#compileState').className='status';$('#summary').textContent=`${project.characters.length} 角色 · ${project.assets.length} 素材`;const canvas=$('#stageCanvas'),ctx=canvas?.getContext?.('2d');if(ctx){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#090c12';ctx.fillRect(0,0,canvas.width,canvas.height)}renderState();updateDiagnosticsSummary();return;
  }
  try{
    performanceDoc=compilePerformance(project);
    $('#compileState').textContent='预览就绪';$('#compileState').className='status ok';
  }catch(error){
    performanceDoc=null;$('#compileState').textContent='需要检查';$('#compileState').className='status warn';$('#stateOutput').textContent=error.stack||error.message;$('#exportWebm').disabled=true;updateDiagnosticsSummary();return;
  }
  $('#summary').textContent=`${project.lines.length} 行 · ${performanceDoc.duration.toFixed(1)}s`;updateExportEstimate();
  if(!renderer){
    renderer=new CanvasStageRenderer({canvas:$('#stageCanvas'),performance:performanceDoc,resolveAsset});
    player=new BrowserReplayPlayer(performanceDoc,renderer,resolveAsset,{
      onTime(time,lineIndex){
        playbackCursorTime=time;const changed=lineIndex!==selectedIndex;selectedIndex=lineIndex;if(changed)selectedBeatId=null;
        $('#seek').value=performanceDoc.duration?Math.round(time/performanceDoc.duration*1000):0;
        $('#timeLabel').textContent=`${time.toFixed(1)} / ${performanceDoc.duration.toFixed(1)}s`;
        $('#linePosition').textContent=`${selectedIndex+1} / ${project.lines.length}`;
        if(changed){renderScript();renderInspector();renderVoiceLineWorkbench();audioWorkbench?.render();renderState()}else audioWorkbench?.updatePlayhead(time)
      },
      onStop(){setPlaybackButtons(false)}
    });
  }else{renderer.setPerformance(performanceDoc);player.setPerformance(performanceDoc)}
  renderState();updateDiagnosticsSummary();
}
function setPlaybackButtons(playing){$('#playLine').disabled=playing;$('#playAll').disabled=playing;$('#stopPlay').disabled=!playing}

function drawStageMiniPreview(){
  if(!stageMiniVisible)return;
  const source=$('#stageCanvas'),target=$('#stageMiniCanvas');
  if(!source||!target)return;
  const ctx=target.getContext('2d');
  if(!ctx)return;
  ctx.clearRect(0,0,target.width,target.height);
  ctx.fillStyle='#090c12';ctx.fillRect(0,0,target.width,target.height);
  try{ctx.drawImage(source,0,0,target.width,target.height)}catch{}
}
function stageMiniLoop(time=0){
  if(!stageMiniVisible){stageMiniRaf=0;return}
  if(time-stageMiniLastFrame>=33){stageMiniLastFrame=time;drawStageMiniPreview()}
  stageMiniRaf=requestAnimationFrame(stageMiniLoop);
}
function setStageMiniVisible(visible){
  const host=$('#stageMiniPreview');if(!host)return;
  stageMiniVisible=Boolean(visible);
  host.hidden=!stageMiniVisible;
  if(stageMiniVisible){drawStageMiniPreview();if(!stageMiniRaf)stageMiniRaf=requestAnimationFrame(stageMiniLoop)}
  else if(stageMiniRaf){cancelAnimationFrame(stageMiniRaf);stageMiniRaf=0}
}
function initStageMiniPreview(){
  const stageWrap=document.querySelector('.stage-wrap'),ready=$('#stageReady');
  if(!stageWrap||!ready||typeof IntersectionObserver==='undefined')return;
  stageMiniObserver?.disconnect?.();
  stageMiniObserver=new IntersectionObserver(entries=>{
    const entry=entries[0];
    const rendered=stageWrap.getClientRects().length>0&&!ready.hidden&&Boolean(project?.lines?.length);
    setStageMiniVisible(rendered&&!entry.isIntersecting);
  },{threshold:.08});
  stageMiniObserver.observe(stageWrap);
}

function makeScriptHeader(row){
  const wrap=document.createElement('div');wrap.className='outline-head'+(row.kind==='scene'?' scene':'');wrap.dataset.groupKey=row.key;
  wrap.innerHTML=`<button class="head-toggle"><span>${row.collapsed?'▸':'▾'}</span> <strong>${escapeHtml(row.kind==='chapter'?'# '+row.label:'§ '+row.label)}</strong></button><span class="muted">${row.kind==='chapter'?'Chapter':'Scene'}</span><div class="outline-actions"><button data-up class="small" title="整块上移">↑</button><button data-down class="small" title="整块下移">↓</button></div><span></span>`;
  wrap.querySelector('.head-toggle').onclick=()=>{collapsedGroups.has(row.key)?collapsedGroups.delete(row.key):collapsedGroups.add(row.key);renderScript()};
  wrap.querySelector('[data-up]').onclick=()=>moveGroupFromHeader(row,-1);
  wrap.querySelector('[data-down]').onclick=()=>moveGroupFromHeader(row,1);
  return wrap;
}

function makeScriptBeat(row){
  const beat=buildDirectorBeats(project).find(item=>item.id===row.key);
  const wrap=document.createElement('div');wrap.className='outline-head beat'+(row.active?' active':'')+(row.selected?' multi':'')+(selectedBeatId===row.key?' beat-selected':'');wrap.dataset.groupKey=row.key;
  wrap.innerHTML=`<button class="head-toggle beat-toggle"><span>${row.collapsed?'▸':'▾'}</span> <strong>演出 ×${row.count}</strong></button><span class="text beat-select" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span><span class="muted">${beat?.timingMode==='parallel'?'同时':'顺序'}</span><span></span>`;
  wrap.querySelector('.beat-toggle').onclick=e=>{e.stopPropagation();collapsedGroups.has(row.key)?collapsedGroups.delete(row.key):collapsedGroups.add(row.key);renderScript()};
  const selectBeat=()=>{player?.stop();selectedBeatId=row.key;const targetIndex=beat?.targetLineId?project.lines.findIndex(line=>line.id===beat.targetLineId):-1;selectedIndex=targetIndex>=0?targetIndex:row.lineIndex;renderAll();};
  wrap.querySelector('.beat-select').onclick=selectBeat;wrap.onclick=e=>{if(e.target.closest('.beat-toggle'))return;selectBeat()};
  wrap.ondragover=e=>{const ids=draggedLineIds(e);if(!ids.length||!ids.every(id=>project.lines.find(line=>line.id===id)?.type==='command'))return;e.preventDefault();e.dataTransfer.dropEffect='move';wrap.classList.add('drop-target')};
  wrap.ondragleave=()=>wrap.classList.remove('drop-target');
  wrap.ondrop=e=>{e.preventDefault();wrap.classList.remove('drop-target');const ids=draggedLineIds(e);if(!beat||!ids.length||!ids.every(id=>project.lines.find(line=>line.id===id)?.type==='command'))return;const beforeId=beat.targetLineId||project.lines[beat.endIndex+1]?.id||null;if(moveLinesBeforeStructureAware(project,ids,beforeId)){for(const id of ids){const line=project.lines.find(item=>item.id===id);if(line?.command)line.command.beatMode=beat.timingMode}keepSelectionAfterReorder(ids);selectedBeatId=row.key;scheduleSave('指令加入演出 Beat','beat-drop');renderAll()}};
  return wrap;
}
function makeScriptLine(rowData){
  const index=rowData.lineIndex,line=project.lines[index];
  const isCommand=line.type==='command';
  const row=document.createElement('div');row.className='line-item'+(isCommand?' command':'')+(rowData.active?' active':'')+(rowData.selected?' multi':'')+(rowData.hit?' hit':'');row.tabIndex=0;row.draggable=true;row.dataset.lineId=line.id;
  const speakerLabel=isCommand?'◆ 指令':charName(line.speakerId);
  row.innerHTML=`<label class="mini-check"><input type="checkbox" aria-label="选择第 ${index+1} 行" ${rowData.selected?'checked':''}></label><span>${index+1}</span><b title="${escapeHtml(speakerLabel)}">${escapeHtml(speakerLabel)}</b><span class="text" title="${escapeHtml(line.text)}">${escapeHtml(line.text)}</span>`;
  const check=row.querySelector('input');check.onclick=e=>{e.stopPropagation();if(e.shiftKey&&lastSelectionIndex!==null){const a=Math.min(lastSelectionIndex,index),b=Math.max(lastSelectionIndex,index);for(let i=a;i<=b;i++)selectedLineIds.add(project.lines[i].id)}else if(check.checked)selectedLineIds.add(line.id);else selectedLineIds.delete(line.id);lastSelectionIndex=index;updateSelectionUi();renderScript()};
  const activate=()=>{player?.stop();selectedBeatId=null;selectedIndex=index;renderAll();scrollActiveLineIntoView()};row.onclick=e=>{if(e.target.closest('input'))return;activate()};row.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();activate()}};
  row.ondragstart=e=>{if(!selectedLineIds.has(line.id)){selectedLineIds.clear();selectedLineIds.add(line.id);updateSelectionUi()}row.classList.add('dragging');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/replay-line-ids',JSON.stringify([...selectedLineIds]))};
  row.ondragend=()=>{row.classList.remove('dragging');document.querySelectorAll('.drop-target').forEach(x=>x.classList.remove('drop-target'))};
  row.ondragover=e=>{e.preventDefault();e.dataTransfer.dropEffect='move';row.classList.add('drop-target')};row.ondragleave=()=>row.classList.remove('drop-target');
  row.ondrop=e=>{e.preventDefault();row.classList.remove('drop-target');const ids=draggedLineIds(e);if(moveLinesBeforeStructureAware(project,ids,line.id)){keepSelectionAfterReorder(ids);scheduleSave('拖拽重排台词','line-reorder');renderAll()}};
  return row;
}
function makeDropEnd(){const end=document.createElement('div');end.className='drop-end';end.textContent='拖到这里移到剧本末尾';end.ondragover=e=>{e.preventDefault();end.classList.add('drop-target')};end.ondragleave=()=>end.classList.remove('drop-target');end.ondrop=e=>{e.preventDefault();end.classList.remove('drop-target');const ids=draggedLineIds(e);if(moveLinesBeforeStructureAware(project,ids,null)){keepSelectionAfterReorder(ids);scheduleSave('拖拽重排台词','line-reorder');renderAll()}};return end}
function makeScriptRow(row){if(row.kind==='drop-end')return makeDropEnd();if(row.kind==='line')return makeScriptLine(row);if(row.kind==='beat')return makeScriptBeat(row);return makeScriptHeader(row)}
function scrollActiveLineIntoView(){
  const key=currentLine()?.id;if(!key)return;
  if(scriptVirtualList?.scrollToKey(key,'auto'))return;
  document.querySelector(`[data-line-id="${CSS.escape(key)}"]`)?.scrollIntoView({block:'nearest'});
}
function renderScriptFull(rows){
  scriptVirtualList?.destroy();scriptVirtualList=null;const host=$('#scriptView');host.innerHTML='';host.style.height='';
  const fragment=document.createDocumentFragment();for(const row of rows)fragment.append(makeScriptRow(row));fragment.append(makeDropEnd());host.append(fragment);$('#virtualStatus').textContent=rows.length>150?'长 Log · 浏览器优化':'  ';
}
async function renderScriptVirtual(rows,token){
  const host=$('#scriptView'),viewport=$('#scriptViewport');
  if(!scriptVirtualList)scriptVirtualList=new VirtualScriptList(viewport,host,makeScriptRow,{moduleSpecifier:TANSTACK_VIRTUAL_MODULE,overscan:14});
  try{await scriptVirtualList.setRows([...rows,{kind:'drop-end',key:'__drop_end__',estimateSize:40}]);if(token!==virtualRenderToken)return;$('#virtualStatus').textContent=`长 Log 模式 · 仅渲染可见行`;}
  catch(error){console.warn('TanStack Virtual unavailable, falling back to full DOM list.',error);if(token!==virtualRenderToken)return;renderScriptFull(rows);$('#virtualStatus').textContent='长 Log · 离线兼容模式';}
}
function renderScript(){
  const host=$('#scriptView');if(!project){host.innerHTML='';return}
  const rows=buildScriptRenderRows(project,{collapsedGroups,selectedLineIds,activeIndex:selectedIndex,searchHits});
  const token=++virtualRenderToken;
  if(rows.length>=VIRTUAL_THRESHOLD){host.innerHTML='<div class="muted">正在启用长 Log 模式…</div>';void renderScriptVirtual(rows,token)}else renderScriptFull(rows);
}
function draggedLineIds(event){try{const parsed=JSON.parse(event.dataTransfer.getData('text/replay-line-ids')||'[]');return Array.isArray(parsed)&&parsed.length?parsed:[...selectedLineIds]}catch{return [...selectedLineIds]}}
function keepSelectionAfterReorder(ids){const currentId=currentLine()?.id;selectedLineIds.clear();for(const id of ids)selectedLineIds.add(id);const first=project.lines.findIndex(line=>selectedLineIds.has(line.id));if(first>=0)selectedIndex=first;else if(currentId){const idx=project.lines.findIndex(line=>line.id===currentId);if(idx>=0)selectedIndex=idx}}
function moveGroupFromHeader(row,direction){const currentId=project.lines[row.lineIndex]?.id;if(!currentId)return;if(moveOutlineGroup(project,row.lineIndex,row.kind,direction)){const idx=project.lines.findIndex(line=>line.id===currentId);selectedIndex=Math.max(0,idx);scheduleSave(`${row.kind==='chapter'?'Chapter':'Scene'} 整块移动`,'outline-reorder');renderAll()}}

function imageAssetOptions(value){
  const assets=project.assets.filter(a=>a.kind==='character');
  return `<option value="">未绑定</option>`+assets.map(a=>`<option value="${escapeHtml(a.id)}" ${a.id===value?'selected':''}>${escapeHtml(a.name)}</option>`).join('');
}

function templateAssetOptions(value,disabled=false){
  const html=`<option value="">未绑定</option>`+project.assets.filter(a=>a.kind==='character').map(a=>`<option value="${escapeHtml(a.id)}" ${a.id===value?'selected':''}>${escapeHtml(a.name)}</option>`).join('');
  return disabled ? html.replace('<select','<select disabled') : html;
}

function faceTemplateOptions(value){
  return `<option value="">不使用</option>`+project.faceTemplates.map(t=>`<option value="${escapeHtml(t.id)}" ${t.id===value?'selected':''}>${escapeHtml(t.name)}</option>`).join('');
}

function bindTemplateLayerSet(container,set,slots){
  for(const slot of slots){const select=container.querySelector(`[data-template-slot="${slot}"]`);if(!select)continue;select.onchange=()=>{if(!set)return;set[slot]=select.value||null;invalidateMediaCaches();scheduleSave('修改共享脸部模板',`face-template:${slot}`);renderAll()}}
}

const faceFitController=new FaceFitController({
  resolveAsset,
  defaultFaceFit,
  projectFaceFeature,
  unprojectFaceFeatureX,
  scheduleSave,
  onPreviewChange:()=>{compile();renderState();void renderPreviewStatic()}
});

function bindImageSet(container,character,set,slots){
  for(const slot of slots){const select=container.querySelector(`[data-slot="${slot}"]`);if(!select)continue;select.onchange=()=>{set[slot]=select.value||null;invalidateMediaCaches();scheduleSave();renderAll()}}
}

function bindLayerSet(container,set,slots){
  for(const slot of slots){const select=container.querySelector(`[data-layer-slot="${slot}"]`);if(!select)continue;select.onchange=()=>{set[slot]=select.value||null;invalidateMediaCaches();scheduleSave('修改角色分层素材',`character-layer:${slot}`);renderAll()}}
}
function characterExpressionNames(character){return [...new Set(['default',...Object.keys(character?.layerExpressions||{}),...Object.keys(character?.expressions||{}),...Object.keys(character?.puppet?.expressionPresets||{})])]}


const PUPPET_EXPR_PARAMS=[
  ['eyeSquash','眼睛压扁',0.6,1.25,0.01],
  ['browY','眉毛高度',-1,1,0.02],
  ['browAngle','眉毛角度',-1,1,0.02],
  ['mouthY','嘴巴高度',-1,1,0.02],
  ['mouthTilt','嘴巴倾斜',-1,1,0.02]
];

// Ported from the user's earlier LipSync Studio English mouth inventory.
// Dedicated English mouths are optional; renderer preserves that tool's
// nearest-base fallback when a slot is empty.
const ENGLISH_MOUTH_SLOTS=[
  ['mouthSchwa','ə','about · the','嘴微开放松'],
  ['mouthAe','æ','cat · bad','横向大张'],
  ['mouthUu','ʊ','book · good','小圆、较松'],
  ['mouthOo','ɔ','law · thought','圆、大开'],
  ['mouthW','w','we · want','明显撅圆'],
  ['mouthF','f / v','fish · very','上牙贴下唇'],
  ['mouthTh','th / dh','think · this','舌尖齿间'],
  ['mouthM','m / b / p','mom · bad · put','双唇闭合']
];
function englishMouthGrid(set){return `<div class="layer-grid">${ENGLISH_MOUTH_SLOTS.map(([slot,ipa,example,hint])=>`<label class="muted" title="${escapeHtml(hint)}"><span>${ipa}</span> <span class="summary-meta">${escapeHtml(example)}</span><select data-layer-slot="${slot}">${imageAssetOptions(set[slot])}</select></label>`).join('')}</div><div class="muted">可选。未绑定时沿用旧工具的 fallback：æ→A，ʊ/w→U，ɔ→O，ə/f/th/m→默认闭嘴。</div>`}
function puppetParameter(character,id){character.puppet=normalizePuppetRig(character.puppet);return character.puppet.parameters.find(p=>p.id===id)}
function expressionParamValue(character,expression,id){const p=puppetParameter(character,id);return character.puppet.expressionPresets?.[expression]?.[id]??p?.defaultValue??0}
function bindExpressionParameterControls(container,character,expression){
  character.puppet=normalizePuppetRig(character.puppet);character.puppet.expressionPresets[expression]??={};
  for(const input of container.querySelectorAll('[data-puppet-param]'))input.oninput=()=>{const id=input.dataset.puppetParam;character.puppet.expressionPresets[expression][id]=Number(input.value);const out=container.querySelector(`[data-puppet-value="${CSS.escape(id)}"]`);if(out)out.textContent=Number(input.value).toFixed(2);scheduleSave('调整表情形变',`puppet-param:${character.id}:${expression}:${id}`);compile();renderState()};
}
function bindWarpEditor(container,character,expression){
  const canvas=container.querySelector('[data-warp-canvas]'),partSelect=container.querySelector('[data-warp-part]'),reset=container.querySelector('[data-warp-reset]');if(!canvas||!partSelect)return;
  const ctx=canvas.getContext('2d');let offsets=[],drag=-1;
  const lattice={columns:3,rows:3};
  const load=()=>{character.puppet=normalizePuppetRig(character.puppet);offsets=expressionLatticeWarp(character.puppet,expression,partSelect.value)||zeroLatticeOffsets(lattice);draw()};
  const point=(i)=>{const x=i%3,y=Math.floor(i/3);return {x:24+(x/2+offsets[i].x)*212,y:20+(y/2+offsets[i].y)*142}};
  const draw=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#0c111a';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#34405a';ctx.lineWidth=1;for(let y=0;y<3;y++)for(let x=0;x<2;x++){const a=point(y*3+x),b=point(y*3+x+1);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}for(let x=0;x<3;x++)for(let y=0;y<2;y++){const a=point(y*3+x),b=point((y+1)*3+x);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke()}for(let i=0;i<9;i++){const p=point(i);ctx.beginPath();ctx.arc(p.x,p.y,6,0,Math.PI*2);ctx.fillStyle=i===drag?'#ffd27a':'#7bb6ff';ctx.fill();ctx.strokeStyle='#0a0d13';ctx.stroke()}ctx.fillStyle='#8f9ab1';ctx.font='12px system-ui';ctx.fillText('拖动控制点；舞台预览会使用这个 3×3 lattice',16,181)};
  const locate=e=>{const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)*canvas.width/r.width,y=(e.clientY-r.top)*canvas.height/r.height;let best=-1,dist=9999;for(let i=0;i<9;i++){const p=point(i),d=Math.hypot(p.x-x,p.y-y);if(d<dist){dist=d;best=i}}return dist<18?{i:best,x,y}:null};
  canvas.onpointerdown=e=>{const hit=locate(e);if(!hit)return;drag=hit.i;canvas.setPointerCapture?.(e.pointerId);draw()};
  canvas.onpointermove=e=>{if(drag<0)return;const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)*canvas.width/r.width,y=(e.clientY-r.top)*canvas.height/r.height,baseX=(drag%3)/2,baseY=Math.floor(drag/3)/2;offsets[drag]={x:Math.max(-0.35,Math.min(0.35,(x-24)/212-baseX)),y:Math.max(-0.35,Math.min(0.35,(y-20)/142-baseY))};draw()};
  canvas.onpointerup=e=>{if(drag<0)return;drag=-1;character.puppet=setExpressionLatticeWarp(character.puppet,expression,partSelect.value,offsets,3,3);scheduleSave('拉形变网格',`puppet-warp:${character.id}:${expression}:${partSelect.value}`);compile();renderState();draw();canvas.releasePointerCapture?.(e.pointerId)};
  partSelect.onchange=load;reset.onclick=()=>{offsets=zeroLatticeOffsets(lattice);character.puppet=setExpressionLatticeWarp(character.puppet,expression,partSelect.value,offsets,3,3);scheduleSave('重置形变网格',`puppet-warp:${character.id}:${expression}:${partSelect.value}`);compile();renderState();draw()};load();
}


function faceAutobindPath(file){return file.webkitRelativePath||file.name}
function faceAutobindSlotLabel(slot){
  const labels={
    eyesOpen:'双眼 · 睁开',eyesClosed:'双眼 · 闭眼',eyelidsOpen:'双眼皮 · 睁开',eyelidsClosed:'双眼皮 · 闭眼',pupils:'双瞳孔',brows:'双眉',
    eyeLeftOpen:'画面左眼 · 睁开',eyeLeftClosed:'画面左眼 · 闭眼',eyeRightOpen:'画面右眼 · 睁开',eyeRightClosed:'画面右眼 · 闭眼',
    eyelidLeftOpen:'左眼皮 · 睁开',eyelidLeftClosed:'左眼皮 · 闭眼',eyelidRightOpen:'右眼皮 · 睁开',eyelidRightClosed:'右眼皮 · 闭眼',
    pupilLeft:'左瞳孔',pupilRight:'右瞳孔',browLeft:'画面左眉',browRight:'画面右眉',
    base:'角色底图 / 立绘',mouthClosed:'嘴 · 闭合',mouthOpen:'嘴 · 张开',mouthA:'嘴 A',mouthI:'嘴 I',mouthU:'嘴 U',mouthE:'嘴 E',mouthO:'嘴 O',
    mouthSchwa:'嘴 ə',mouthAe:'嘴 æ',mouthUu:'嘴 ʊ',mouthOo:'嘴 ɔ',mouthW:'嘴 W',mouthF:'嘴 F/V',mouthTh:'嘴 TH/DH',mouthM:'嘴 M/B/P'
  };return labels[slot]||slot
}

function faceAutobindSlotOptions(selected='',includeBase=false){
  const slots=includeBase?['base',...FACE_TEMPLATE_LAYER_SLOTS]:[...FACE_TEMPLATE_LAYER_SLOTS];
  return `<option value="">未指定 / 跳过</option>`+slots.map(slot=>`<option value="${escapeHtml(slot)}" ${slot===selected?'selected':''}>${escapeHtml(faceAutobindSlotLabel(slot))}</option>`).join('');
}
function faceNamingGuideMarkup({packageMode=false}={}){
  const basic=[
    ['eyes_open.png','睁眼'],['eyes_closed.png','闭眼'],['brows.png','眉毛'],['pupils.png','瞳孔'],['mouth_closed.png','闭嘴'],['mouth_open.png','张嘴']
  ];
  const copyLines=packageMode
    ? ['common/eyes_open.png','common/eyes_closed.png','common/brows.png','common/pupils.png','common/mouth_closed.png','common/mouth_open.png','Arthur/base.png','Arthur/brow_left.png']
    : basic.map(([name])=>name);
  return `<div class="face-naming-guide stack"><div class="low-attention-callout"><strong>不用先学规则。</strong><div>直接把图片拖进来；没认出来的文件可以在下一步手动选“这是哪一部分”。</div></div><div><strong>想让它一次认对，最省事就照这 6 个名字：</strong><div class="face-quick-names">${basic.map(([name,label])=>`<span><code>${escapeHtml(name)}</code><small>${escapeHtml(label)}</small></span>`).join('')}</div><button type="button" class="small" data-copy-face-names data-copy-text="${escapeHtml(copyLines.join('\n'))}">复制命名清单</button></div>${packageMode?`<div class="compact-note"><strong>整包导入：</strong><code>common/</code> 放大家共用的脸；角色自己的东西放 <code>角色名/</code>，例如 <code>Arthur/base.png</code>。不想整理目录也没关系，下一步可以手动指定。</div>`:''}<details><summary>我要做 3/4 侧脸 / 更多口型</summary><div class="face-naming-grid disclosure-body">${FACE_TEMPLATE_NAMING_EXAMPLES.filter(item=>!['eyesOpen','eyesClosed','browLeft','browRight','pupils','mouthClosed','mouthOpen'].includes(item.slot)).map(item=>`<div><b>${escapeHtml(item.label)}</b><div>${item.examples.slice(0,2).map(example=>`<code>${escapeHtml(example)}</code>`).join(' / ')}</div></div>`).join('')}<div><b>画面左 / 右</b><div><code>eye_left_open.png</code> / <code>eye_right_open.png</code></div></div><div><b>左右眉</b><div><code>brow_left.png</code> / <code>brow_right.png</code></div></div></div></details></div>`;
}
function bindFaceNamingGuide(root){
  for(const button of root.querySelectorAll('[data-copy-face-names]'))button.onclick=async()=>{const value=button.dataset.copyText||'';try{await navigator.clipboard.writeText(value);button.textContent='已复制 ✓';setTimeout(()=>button.textContent='复制命名清单',1400)}catch{button.textContent='复制失败；可以直接照上面的名字改';setTimeout(()=>button.textContent='复制命名清单',2200)}}
}
function renderFaceAutobindPreview(host,files,plan,template=null){
  host.hidden=false;
  const attentionItems=plan.items.filter(item=>!item.slot||item.conflict||item.confidence<.9||(item.slot&&template?.layers?.[item.slot]));
  const readyItems=plan.items.filter(item=>!attentionItems.includes(item));
  host.innerHTML=`<div class="stack"><div class="row"><strong>检查一下就能用了</strong><span class="status ok">${readyItems.length} 个已自动认好</span>${attentionItems.length?`<span class="status warn">只看这 ${attentionItems.length} 个</span>`:''}</div><div class="low-attention-callout"><strong>${attentionItems.length?'你只需要处理黄色项。':'全部识别完成。'}</strong><div>${attentionItems.length?'绿色项已经选好，不用逐个检查；看不懂原因也没关系，只要给黄色文件选“它是什么”即可。':'直接点下面的“确认并使用这些素材”。'}</div></div>${attentionItems.length?'<div><strong>需要你看</strong><div data-face-autobind-attention class="stack"></div></div>':''}${readyItems.length?`<details><summary>已经认对的 ${readyItems.length} 个（通常不用看）</summary><div data-face-autobind-ready class="stack disclosure-body"></div></details>`:''}<div data-face-autobind-error class="compact-note"></div><div class="row"><button type="button" data-face-autobind-apply class="primary">确认并使用这些素材</button><button type="button" data-face-autobind-cancel class="small">先不导入</button></div></div>`;
  const attention=host.querySelector('[data-face-autobind-attention]'),ready=host.querySelector('[data-face-autobind-ready]');
  for(const item of plan.items){
    const existing=item.slot?template?.layers?.[item.slot]:null;
    const uncertainGuess=!!item.slot&&item.confidence<.9;
    const needsAttention=!item.slot||item.conflict||existing||uncertainGuess;
    const checked=!!item.slot&&!item.conflict&&!existing&&!uncertainGuess;
    const row=document.createElement('div');row.className=`face-autobind-row${needsAttention?' needs-attention':''}${item.conflict||existing?' conflict':''}${!item.slot?' unknown':''}${uncertainGuess?' uncertain':''}`;row.dataset.faceAutobindPath=item.path;row.dataset.faceAutobindOriginalReason=item.reason;
    const reason=!item.slot?'没认出来；请在右边选“它是什么”':existing?'这个位置已经有素材；如果确实要替换，再勾选':item.conflict?'有两张图想放同一个位置；只留一张':uncertainGuess?'大概认出来了，但需要你确认':`已识别为 ${faceAutobindSlotLabel(item.slot)}`;
    row.innerHTML=`<input type="checkbox" data-face-autobind-use ${checked?'checked':''} ${item.slot?'':'disabled'}><span class="face-autobind-file">${escapeHtml(item.path)}</span><span class="face-autobind-arrow">→</span><select aria-label="这张图是什么" data-face-autobind-slot>${faceAutobindSlotOptions(item.slot||'')}</select><span data-face-autobind-note class="summary-meta">${escapeHtml(reason)}</span>`;
    const use=row.querySelector('[data-face-autobind-use]'),slotSelect=row.querySelector('[data-face-autobind-slot]'),note=row.querySelector('[data-face-autobind-note]');
    const refresh=()=>{const slot=slotSelect.value,exists=slot?template?.layers?.[slot]:null;use.disabled=!slot;if(!slot)use.checked=false;row.classList.toggle('unknown',!slot);row.classList.toggle('conflict',!!exists||item.conflict);if(note)note.textContent=!slot?'这张会跳过；想使用就选它是什么':exists?'这个位置已有素材；勾选才会替换':slot!==item.slot?`你指定为：${faceAutobindSlotLabel(slot)}`:reason};
    slotSelect.onchange=()=>{const slot=slotSelect.value,exists=slot?template?.layers?.[slot]:null;if(slot&&!exists&&!item.conflict)use.checked=true;refresh()};
    (needsAttention?attention:ready)?.append(row);refresh();
  }
}
async function applyFaceAutobindSelection(host,files,plan,character,template){
  const rows=[...host.querySelectorAll('.face-autobind-row')],chosen=[];
  for(const row of rows){const use=row.querySelector('[data-face-autobind-use]');if(!use?.checked)continue;const path=row.dataset.faceAutobindPath,slot=row.querySelector('[data-face-autobind-slot]')?.value||'';if(path&&slot)chosen.push({path,slot})}
  const error=host.querySelector('[data-face-autobind-error]');
  if(!chosen.length){if(error)error.textContent='没有选中可应用的绑定。可以先在“绑定到”里手动指定槽位。';return}
  const counts=new Map(),duplicates=[];for(const item of chosen){counts.set(item.slot,(counts.get(item.slot)||0)+1)}for(const [slot,count] of counts)if(count>1)duplicates.push(slot);
  if(duplicates.length){if(error)error.textContent=`同一模板槽位选中了多张素材：${duplicates.map(faceAutobindSlotLabel).join('、')}。请每个槽位只留一张。`;return}
  let target=template;
  if(!target){let i=1,name='脸部模板1';while(project.faceTemplates.some(t=>t.name===name))name=`脸部模板${++i}`;target=createFaceTemplate(name);project.faceTemplates.push(target);character.faceFit.templateId=target.id}
  const fileByPath=new Map(files.map(file=>[faceAutobindPath(file),file]));
  let applied=0;
  for(const item of chosen){
    const file=fileByPath.get(item.path);if(!file)continue;
    const asset={id:makeId('asset'),kind:'character',name:file.name,mime:file.type||'image/png',sourcePath:faceAutobindPath(file),metadata:{faceTemplateSlot:item.slot,autoBound:true}};
    project.assets.push(asset);runtimeFiles.set(asset.id,file);
    if(workspace){const path=`${assetDirectory('character')}/${asset.id}_${sanitizePathPart(file.name)}`;await persistAssetFile(workspace,project,asset,file,path)}
    target.layers[item.slot]=asset.id;applied++;
  }
  invalidateMediaCaches();scheduleSave('自动装配脸部模板',`face-template-autobind:${target.id}`);if(workspace)await refreshWorkspace();selectedCharacterId=character.id;renderAll();$('#importStatus').textContent=`完成：已使用 ${applied} 张脸部素材。下一步：打开“把五官贴到脸上”拖一拖位置；不需要的话也可以直接继续写剧本。`;
}


async function applyFacePackageImport({chosen,files,templateId,templateName,assignTemplate,error}){
  const newCharacterTargets=[...new Set(chosen.filter(item=>item.target.startsWith('new:')).map(item=>item.target))];
  const newCharacterIds=new Map();
  for(const target of newCharacterTargets){const name=target.slice('new:'.length).trim();if(!name)continue;let character=project.characters.find(character=>character.name===name);if(!character){character=createCharacter(name);project.characters.push(character)}newCharacterIds.set(target,character.id)}
  const needsShared=chosen.some(item=>item.target==='shared');let sharedTemplate=null;
  if(needsShared){if(templateId==='__new__'){sharedTemplate=createFaceTemplate(templateName||'共享脸部模板');project.faceTemplates.push(sharedTemplate)}else sharedTemplate=project.faceTemplates.find(template=>template.id===templateId)||null;if(!sharedTemplate){if(error)error.textContent='找不到目标共享模板。';return}}
  const fileByPath=new Map(files.map(file=>[faceAutobindPath(file),file]));const touchedCharacters=new Set();let applied=0;
  for(const item of chosen){const file=fileByPath.get(item.path);if(!file)continue;if(item.target==='shared'&&item.slot==='base')continue;const resolvedTarget=item.target.startsWith('new:')?`character:${newCharacterIds.get(item.target)||''}`:item.target;const asset={id:makeId('asset'),kind:'character',name:file.name,mime:file.type||'image/png',sourcePath:item.path,metadata:{faceTemplateSlot:item.slot,autoBound:true,packageTarget:resolvedTarget}};project.assets.push(asset);runtimeFiles.set(asset.id,file);if(workspace){const path=`${assetDirectory('character')}/${asset.id}_${sanitizePathPart(file.name)}`;await persistAssetFile(workspace,project,asset,file,path)}if(resolvedTarget==='shared')sharedTemplate.layers[item.slot]=asset.id;else{const id=resolvedTarget.slice('character:'.length),character=project.characters.find(character=>character.id===id);if(!character)continue;character.layers[item.slot]=asset.id;touchedCharacters.add(id)}applied++}
  if(sharedTemplate&&assignTemplate){for(const id of touchedCharacters){const character=project.characters.find(character=>character.id===id);if(character)character.faceFit.templateId=sharedTemplate.id}}
  invalidateMediaCaches();scheduleSave('批量装配角色脸部素材包',`face-package-autobind:${sharedTemplate?.id||'overrides'}`);if(workspace)await refreshWorkspace();if(newCharacterIds.size)selectedCharacterId=[...newCharacterIds.values()][0];renderAll();$('#importStatus').textContent=`完成：导入 ${applied} 张角色素材${newCharacterIds.size?`，新建 ${newCharacterIds.size} 个角色`:''}。下一步可以点一个角色检查脸部位置；也可以先不管美术，继续编辑剧本。`;
}

function characterSetupCallout(character,activeFaceTemplate){
  const hasBase=Boolean(character.layers?.base||character.images?.idle);
  const localFaceSlots=['eyesOpen','eyesClosed','pupils','brows','mouthClosed','mouthOpen','eyeLeftOpen','eyeRightOpen','browLeft','browRight'];
  const hasLocalFace=localFaceSlots.some(slot=>character.layers?.[slot]);
  const hasFace=Boolean(activeFaceTemplate||hasLocalFace);
  if(!hasBase)return `<div class="character-path"><strong>现在就能用：占位形象</strong><div>这名角色已经可以写台词、上镜和试玩。立绘、脸部素材、声音都可以以后再补。</div><span class="status ok">不用先做美术</span></div>`;
  if(!hasFace)return `<div class="character-path"><strong>立绘已经能上镜</strong><div>如果底图本身就是完整角色图，到这里就可以停。只有想要自动眨眼 / 口型或共用五官时，才需要下面的脸部素材。</div><span class="status ok">脸部系统可跳过</span></div>`;
  return `<div class="character-path"><strong>脸部素材已启用</strong><div>先看舞台预览：位置看着对就不用再调。只有眼睛 / 眉毛 / 嘴没贴准时，再展开“把五官贴到脸上”。</div><span class="status ok">看着对就停</span></div>`;
}

function renderCharacters(){
  if(characterBrowser.projectId!==project.id)characterBrowser={projectId:project.id,query:'',kind:'',scrollTop:0};
  const host=$('#characterView');host.innerHTML='';
  const usedCharacterIds=collectScriptCharacterIds(project);
  const retainedOnlyCount=Math.max(0,project.characters.length-usedCharacterIds.size);
  const tools=document.createElement('div');tools.className='card stack';tools.innerHTML=`<div class="row"><strong>角色</strong><span class="muted">${project.characters.length} 个 · 当前剧本 ${usedCharacterIds.size} 个</span><button data-face-package-folder class="small" style="margin-left:auto">导入一整包角色图片</button><input data-face-package-files type="file" accept="image/*" webkitdirectory multiple hidden><button data-add-character class="small">+ 角色</button></div><div class="low-attention-callout"><strong>没有立绘也完全没关系。</strong><div>从文字 Log 导入的角色会先用占位形象；不想处理美术时，直接继续写剧本就行。</div></div><div data-face-package-preview class="stack face-package-preview" hidden></div><div class="grid2"><label class="muted">查找角色<input data-character-search placeholder="输入名字"></label><label class="muted">筛选<select data-character-kind><option value="">全部</option><option value="normal">角色</option><option value="npc">NPC</option><option value="kp">KP / GM</option><option value="system">系统</option></select></label></div><label class="checkrow"><input data-character-used-only type="checkbox" ${uiPrefs.characterUsedOnly?'checked':''} ${usedCharacterIds.size?'':'disabled'}><span><strong>只看当前剧本使用的角色</strong><span class="muted" style="display:block">${retainedOnlyCount?`另有 ${retainedOnlyCount} 个角色仅保留素材 / 声音设置；这里可以暂时隐藏，不会删除。`:'当前没有额外保留角色。'}</span></span></label><details><summary>一整包图片怎么命名？</summary><div class="disclosure-body">${faceNamingGuideMarkup({packageMode:true})}</div></details>`;
  tools.querySelector('[data-add-character]').onclick=()=>{let i=1,name='角色1';while(project.characters.some(c=>c.name===name))name=`角色${++i}`;const created=createCharacter(name);project.characters.push(created);selectedCharacterId=created.id;characterBrowser.query='';characterBrowser.kind='';characterBrowser.scrollTop=0;uiPrefs.characterUsedOnly=false;saveUiPrefs();scheduleSave('新增角色','character-add');renderAll()};const packageButton=tools.querySelector('[data-face-package-folder]'),packageInput=tools.querySelector('[data-face-package-files]'),packagePreview=tools.querySelector('[data-face-package-preview]');new FacePackageController({project,escapeHtml,pathOf:faceAutobindPath,slotOptions:faceAutobindSlotOptions,slotLabel:faceAutobindSlotLabel,onApply:applyFacePackageImport}).mount({button:packageButton,input:packageInput,preview:packagePreview});host.append(tools);bindFaceNamingGuide(tools);
  const identityController=new CharacterIdentityController({
      project,
      escapeHtml,
      setStatus: message=>{$('#importStatus').textContent=message},
      onMerged: ({keep,source,result})=>{selectedCharacterId=keep.id;characterBrowser.query='';characterBrowser.kind='';invalidateMediaCaches();scheduleSave('合并重复角色',`character-merge:${keep.id}:${source.id}`);renderAll();$('#importStatus').textContent=`角色合并：${source.name} → ${keep.name} · ${result.linesReassigned} 句台词 · ${result.stageRefsReassigned} 处舞台引用${result.conflicts.length?` · ${result.conflicts.length} 个素材/设置冲突保留了目标角色版本`:''}`},
      onRemoved: result=>{selectedCharacterId=null;invalidateMediaCaches();scheduleSave('删除角色',`character-remove:${result.characterId}`);renderAll();$('#importStatus').textContent=`已删除角色“${result.name}”，素材文件保留。可用顶部“撤销”恢复。`}
    });
  if(!project.characters.length){host.insertAdjacentHTML('beforeend','<div class="muted">还没有角色。导入 Log 会自动创建，或点击上面的“+ 角色”。</div>');return}
  const visibleCharacters=uiPrefs.characterUsedOnly&&usedCharacterIds.size?project.characters.filter(character=>usedCharacterIds.has(character.id)):project.characters;
  if(!project.characters.some(c=>c.id===selectedCharacterId)||!visibleCharacters.some(c=>c.id===selectedCharacterId))selectedCharacterId=visibleCharacters[0]?.id||project.characters[0].id;
  const picker=document.createElement('div');picker.className='character-picker';
  picker.setAttribute('aria-label','角色列表');
  for(const character of project.characters){const b=document.createElement('button');b.type='button';b.className='character-chip small'+(character.id===selectedCharacterId?' active':'');b.title=character.name;b.setAttribute('aria-pressed',String(character.id===selectedCharacterId));b.dataset.characterId=character.id;b.dataset.characterName=[character.name,...(character.aliases||[])].join(' ').toLowerCase();b.dataset.characterKind=character.kind||'normal';b.dataset.scriptUsed=usedCharacterIds.has(character.id)?'1':'0';b.innerHTML=`<span class="character-chip-dot" style="background:${escapeHtml(character.color)}" aria-hidden="true"></span><span class="character-chip-name">${escapeHtml(character.name)}</span>`;b.onclick=()=>{characterBrowser.scrollTop=picker.scrollTop;selectedCharacterId=character.id;renderCharacters()};picker.append(b)}
  const filterCount=document.createElement('div');filterCount.className='muted';filterCount.dataset.characterFilterCount='';filterCount.setAttribute('role','status');
  tools.querySelector('[data-character-search]').value=characterBrowser.query;tools.querySelector('[data-character-kind]').value=characterBrowser.kind;
  const applyCharacterFilter=()=>{characterBrowser.query=tools.querySelector('[data-character-search]').value;characterBrowser.kind=tools.querySelector('[data-character-kind]').value;const query=characterBrowser.query.trim().toLowerCase(),kind=characterBrowser.kind,usedOnly=!!tools.querySelector('[data-character-used-only]')?.checked;let count=0;for(const chip of picker.children){chip.hidden=!!((query&&!chip.dataset.characterName.includes(query))||(kind&&chip.dataset.characterKind!==kind)||(usedOnly&&chip.dataset.scriptUsed!=='1'));if(!chip.hidden)count++}filterCount.textContent=count?`显示 ${count} / ${project.characters.length} 个角色 · 长名字可换行，更多角色向下滚动`:'没有匹配角色，试试清空搜索或更改筛选。'};tools.querySelector('[data-character-search]').oninput=()=>{characterBrowser.scrollTop=0;picker.scrollTop=0;applyCharacterFilter()};tools.querySelector('[data-character-kind]').onchange=applyCharacterFilter;const usedOnlyToggle=tools.querySelector('[data-character-used-only]');if(usedOnlyToggle)usedOnlyToggle.onchange=e=>{uiPrefs.characterUsedOnly=e.target.checked;saveUiPrefs();if(e.target.checked&&usedCharacterIds.size&&!usedCharacterIds.has(selectedCharacterId))selectedCharacterId=project.characters.find(character=>usedCharacterIds.has(character.id))?.id||selectedCharacterId;renderCharacters()};applyCharacterFilter();
  host.append(filterCount,picker);picker.scrollTop=characterBrowser.scrollTop;picker.onscroll=()=>{characterBrowser.scrollTop=picker.scrollTop};
  const cleanup=document.createElement('div');cleanup.className='card stack character-cleanup';host.append(cleanup);identityController.mountActions(cleanup,selectedCharacterId);identityController.mount(host);
  const character=project.characters.find(c=>c.id===selectedCharacterId);if(!character)return;
  character.images??={};character.expressions??={};character.layers??={};character.layerExpressions??={};character.stageFacing??={policy:'flippable',nativeFacing:'left'};character.stageFacing.policy=character.stageFacing.policy==='paired'?'paired':'flippable';character.stageFacing.nativeFacing=['left','right'].includes(character.stageFacing.nativeFacing)?character.stageFacing.nativeFacing:'left';character.stageFacing.variants??={};character.puppet=normalizePuppetRig(character.puppet);character.faceFit=normalizeFaceFit(character.faceFit??defaultFaceFit());
  const activeFaceTemplate=project.faceTemplates.find(t=>t.id===character.faceFit.templateId)||null;
  const templateLayers=activeFaceTemplate?.layers??{};
  const hasVisual=Boolean(character.layers.base||character.images.idle);
  const card=document.createElement('div');card.className='character character-detail';
  card.innerHTML=`
    <div class="grid2"><label class="muted">角色名<input data-name value="${escapeHtml(character.name)}"></label><label class="muted">类型<select data-kind>${['normal','npc','kp','system'].map(v=>`<option value="${v}" ${character.kind===v?'selected':''}>${characterKindLabel(v)}</option>`).join('')}</select></label></div>
    ${characterSetupCallout(character,activeFaceTemplate)}
    <details><summary>身份 / 导入别名 <span class="summary-meta">${(character.aliases||[]).length?`${character.aliases.length} 个`:'可选'}</span></summary><div class="disclosure-body"><label class="muted">别名 / 导入名<input data-aliases value="${escapeHtml((character.aliases||[]).join(', '))}" placeholder="例如 Matthew, 马修"></label><div class="muted">只用于识别同一角色的不同导入名；不会改显示名称，也不会自动翻译角色名。</div></div></details>
    <details><summary>声音 / AI 朗读（可选） <span class="summary-meta" data-character-speech-summary></span></summary><div class="stack disclosure-body"><div class="grid2"><label class="muted">默认朗读语言<input data-character-language list="studioLanguageOptions" value="${escapeHtml(character.speech?.defaultLanguage||'')}" placeholder="留空 = 工程朗读语言"></label><label class="muted">停顿强度 <span data-character-pause-value class="summary-meta"></span><input data-character-pause type="range" min="0" max="3" step="0.1" value="${Number(character.speech?.pauseScale??project.settings.speechPauseScale??1).toFixed(1)}"></label></div><div class="grid2"><label class="muted">口音 / 地区<input data-character-accent value="" placeholder="例如 London / Cockney / Texas / 伦敦"></label><label class="muted">口音强度<select data-character-accent-strength><option value="off">关闭</option><option value="light">轻微</option><option value="natural">自然</option><option value="strong">明显</option></select></label></div><div data-character-accent-results class="stack"></div><div data-character-accent-current class="compact-note"></div><div class="row"><button type="button" data-character-pause-reset class="small">停顿继承全局</button><button type="button" data-character-open-voice class="small">打开声音工作台 / 选 Voice</button></div><div class="muted">常用设置直接放在角色页；完整 Voice 试听、批量生成和高级口音规则在声音工作台。</div></div></details>
    <div class="grid2"><label class="muted">允许自动上镜 <input data-show type="checkbox" ${character.showOnStage?'checked':''}></label><label class="muted">默认站位<select data-pos>${['auto','left','center','right'].map(v=>`<option value="${v}" ${character.defaultPosition===v?'selected':''}>${positionLabel(v)}</option>`).join('')}</select></label></div>
    <label class="row"><input type="checkbox" data-asymmetric-facing ${character.stageFacing.policy==='paired'?'checked':''}><span><strong>这个角色左右不对称</strong><small class="muted" style="display:block">通常不用勾。普通立绘默认可左右镜像；只有伤疤、徽章、眼罩、单侧配件等需要保留方向时，才分别提供左右两版。</small></span></label><div class="muted">未勾选时，舞台上的 ⇆ 只做人工镜像；自动构图不会擅自改变朝向。勾选后改为 L/R 独立素材，系统切换素材而不镜像像素。</div>
    ${character.stageFacing.policy==='paired'?`<div class="card stack paired-facing-assets"><div class="row"><strong>左右独立立绘</strong><span class="muted">未绑定的部分自动继承通用素材</span></div><div class="grid2"><label class="muted">朝画面左 · 角色底图<select data-paired-layer="left:base">${imageAssetOptions(character.stageFacing.variants?.left?.layers?.base)}</select></label><label class="muted">朝画面右 · 角色底图<select data-paired-layer="right:base">${imageAssetOptions(character.stageFacing.variants?.right?.layers?.base)}</select></label></div><details class="advanced-only"><summary>旧式整帧立绘左右版本</summary><div class="grid2 disclosure-body"><label class="muted">朝左 · IDLE<select data-paired-image="left:idle">${imageAssetOptions(character.stageFacing.variants?.left?.images?.idle)}</select></label><label class="muted">朝右 · IDLE<select data-paired-image="right:idle">${imageAssetOptions(character.stageFacing.variants?.right?.images?.idle)}</select></label></div></details><div class="muted">在“可视化摆放”里点 L/R 决定这一时刻使用哪一套；后续行会继承这个方向，系统不会自行交换。</div></div>`:''}
    <div class="grid2"><label class="muted">立绘构图<select data-framing>${[['auto','自动'],['portrait','头像'],['bust','胸像'],['half','半身'],['full','全身']].map(([v,l])=>`<option value="${v}" ${character.puppet.layout.framing===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="muted">角色缩放<input data-puppet-scale type="number" min="0.25" max="3" step="0.05" value="${Number(character.puppet.layout.scale??1).toFixed(2)}"></label></div>
    <details class="advanced-only"><summary>舞台锚点 / 裁切对齐 <span class="summary-meta">${Math.round((character.puppet.layout.anchorX??.5)*100)}% · ${Math.round((character.puppet.layout.anchorY??1)*100)}%</span></summary><div class="grid2 disclosure-body"><label class="muted">锚点 X（0–1）<input data-anchor-x type="number" min="-1" max="2" step="0.01" value="${Number(character.puppet.layout.anchorX??.5).toFixed(2)}"></label><label class="muted">锚点 Y（0–1）<input data-anchor-y type="number" min="-1" max="2" step="0.01" value="${Number(character.puppet.layout.anchorY??1).toFixed(2)}"></label><label class="muted">水平偏移<input data-offset-x type="number" min="-1" max="1" step="0.01" value="${Number(character.puppet.layout.offsetX??0).toFixed(2)}"></label><label class="muted">垂直偏移<input data-offset-y type="number" min="-1" max="1" step="0.01" value="${Number(character.puppet.layout.offsetY??0).toFixed(2)}"></label></div><div class="muted">半身/胸像不需要伪装成全身图。锚点决定这张裁切图在舞台上的对齐位置。</div></details>
    <div class="layer-preview-note"><strong>${hasVisual?'分层角色':'正在使用占位角色'}</strong><div class="muted">${hasVisual?'各层建议使用相同尺寸的透明 PNG/WebP；眼睛、嘴巴会直接覆盖到底图对应位置。':'不需要先找立绘。预览会自动画名字长条、眼睛和嘴巴，口型/眨眼逻辑与正式素材相同。'}</div></div>
    <details><summary>脸部素材（可选） <span class="summary-meta">${activeFaceTemplate?escapeHtml(activeFaceTemplate.name):'没有也能用'}</span></summary><div class="stack disclosure-body"><div class="row"><label class="muted" style="flex:1">当前模板<select data-face-template-select>${faceTemplateOptions(character.faceFit.templateId)}</select></label><button data-face-template-new class="small advanced-only">从当前角色新建模板</button><button data-face-template-delete class="small danger advanced-only" ${activeFaceTemplate?'':'disabled'}>删除模板</button><button data-face-template-autobind class="primary small">选择几张脸部图片</button><button data-face-template-autobind-folder class="small">选择一个脸部文件夹</button><input data-face-template-autobind-files type="file" accept="image/*" multiple hidden><input data-face-template-autobind-folder-files type="file" accept="image/*" webkitdirectory multiple hidden></div>${faceNamingGuideMarkup()}<div data-face-autobind-drop class="face-autobind-drop">也可以把眼睛 / 眉毛 / 嘴图片直接拖到这里。识别不上会让你现场选，不用退出重命名。</div><div data-face-autobind-preview class="stack face-autobind-preview" hidden></div><div class="grid2 advanced-only"><label class="muted">模板名<input data-face-template-name value="${escapeHtml(activeFaceTemplate?.name||'')}" ${activeFaceTemplate?'':'disabled'}></label><label class="muted">说明<input data-face-template-notes value="${escapeHtml(activeFaceTemplate?.notes||'')}" placeholder="可选" ${activeFaceTemplate?'':'disabled'}></label></div><div class="muted advanced-only">模板只管理五官层，不含角色底图。当前角色自己的同类素材会优先覆盖模板。</div><div class="layer-grid advanced-only"><label class="muted">眼睛 · 睁开<select data-template-slot="eyesOpen" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.eyesOpen)}</select></label><label class="muted">眼睛 · 闭眼<select data-template-slot="eyesClosed" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.eyesClosed)}</select></label><label class="muted">眼皮 · 睁开<select data-template-slot="eyelidsOpen" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.eyelidsOpen)}</select></label><label class="muted">眼皮 · 闭眼<select data-template-slot="eyelidsClosed" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.eyelidsClosed)}</select></label><label class="muted">瞳孔<select data-template-slot="pupils" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.pupils)}</select></label><label class="muted">眉毛<select data-template-slot="brows" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.brows)}</select></label><label class="muted">嘴 · 闭合<select data-template-slot="mouthClosed" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.mouthClosed)}</select></label><label class="muted">嘴 · 张开<select data-template-slot="mouthOpen" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.mouthOpen)}</select></label></div><details class="advanced-only"><summary>3/4 侧脸：左右分开 <span class="summary-meta">精修</span></summary><div class="stack disclosure-body"><div class="muted">这里的“左/右”按画面方向，不按角色解剖左右。左右两侧都绑定后才启用独立透视；只绑一侧会继续使用上面的整组素材。</div><div class="layer-grid"><label class="muted">画面左眼 · 睁开<select data-template-slot="eyeLeftOpen" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.eyeLeftOpen)}</select></label><label class="muted">画面右眼 · 睁开<select data-template-slot="eyeRightOpen" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.eyeRightOpen)}</select></label><label class="muted">画面左眼 · 闭眼<select data-template-slot="eyeLeftClosed" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.eyeLeftClosed)}</select></label><label class="muted">画面右眼 · 闭眼<select data-template-slot="eyeRightClosed" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.eyeRightClosed)}</select></label><label class="muted">画面左眉<select data-template-slot="browLeft" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.browLeft)}</select></label><label class="muted">画面右眉<select data-template-slot="browRight" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.browRight)}</select></label></div><details class="subdetails"><summary>左右眼皮 / 瞳孔</summary><div class="layer-grid disclosure-body"><label class="muted">左眼皮 · 睁开<select data-template-slot="eyelidLeftOpen" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.eyelidLeftOpen)}</select></label><label class="muted">右眼皮 · 睁开<select data-template-slot="eyelidRightOpen" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.eyelidRightOpen)}</select></label><label class="muted">左眼皮 · 闭眼<select data-template-slot="eyelidLeftClosed" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.eyelidLeftClosed)}</select></label><label class="muted">右眼皮 · 闭眼<select data-template-slot="eyelidRightClosed" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.eyelidRightClosed)}</select></label><label class="muted">左瞳孔<select data-template-slot="pupilLeft" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.pupilLeft)}</select></label><label class="muted">右瞳孔<select data-template-slot="pupilRight" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers.pupilRight)}</select></label></div></details></div></details><details class="advanced-only"><summary>更多口型 A / I / U / E / O</summary><div class="layer-grid five" style="margin-top:7px">${['A','I','U','E','O'].map(v=>`<label class="muted">${v}<select data-template-slot="mouth${v}" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers['mouth'+v])}</select></label>`).join('')}</div></details><details class="advanced-only"><summary>英语精细口型（可选）</summary><div class="disclosure-body"><div class="layer-grid">${ENGLISH_MOUTH_SLOTS.map(([slot,ipa,example,hint])=>`<label class="muted" title="${escapeHtml(hint)}"><span>${ipa}</span> <span class="summary-meta">${escapeHtml(example)}</span><select data-template-slot="${slot}" ${activeFaceTemplate?'':'disabled'}>${imageAssetOptions(templateLayers[slot])}</select></label>`).join('')}</div></div></details></div></details>
    <details><summary>把五官贴到脸上（位置 / 朝向） <span class="summary-meta">${orientationLabel(character.faceFit.orientation)}</span></summary><div class="stack disclosure-body"><div class="muted">只有用了脸部素材时才需要这里。先直接拖彩色点把眼睛、眉毛和嘴放到脸上；看着对就可以停，不必理解下面的数字。</div><div class="facefit-preview"><canvas data-facefit-canvas width="320" height="380"></canvas><div class="stack"><div class="row"><label class="muted" style="flex:1">当前节点<select data-facefit-selected-feature>${Object.entries(FACE_FEATURE_LABELS).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><button type="button" data-facefit-reset-current class="small">重置当前节点</button><button type="button" data-facefit-reset-all class="small">全部重置</button></div><div data-facefit-status class="muted">—</div><div data-facefit-note class="compact-note">拖拽彩色节点直接移动五官中心。</div></div></div><div class="grid2"><label class="muted">朝向<select data-face-orientation>${[['front','正面'],['left-3q','左 3/4'],['right-3q','右 3/4']].map(([v,l])=>`<option value="${v}" ${character.faceFit.orientation===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="muted">透视强度 <span data-face-perspective-value>${Number(character.faceFit.perspective).toFixed(2)}</span><input data-face-perspective type="range" min="0" max="1" step="0.01" value="${Number(character.faceFit.perspective).toFixed(2)}"></label></div><details class="advanced-only"><summary>精确数值微调</summary><div class="stack disclosure-body">${FACE_BASIC_FEATURES.map(feature=>faceFeatureEditorMarkup(feature,character.faceFit.features[feature])).join('')}</div></details><details class="advanced-only"><summary>3/4 侧脸精确修正</summary><div class="stack disclosure-body"><div class="muted">独立素材启用后，远侧五官会自动向脸中心收并缩小；下面的参数是在自动透视之后继续人工修正。</div>${['leftEye','rightEye','leftBrow','rightBrow'].map(feature=>faceFeatureEditorMarkup(feature,character.faceFit.features[feature])).join('')}<details class="subdetails"><summary>左右瞳孔 / 眼皮</summary><div class="stack disclosure-body">${['leftPupil','rightPupil','leftEyelid','rightEyelid'].map(feature=>faceFeatureEditorMarkup(feature,character.faceFit.features[feature])).join('')}</div></details></div></details></div></details>
    <div class="grid2"><label class="muted">角色底图 / 立绘<select data-layer-slot="base">${imageAssetOptions(character.layers.base)}</select></label><label class="muted">表情覆盖层（可选）<select data-layer-slot="overlay">${imageAssetOptions(character.layers.overlay)}</select></label></div>
    <details><summary>这个角色自己的五官（只有和通用脸不一样时才用）</summary><div class="stack disclosure-body"><div class="compact-note">如果已经用了“脸部素材 / 共用模板”，这里可以全留空。只给这个角色特别的眉毛、眼睛或嘴时才填。</div><div class="layer-grid"><label class="muted">眼睛 · 睁开<select data-layer-slot="eyesOpen">${imageAssetOptions(character.layers.eyesOpen)}</select></label><label class="muted">眼睛 · 闭眼<select data-layer-slot="eyesClosed">${imageAssetOptions(character.layers.eyesClosed)}</select></label><label class="muted">眼皮 · 睁开<select data-layer-slot="eyelidsOpen">${imageAssetOptions(character.layers.eyelidsOpen)}</select></label><label class="muted">眼皮 · 闭眼<select data-layer-slot="eyelidsClosed">${imageAssetOptions(character.layers.eyelidsClosed)}</select></label><label class="muted">瞳孔<select data-layer-slot="pupils">${imageAssetOptions(character.layers.pupils)}</select></label><label class="muted">眉毛<select data-layer-slot="brows">${imageAssetOptions(character.layers.brows)}</select></label><label class="muted">嘴 · 闭合<select data-layer-slot="mouthClosed">${imageAssetOptions(character.layers.mouthClosed)}</select></label><label class="muted">嘴 · 张开<select data-layer-slot="mouthOpen">${imageAssetOptions(character.layers.mouthOpen)}</select></label></div><details class="advanced-only"><summary>3/4 侧脸 / 异色瞳：左右单独覆盖</summary><div class="layer-grid disclosure-body"><label class="muted">画面左眼 · 睁开<select data-layer-slot="eyeLeftOpen">${imageAssetOptions(character.layers.eyeLeftOpen)}</select></label><label class="muted">画面右眼 · 睁开<select data-layer-slot="eyeRightOpen">${imageAssetOptions(character.layers.eyeRightOpen)}</select></label><label class="muted">画面左眼 · 闭眼<select data-layer-slot="eyeLeftClosed">${imageAssetOptions(character.layers.eyeLeftClosed)}</select></label><label class="muted">画面右眼 · 闭眼<select data-layer-slot="eyeRightClosed">${imageAssetOptions(character.layers.eyeRightClosed)}</select></label><label class="muted">画面左眉<select data-layer-slot="browLeft">${imageAssetOptions(character.layers.browLeft)}</select></label><label class="muted">画面右眉<select data-layer-slot="browRight">${imageAssetOptions(character.layers.browRight)}</select></label><label class="muted">画面左瞳孔<select data-layer-slot="pupilLeft">${imageAssetOptions(character.layers.pupilLeft)}</select></label><label class="muted">画面右瞳孔<select data-layer-slot="pupilRight">${imageAssetOptions(character.layers.pupilRight)}</select></label></div></details><details class="advanced-only"><summary>更多口型 A / I / U / E / O</summary><div class="layer-grid five disclosure-body">${['A','I','U','E','O'].map(v=>`<label class="muted">${v}<select data-layer-slot="mouth${v}">${imageAssetOptions(character.layers['mouth'+v])}</select></label>`).join('')}</div></details><details class="advanced-only"><summary>英语精细口型</summary><div class="disclosure-body">${englishMouthGrid(character.layers)}</div></details></div></details>
    <details><summary>表情组件 <span class="summary-meta">${Object.keys(character.layerExpressions).length}</span></summary><div class="muted disclosure-body" style="padding-bottom:6px">表情只需要填写变化的层；没填的眼睛/嘴/底图会继承默认角色。</div><div data-layer-expressions class="stack"></div><button data-add-layer-expression class="small">+ 表情</button></details>
    <details class="advanced-only"><summary>整帧立绘兼容（旧项目） <span class="summary-meta">IDLE / OPEN / BLINK</span></summary><div class="stack disclosure-body"><div class="muted">旧式做法是每个口型/眨眼都准备整张完整立绘。新项目建议使用上面的分层素材。</div><div class="grid3">${['idle','open','blink'].map(slot=>`<label class="muted">${({idle:'IDLE',open:'OPEN',blink:'BLINK'})[slot]}<select data-slot="${slot}">${imageAssetOptions(character.images[slot])}</select></label>`).join('')}</div><details><summary>整帧五元音</summary><div class="grid5" style="margin-top:7px">${['A','I','U','E','O'].map(slot=>`<label class="muted">${slot}<select data-slot="${slot}">${imageAssetOptions(character.images[slot])}</select></label>`).join('')}</div></details></div></details>`;
  card.querySelector('[data-name]').onchange=e=>{const next=e.target.value.trim();if(!next||project.characters.some(c=>c.id!==character.id&&c.name===next)){e.target.value=character.name;return}const old=character.name;character.name=next;for(const line of project.lines)if(line.speakerId===character.id&&line.sourceSpeaker===old)line.sourceSpeaker=next;scheduleSave('重命名角色',`character-name:${character.id}`);renderAll()};
  card.querySelector('[data-aliases]').onchange=e=>{const seen=new Set(),aliases=[];for(const raw of e.target.value.split(/[,，;；\n]+/)){const value=raw.trim(),key=normalizeCharacterNameKey(value);if(!value||!key||key===normalizeCharacterNameKey(character.name)||seen.has(key))continue;seen.add(key);aliases.push(value)}character.aliases=aliases;scheduleSave('修改角色导入别名',`character-aliases:${character.id}`);renderAll()};
  character.speech??={defaultLanguage:null,voices:{},accents:{}};character.speech.voices??={};character.speech.accents??={};
  new CharacterSpeechController({project,escapeHtml,searchAccents,getAccentProfile,normalizeNameKey:normalizeCharacterNameKey,scheduleSave,openVoice:openVoiceWorkbench,setStatus:message=>{$('#importStatus').textContent=message},hasWorkspace:()=>!!workspace}).mount(card,character);
  card.querySelector('[data-kind]').onchange=e=>{character.kind=e.target.value;scheduleSave('修改角色类型',`character-kind:${character.id}`);renderAll()};
  card.querySelector('[data-show]').onchange=e=>{character.showOnStage=e.target.checked;scheduleSave();renderAll()};
  card.querySelector('[data-pos]').onchange=e=>{character.defaultPosition=e.target.value;scheduleSave();renderAll()};
  card.querySelector('[data-asymmetric-facing]').onchange=e=>{character.stageFacing.policy=e.target.checked?'paired':'flippable';character.stageFacing.nativeFacing='left';scheduleSave(e.target.checked?'启用左右不对称立绘':'使用普通可镜像立绘',`character-facing:${character.id}`);renderAll()};
  for(const select of card.querySelectorAll('[data-paired-layer],[data-paired-image]'))select.onchange=e=>{const [direction,slot]=String(e.target.dataset.pairedLayer||e.target.dataset.pairedImage).split(':');character.stageFacing.variants??={};const variant=character.stageFacing.variants[direction]??(character.stageFacing.variants[direction]={images:{},expressions:{},layers:{},layerExpressions:{}});variant.images??={};variant.layers??={};if(e.target.dataset.pairedLayer)variant.layers[slot]=e.target.value||null;else variant.images[slot]=e.target.value||null;invalidateMediaCaches();scheduleSave('修改左右独立立绘',`character-facing-variant:${character.id}:${direction}`);renderAll()};
  card.querySelector('[data-framing]').onchange=e=>{character.puppet.layout.framing=e.target.value;scheduleSave('修改立绘构图',`puppet-layout:${character.id}`);renderAll()};
  for(const [selector,key] of [['[data-puppet-scale]','scale'],['[data-anchor-x]','anchorX'],['[data-anchor-y]','anchorY'],['[data-offset-x]','offsetX'],['[data-offset-y]','offsetY']])card.querySelector(selector).onchange=e=>{character.puppet.layout[key]=Number(e.target.value);scheduleSave('修改角色舞台锚点',`puppet-layout:${character.id}`);renderAll()};
  bindLayerSet(card,character.layers,['base','overlay','eyesOpen','eyesClosed','eyelidsOpen','eyelidsClosed','pupils','brows','eyeLeftOpen','eyeLeftClosed','eyeRightOpen','eyeRightClosed','eyelidLeftOpen','eyelidLeftClosed','eyelidRightOpen','eyelidRightClosed','pupilLeft','pupilRight','browLeft','browRight','mouthClosed','mouthOpen','mouthA','mouthI','mouthU','mouthE','mouthO','mouthSchwa','mouthAe','mouthUu','mouthOo','mouthW','mouthF','mouthTh','mouthM']);
  bindImageSet(card,character,character.images,['idle','open','blink','A','I','U','E','O']);
  if(activeFaceTemplate)bindTemplateLayerSet(card,activeFaceTemplate.layers,FACE_TEMPLATE_LAYER_SLOTS);
  const faceTemplateSelect=card.querySelector('[data-face-template-select]');if(faceTemplateSelect)faceTemplateSelect.onchange=e=>{character.faceFit.templateId=e.target.value||null;scheduleSave('切换共享脸部模板',`face-template-assign:${character.id}`);renderAll()};
  const createTemplateButton=card.querySelector('[data-face-template-new]');if(createTemplateButton)createTemplateButton.onclick=()=>{let i=1,name='脸部模板1';while(project.faceTemplates.some(t=>t.name===name))name=`脸部模板${++i}`;const tpl=createFaceTemplate(name);tpl.layers=faceTemplateLayerSubset(character.layers);project.faceTemplates.push(tpl);character.faceFit.templateId=tpl.id;scheduleSave('从角色创建共享脸部模板',`face-template-create:${character.id}`);renderAll()};
  const deleteTemplateButton=card.querySelector('[data-face-template-delete]');if(deleteTemplateButton)deleteTemplateButton.onclick=()=>{if(!activeFaceTemplate)return;if(!confirm(`删除模板“${activeFaceTemplate.name}”？引用它的角色会改成不使用模板。`))return;project.faceTemplates=project.faceTemplates.filter(t=>t.id!==activeFaceTemplate.id);for(const c of project.characters){if(c.faceFit?.templateId===activeFaceTemplate.id)c.faceFit.templateId=null}scheduleSave('删除共享脸部模板',`face-template-delete:${activeFaceTemplate.id}`);renderAll()};
  const templateNameInput=card.querySelector('[data-face-template-name]');if(templateNameInput)templateNameInput.onchange=e=>{if(!activeFaceTemplate)return;const next=e.target.value.trim();if(!next)return e.target.value=activeFaceTemplate.name;activeFaceTemplate.name=next;scheduleSave('重命名共享脸部模板',`face-template-name:${activeFaceTemplate.id}`);renderAll()};
  const templateNotesInput=card.querySelector('[data-face-template-notes]');if(templateNotesInput)templateNotesInput.onchange=e=>{if(!activeFaceTemplate)return;activeFaceTemplate.notes=e.target.value;scheduleSave('修改共享脸部模板说明',`face-template-notes:${activeFaceTemplate.id}`)};
  const faceAutobindButton=card.querySelector('[data-face-template-autobind]'),faceAutobindFolderButton=card.querySelector('[data-face-template-autobind-folder]'),faceAutobindFiles=card.querySelector('[data-face-template-autobind-files]'),faceAutobindFolderFiles=card.querySelector('[data-face-template-autobind-folder-files]'),faceAutobindPreview=card.querySelector('[data-face-autobind-preview]'),faceAutobindDrop=card.querySelector('[data-face-autobind-drop]');if(faceAutobindButton&&faceAutobindFiles&&faceAutobindPreview){const inspectFiles=inputFiles=>{const files=[...inputFiles].filter(file=>file.type.startsWith('image/')||/\.(png|webp|jpe?g|gif)$/i.test(file.name));if(!files.length)return;const plan=planFaceTemplateBindings(files.map(faceAutobindPath));renderFaceAutobindPreview(faceAutobindPreview,files,plan,activeFaceTemplate);faceAutobindPreview.querySelector('[data-face-autobind-cancel]').onclick=()=>{faceAutobindFiles.value='';faceAutobindPreview.hidden=true;faceAutobindPreview.innerHTML=''};faceAutobindPreview.querySelector('[data-face-autobind-apply]').onclick=()=>void applyFaceAutobindSelection(faceAutobindPreview,files,plan,character,activeFaceTemplate)};faceAutobindButton.onclick=()=>faceAutobindFiles.click();faceAutobindFiles.onchange=()=>inspectFiles(faceAutobindFiles.files);if(faceAutobindFolderButton&&faceAutobindFolderFiles){faceAutobindFolderButton.onclick=()=>faceAutobindFolderFiles.click();faceAutobindFolderFiles.onchange=()=>inspectFiles(faceAutobindFolderFiles.files)}if(faceAutobindDrop){faceAutobindDrop.ondragover=e=>{e.preventDefault();faceAutobindDrop.classList.add('dragging')};faceAutobindDrop.ondragleave=()=>faceAutobindDrop.classList.remove('dragging');faceAutobindDrop.ondrop=e=>{e.preventDefault();faceAutobindDrop.classList.remove('dragging');inspectFiles(e.dataTransfer?.files||[])}}};
  bindFaceNamingGuide(card);
  faceFitController.mount(card,character,activeFaceTemplate);
  const exprHost=card.querySelector('[data-layer-expressions]');
  const expressionNames=[...new Set([...Object.keys(character.layerExpressions||{}),...Object.keys(character.expressions||{}),...Object.keys(character.puppet.expressionPresets||{})])].filter(Boolean);
  for(const name of expressionNames){const set=character.layerExpressions[name]??(character.layerExpressions[name]={});character.puppet.expressionPresets[name]??={};
    const row=document.createElement('div');row.className='card stack';row.innerHTML=`<div class="expr-row"><input data-expr-name value="${escapeHtml(name)}"><button data-remove class="small danger">×</button></div><div class="layer-grid"><label class="muted">覆盖层<select data-layer-slot="overlay">${imageAssetOptions(set.overlay)}</select></label><label class="muted">底图（可留空继承）<select data-layer-slot="base">${imageAssetOptions(set.base)}</select></label><label class="muted">睁眼<select data-layer-slot="eyesOpen">${imageAssetOptions(set.eyesOpen)}</select></label><label class="muted">闭眼<select data-layer-slot="eyesClosed">${imageAssetOptions(set.eyesClosed)}</select></label><label class="muted">眉毛<select data-layer-slot="brows">${imageAssetOptions(set.brows)}</select></label><label class="muted">瞳孔<select data-layer-slot="pupils">${imageAssetOptions(set.pupils)}</select></label><label class="muted">睁眼眼皮<select data-layer-slot="eyelidsOpen">${imageAssetOptions(set.eyelidsOpen)}</select></label><label class="muted">闭眼眼皮<select data-layer-slot="eyelidsClosed">${imageAssetOptions(set.eyelidsClosed)}</select></label><label class="muted">闭嘴<select data-layer-slot="mouthClosed">${imageAssetOptions(set.mouthClosed)}</select></label><label class="muted">张嘴<select data-layer-slot="mouthOpen">${imageAssetOptions(set.mouthOpen)}</select></label></div><details><summary>参数形变 <span class="summary-meta">轻量</span></summary><div class="stack disclosure-body">${PUPPET_EXPR_PARAMS.map(([id,label,min,max,step])=>`<label class="muted">${label} <span data-puppet-value="${id}">${Number(expressionParamValue(character,name,id)).toFixed(2)}</span><input data-puppet-param="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${expressionParamValue(character,name,id)}"></label>`).join('')}</div></details><details class="advanced-only"><summary>网格拉形变 <span class="summary-meta">3×3 lattice</span></summary><div class="stack disclosure-body"><div class="row"><select data-warp-part style="width:auto"><option value="mouth">嘴巴</option><option value="eyes">眼睛</option><option value="brows">眉毛</option><option value="eyelids">眼皮</option><option value="pupils">瞳孔</option><option value="overlay">覆盖层</option><option value="base">底图</option></select><button data-warp-reset class="small">重置网格</button></div><canvas data-warp-canvas width="260" height="196" style="width:100%;max-width:320px;border:1px solid #2b3448;border-radius:9px;touch-action:none"></canvas><div class="muted">这是 Inochi2D LatticeDeformer 的轻量子集：拖动 9 个控制点，形变只在这个表情激活。</div></div></details><details><summary>表情五元音</summary><div class="layer-grid five" style="margin-top:6px">${['A','I','U','E','O'].map(v=>`<label class="muted">${v}<select data-layer-slot="mouth${v}">${imageAssetOptions(set['mouth'+v])}</select></label>`).join('')}</div></details><details><summary>表情英语音素口型 <span class="summary-meta">可选</span></summary><div class="disclosure-body">${englishMouthGrid(set)}</div></details>`;
    bindLayerSet(row,set,['base','overlay','eyesOpen','eyesClosed','eyelidsOpen','eyelidsClosed','pupils','brows','mouthClosed','mouthOpen','mouthA','mouthI','mouthU','mouthE','mouthO','mouthSchwa','mouthAe','mouthUu','mouthOo','mouthW','mouthF','mouthTh','mouthM']);
    bindExpressionParameterControls(row,character,name);bindWarpEditor(row,character,name);
    row.querySelector('[data-remove]').onclick=()=>{delete character.layerExpressions[name];delete character.expressions[name];delete character.puppet.expressionPresets[name];character.puppet.parameters=character.puppet.parameters.filter(p=>!p.id.startsWith(`exprWarp:${name}:`));for(const line of project.lines)if(line.speakerId===character.id&&line.expression===name)line.expression='default';invalidateMediaCaches();scheduleSave('删除表情',`character-expression:${character.id}`);renderAll()};
    row.querySelector('[data-expr-name]').onchange=e=>{const next=e.target.value.trim();if(!next||next===name||character.layerExpressions[next]||character.expressions[next]||character.puppet.expressionPresets[next]){e.target.value=name;return}character.layerExpressions[next]=character.layerExpressions[name];delete character.layerExpressions[name];if(character.expressions[name]){character.expressions[next]=character.expressions[name];delete character.expressions[name]}character.puppet.expressionPresets[next]=character.puppet.expressionPresets[name]||{};delete character.puppet.expressionPresets[name];for(const line of project.lines)if(line.speakerId===character.id&&line.expression===name)line.expression=next;scheduleSave('重命名表情',`character-expression:${character.id}`);renderAll()};exprHost.append(row);
  }
  card.querySelector('[data-add-layer-expression]').onclick=()=>{let i=1,name='表情1';while(character.layerExpressions[name]||character.expressions[name]||character.puppet.expressionPresets[name])name=`表情${++i}`;character.layerExpressions[name]={};character.puppet.expressionPresets[name]={};scheduleSave('新增表情',`character-expression:${character.id}`);renderAll()};
  host.append(card);
}

function renderAssets(){
  for(const editor of objectEditors)editor.destroy?.();objectEditors=[];
  const host=$('#assetView');host.innerHTML='';project.customObjects??=[];project.customObjectTakes??=[];
  const imageAssets=project.assets.filter(asset=>(asset.mime||'').startsWith('image/')||['character','background','cg'].includes(asset.kind));
  const objectTools=document.createElement('div');objectTools.className='card stack';
  objectTools.innerHTML=`<div class="row"><strong>自定义对象</strong><span class="muted">${project.customObjects.length} 个</span></div><div class="muted">任意剧情专用图片对象。证物 / 手机 / 地图 / 文档 / 标题卡只是模板；骰子和转盘仍是独立系统演出。</div><div class="grid3"><label class="muted">初始图片<select data-object-asset><option value="">先建空对象</option>${imageAssets.map(asset=>`<option value="${escapeHtml(asset.id)}">${escapeHtml(asset.name)}</option>`).join('')}</select></label><label class="muted">模板<select data-object-template><option value="blank">空白</option><option value="illustration">插图</option><option value="document">文档</option><option value="map">地图</option><option value="phone">手机 / 终端</option><option value="title-card">标题卡</option></select></label><label class="muted">名称<input data-object-name placeholder="例如：染血的信"></label></div><div class="row"><button data-add-object class="small">+ 新建自定义对象</button></div>`;
  objectTools.querySelector('[data-add-object]').onclick=()=>{const assetId=objectTools.querySelector('[data-object-asset]').value||null,asset=project.assets.find(item=>item.id===assetId),template=objectTools.querySelector('[data-object-template]').value,name=objectTools.querySelector('[data-object-name]').value.trim()||asset?.name?.replace(/\.[^.]+$/,'')||'自定义对象';project.customObjects.push(createCustomObject(name,assetId,template));scheduleSave('新增自定义对象','custom-object-add');renderAll()};
  host.append(objectTools);

  for(const object of project.customObjects){
    const card=document.createElement('div');card.className='card stack';const states=object.states||[];
    const takes=project.customObjectTakes.filter(take=>take.objectId===object.id);
    card.innerHTML=`<div class="row"><input data-object-name value="${escapeHtml(object.name)}" style="font-weight:700"><span class="status">Custom Object</span><button data-object-remove class="small danger" style="margin-left:auto">移除</button></div><div class="grid2"><label class="muted">模板<select data-object-template>${['blank','illustration','document','map','phone','title-card'].map(v=>`<option value="${v}" ${v===object.template?'selected':''}>${({blank:'空白',illustration:'插图',document:'文档',map:'地图',phone:'手机 / 终端','title-card':'标题卡'})[v]}</option>`).join('')}</select></label><label class="muted">交互<select data-object-interaction>${['none','inspect','stateful','pan-zoom','hotspots'].map(v=>`<option value="${v}" ${v===object.interactionMode?'selected':''}>${({none:'仅展示',inspect:'点击查看',stateful:'点击轮换状态','pan-zoom':'拖动 / 缩放查看',hotspots:'热点交互'})[v]}</option>`).join('')}</select></label></div><div class="muted"><code>/object show ${escapeHtml(object.name)}</code> · <code>/object hide ${escapeHtml(object.name)}</code></div><div data-object-states class="stack"></div><div class="row"><button data-add-state class="small">+ 状态</button><span class="muted">热点 ${object.hotspots?.length||0} 个</span></div><details data-object-interaction-editor><summary>可视化交互 / 热点编辑 <span class="summary-meta">AGS 式对象房间</span></summary><div class="disclosure-body" data-object-interaction-host></div></details><details ${takes.length?'':'hidden'}><summary>交互录制 <span class="summary-meta">${takes.length} take</span></summary><div data-object-takes class="stack disclosure-body">${takes.map(take=>`<div class="row"><b>${escapeHtml(take.name)}</b><span class="muted">${take.steps.length} 步 · ${Number(take.duration).toFixed(2)}s</span><button class="small" data-insert-take="${escapeHtml(take.id)}">烘焙到当前行后</button><button class="small danger" data-delete-take="${escapeHtml(take.id)}">×</button></div>`).join('')}</div></details>`;
    card.querySelector('[data-object-name]').onchange=e=>{const value=e.target.value.trim();if(!value){e.target.value=object.name;return}object.name=value;scheduleSave('重命名自定义对象',`custom-object:${object.id}:name`);renderAll()};
    card.querySelector('[data-object-template]').onchange=e=>{object.template=e.target.value;scheduleSave('修改对象模板',`custom-object:${object.id}:template`);renderAll()};
    card.querySelector('[data-object-interaction]').onchange=e=>{object.interactionMode=e.target.value;scheduleSave('修改对象交互',`custom-object:${object.id}:interaction`);renderAll()};
    card.querySelector('[data-object-remove]').onclick=()=>{if(!confirm(`移除自定义对象「${object.name}」？`))return;project.customObjects=project.customObjects.filter(item=>item.id!==object.id);project.customObjectTakes=project.customObjectTakes.filter(take=>take.objectId!==object.id);for(const line of project.lines)if(line.command?.objectId===object.id){line.command=null;line.text='/wait 0'}scheduleSave('移除自定义对象',`custom-object-remove:${object.id}`);renderAll()};
    const stateHost=card.querySelector('[data-object-states]');
    for(const state of states){const row=document.createElement('div');row.className='grid3';row.innerHTML=`<label class="muted">状态名<input data-state-name value="${escapeHtml(state.name)}"></label><label class="muted">图片<select data-state-asset><option value="">未绑定</option>${imageAssets.map(asset=>`<option value="${escapeHtml(asset.id)}" ${asset.id===state.assetId?'selected':''}>${escapeHtml(asset.name)}</option>`).join('')}</select></label><label class="checkrow"><input data-state-initial type="radio" name="initial-${escapeHtml(object.id)}" ${state.id===object.initialStateId?'checked':''}><span>初始状态</span></label>`;row.querySelector('[data-state-name]').onchange=e=>{state.name=e.target.value.trim()||state.name;scheduleSave('修改对象状态',`custom-object:${object.id}:state:${state.id}`);renderAll()};row.querySelector('[data-state-asset]').onchange=e=>{state.assetId=e.target.value||null;scheduleSave('绑定对象状态图片',`custom-object:${object.id}:state:${state.id}:asset`);renderAll()};row.querySelector('[data-state-initial]').onchange=()=>{object.initialStateId=state.id;scheduleSave('修改对象初始状态',`custom-object:${object.id}:initial`);renderAll()};stateHost.append(row)}
    card.querySelector('[data-add-state]').onclick=()=>{const assetId=states.at(-1)?.assetId||null;const id=makeId('objstate');object.states.push({id,name:`状态 ${object.states.length+1}`,assetId});object.initialStateId??=id;scheduleSave('新增对象状态',`custom-object:${object.id}:state-add`);renderAll()};
    const editorDetails=card.querySelector('[data-object-interaction-editor]');editorDetails.ontoggle=()=>{if(!editorDetails.open)return;const editor=new CustomObjectEditorController({resolveAsset,onMutation:(label,key)=>{scheduleSave(label,key);compile();void renderPreviewStatic()},escapeHtml});objectEditors.push(editor);editor.mount(card.querySelector('[data-object-interaction-host]'),object)};
    for(const button of card.querySelectorAll('[data-delete-take]'))button.onclick=()=>{project.customObjectTakes=project.customObjectTakes.filter(take=>take.id!==button.dataset.deleteTake);scheduleSave('删除对象交互录制','object-take-delete');renderAll()};
    for(const button of card.querySelectorAll('[data-insert-take]'))button.onclick=()=>{const take=project.customObjectTakes.find(item=>item.id===button.dataset.insertTake);if(take)insertBakedObjectTake(take)};
    host.append(card);
  }

  const assetHeader=document.createElement('div');assetHeader.className='row';assetHeader.innerHTML=`<strong>素材文件</strong><span class="muted">${project.assets.length} 个</span>`;host.append(assetHeader);
  if(!project.assets.length){host.insertAdjacentHTML('beforeend','<div class="muted">还没有素材。</div>');return}
  for(const asset of project.assets){
    const div=document.createElement('div');div.className='asset';div.dataset.assetId=asset.id;div.innerHTML=`<span class="asset-kind">${escapeHtml(asset.kind)}</span><div class="stack"><div><b>${escapeHtml(asset.name)}</b><div class="muted">${escapeHtml(asset.sourcePath||asset.uri||'当前会话')}</div>${asset.metadata?.duration?`<div class="muted">${Number(asset.metadata.duration).toFixed(2)}s</div>`:''}</div><div class="row"><button data-relink class="small">重新链接</button><button data-remove class="small danger">移除</button></div></div>`;
    const relink=div.querySelector('[data-relink]'),input=document.createElement('input');input.type='file';input.hidden=true;div.append(input);relink.onclick=()=>input.click();input.onchange=async()=>{const file=input.files?.[0];if(!file)return;runtimeFiles.set(asset.id,file);asset.name=file.name;asset.mime=file.type;const duration=mediaKinds().has(asset.kind)?await probeDuration(file):null;asset.metadata={...(asset.metadata||{}),...(duration?{duration}:{})};if(workspace){const path=asset.sourcePath?.startsWith('assets/')?asset.sourcePath:`${assetDirectory(asset.kind)}/${asset.id}_${sanitizePathPart(file.name)}`;await persistAssetFile(workspace,project,asset,file,path)}else asset.sourcePath=file.name;scheduleSave('重新链接素材',`asset-relink:${asset.id}`);invalidateMediaCaches();renderAll()};
    div.querySelector('[data-remove]').onclick=()=>{project.assets=project.assets.filter(a=>a.id!==asset.id);runtimeFiles.delete(asset.id);for(const object of project.customObjects)for(const state of object.states)if(state.assetId===asset.id)state.assetId=null;scheduleSave('移除素材',`asset-remove:${asset.id}`);invalidateMediaCaches();renderAll()};host.append(div);
  }
}
function insertBakedObjectTake(take){
  const rows=bakeCustomObjectInteractionTake(project,take);if(!rows.length)return;
  let at=Math.min(project.lines.length,Math.max(0,selectedIndex+1));const inserted=[];
  for(const row of rows){const line=createLine(project,'Director',row.text,'command');line.mouth='off';line.duration=null;syncCommandLine(line);project.lines.splice(at++,0,line);inserted.push(line.id)}
  selectedIndex=Math.max(0,at-1);selectedLineIds.clear();scheduleSave('烘焙对象交互录制','object-take-bake');renderAll();scrollActiveLineIntoView();
}

function patchSelectOptions(kind,key){
  const line=currentLine(),scene=line?.scene||{};const value=has(scene,key)?scene[key]:undefined;
  const items=project.assets.filter(a=>a.kind===kind);
  return `<option value="__inherit" ${value===undefined?'selected':''}>继承 / 不变化</option><option value="__clear" ${value===null?'selected':''}>清除 / 停止</option>`+items.map(a=>`<option value="${escapeHtml(a.id)}" ${a.id===value?'selected':''}>${escapeHtml(a.name)}</option>`).join('');
}
function setPatch(line,key,value){line.scene??={};if(value==='__inherit')delete line.scene[key];else if(value==='__clear')line.scene[key]=null;else line.scene[key]=value}
function simpleAssetOptions(kind,value,none='无'){return `<option value="">${none}</option>`+project.assets.filter(a=>a.kind===kind).map(a=>`<option value="${escapeHtml(a.id)}" ${a.id===value?'selected':''}>${escapeHtml(a.name)}</option>`).join('')}

function checkboxList(hostId,selected,onChange){
  const host=$('#'+hostId);host.innerHTML='';
  for(const c of project.characters){const label=document.createElement('label');label.className='checkrow';label.innerHTML=`<input type="checkbox" value="${escapeHtml(c.id)}" ${selected.includes(c.id)?'checked':''}><span>${escapeHtml(c.name)}</span>`;label.querySelector('input').onchange=e=>onChange(c.id,e.target.checked);host.append(label)}
}


function mediaDefOptions(value,includeText=false){
  const defs=(project.mediaDefinitions||[]).filter(def=>includeText||['bubble','balloon','dynamic-bubble','chat-window'].includes(def.type));
  return `<option value="">默认 / 未绑定</option>`+defs.map(def=>`<option value="${escapeHtml(def.id)}" ${def.id===value?'selected':''}>${escapeHtml(def.name)} · ${escapeHtml(def.type)}</option>`).join('');
}

function mediaDefByNameOrId(value){const v=String(value||'').trim();return project.mediaDefinitions.find(d=>d.id===v||d.name===v)||null}
function formatIconMap(def){return Object.entries(def.iconMap||{}).map(([k,v])=>`${k} | ${v}`).join('\n')}
function parseIconMap(text){const out={};for(const raw of String(text||'').split(/\n/)){const [k,...rest]=raw.split('|');const key=k?.trim(),value=rest.join('|').trim();if(key&&value)out[key]=value}return out}
function formatParticipants(def){return (def.participants||[]).map(p=>`${p.key} | ${mediaDefByNameOrId(p.bubbleDefinitionId)?.name||p.bubbleDefinitionId||''} | ${mediaDefByNameOrId(p.avatarDefinitionId)?.name||p.avatarDefinitionId||''} | ${p.align||'left'}`).join('\n')}
function parseParticipants(text){const out=[];for(const raw of String(text||'').split(/\n/)){const [key,bubble,avatar,side]=raw.split('|').map(x=>x?.trim());if(!key)continue;out.push({key,bubbleDefinitionId:mediaDefByNameOrId(bubble)?.id||bubble||null,avatarDefinitionId:mediaDefByNameOrId(avatar)?.id||avatar||null,align:side==='right'?'right':'left'})}return out}
function formatHeaders(def){return (def.headers||[]).map(h=>`${mediaDefByNameOrId(h.textStyleId)?.name||h.textStyleId||''} | ${h.x??0} | ${h.y??0} | ${h.target||'Name'} | ${h.align||'left'}`).join('\n')}
function parseHeaders(text){const out=[];for(const raw of String(text||'').split(/\n/)){const [style,x,y,target,al]=raw.split('|').map(x=>x?.trim());if(!style&&!target)continue;out.push({textStyleId:mediaDefByNameOrId(style)?.id||style||null,x:Number(x)||0,y:Number(y)||0,target:target||'Name',align:['left','center','right'].includes(al)?al:'left'})}return out}

function renderMediaDefinitions(){
  const host=$('#mediaDefinitionView');host.innerHTML='';project.mediaDefinitions??=[];
  const tools=document.createElement('div');tools.className='card stack';tools.innerHTML=`<div class="row"><strong>样式定义</strong><span class="muted">${project.mediaDefinitions.length} 个</span><button data-add-bubble class="small" style="margin-left:auto">+ 气泡</button><button data-add-chat class="small">+ 聊天窗</button><button data-add-text class="small">+ 文本样式</button></div><div class="muted">这里定义可复用的对话框、聊天窗和文字样式；图片/音频文件仍在“素材”页管理。高级模式可查看 RplGen 原始参数。</div>`;
  tools.querySelector('[data-add-bubble]').onclick=()=>{let i=1,name='新气泡';while(project.mediaDefinitions.some(d=>d.name===name))name=`新气泡${++i}`;project.mediaDefinitions.push({id:makeId('media'),name,type:'bubble',backgroundAssetId:null,backgroundSource:null,x:140,y:690,width:760,height:240,scale:1,mainTextStyleId:null,headerTextStyleId:null,mainTextX:50,mainTextY:100,headerTextX:40,headerTextY:25,align:'left',verticalAlign:'top',headerAlign:'left',lineDistance:1.3,lineCountEstimate:4,fillMode:null,fitAxis:null,mainTextEndX:null,mainTextEndY:null,headers:[],metadata:{}});scheduleSave('新增媒体定义','media-def-add');renderAll()};
  tools.querySelector('[data-add-chat]').onclick=()=>{let i=1,name='新聊天窗';while(project.mediaDefinitions.some(d=>d.name===name))name=`新聊天窗${++i}`;project.mediaDefinitions.push({id:makeId('media'),name,type:'chat-window',backgroundAssetId:null,backgroundSource:null,x:0,y:0,width:1280,height:720,scale:1,messageGap:12,align:'left',subX:80,subY:80,subWidth:1120,subHeight:560,avatarLeft:20,avatarRight:1260,participants:[],metadata:{}});scheduleSave('新增聊天窗','media-def-add');renderAll()};
  tools.querySelector('[data-add-text]').onclick=()=>{let i=1,name='新文本样式';while(project.mediaDefinitions.some(d=>d.name===name))name=`新文本样式${++i}`;project.mediaDefinitions.push({id:makeId('media'),name,type:'text',fontFamily:null,fontSize:40,color:'#f4f6fb',align:'left',lineHeight:1.3,maxCharsPerLine:24,strokeColor:null,strokeWidth:null,metadata:{}});scheduleSave('新增媒体定义','media-def-add');renderAll()};host.append(tools);
  const textDefs=()=>project.mediaDefinitions.filter(d=>d.type==='text'||d.type==='richtext');
  for(const def of project.mediaDefinitions){
    const card=document.createElement('div');card.className='card stack';
    const top=`<div class="row"><input data-name value="${escapeHtml(def.name)}" style="font-weight:700"><span class="status">${escapeHtml(mediaTypeLabel(def.type))}</span><button data-remove class="small danger" style="margin-left:auto">移除</button></div>`;
    if(def.type==='text'||def.type==='richtext'){
      card.innerHTML=top+`<div class="grid3"><label class="muted">字号<input data-font-size type="number" min="8" value="${Number(def.fontSize)||40}"></label><label class="muted">颜色<input data-color value="${escapeHtml(def.color||'#f4f6fb')}"></label><label class="muted">对齐<select data-align>${['left','center','right'].map(v=>`<option value="${v}" ${def.align===v?'selected':''}>${v}</option>`).join('')}</select></label></div><div class="grid3"><label class="muted">行高<input data-line-height type="number" min="0.8" step="0.1" value="${def.lineHeight||1.3}"></label><label class="muted">每行字符估计<input data-line-limit type="number" min="1" value="${def.maxCharsPerLine||20}"></label><label class="muted">描边宽度<input data-stroke-width type="number" min="0" step="0.5" value="${def.strokeWidth??0}"></label></div>${def.type==='richtext'?`<label class="muted">图标替换（每行：key | 素材路径）<textarea data-icons rows="3" placeholder="heart | media/heart.png">${escapeHtml(formatIconMap(def))}</textarea></label><div class="muted">正文中的 <code>[heart]</code> 会按字号作为内联图标；<code>[b] [i] [u] [x] [fs:48] [fg:#ff5555] [bg:#222]</code> 也会在 Canvas 中解析。</div>`:''}`;
      for(const [sel,key,number] of [['[data-font-size]','fontSize',true],['[data-color]','color',false],['[data-align]','align',false],['[data-line-height]','lineHeight',true],['[data-line-limit]','maxCharsPerLine',true],['[data-stroke-width]','strokeWidth',true]])card.querySelector(sel).onchange=e=>{def[key]=number?Number(e.target.value):e.target.value;scheduleSave('编辑媒体定义',`media-def:${def.id}`);renderAll()};
      if(def.type==='richtext')card.querySelector('[data-icons]').onchange=e=>{def.iconMap=parseIconMap(e.target.value);scheduleSave('编辑 RichText 图标',`media-def:${def.id}`);invalidateMediaCaches();renderAll()};
    }else if(def.type==='image'){
      card.innerHTML=top+`<div class="grid3"><label class="muted">图像路径<input data-source value="${escapeHtml(def.source||'')}"></label><label class="muted">X<input data-x type="number" value="${def.x||0}"></label><label class="muted">Y<input data-y type="number" value="${def.y||0}"></label></div><label class="muted">缩放<input data-scale type="number" min="0.1" step="0.1" value="${def.scale||1}"></label>`;
      for(const [sel,key,num] of [['[data-source]','source',false],['[data-x]','x',true],['[data-y]','y',true],['[data-scale]','scale',true]])card.querySelector(sel).onchange=e=>{def[key]=num?Number(e.target.value):e.target.value||null;scheduleSave('编辑图像定义',`media-def:${def.id}`);invalidateMediaCaches();renderAll()};
    }else if(def.type==='chat-window'){
      card.innerHTML=top+`<div class="grid3"><label class="muted">背景路径<input data-bg value="${escapeHtml(def.backgroundSource||'')}"></label><label class="muted">X<input data-x type="number" value="${def.x}"></label><label class="muted">Y<input data-y type="number" value="${def.y}"></label></div><div class="grid4"><label class="muted">消息区 X<input data-sub-x type="number" value="${def.subX??0}"></label><label class="muted">消息区 Y<input data-sub-y type="number" value="${def.subY??0}"></label><label class="muted">消息区宽<input data-sub-w type="number" value="${def.subWidth??def.width??1200}"></label><label class="muted">消息区高<input data-sub-h type="number" value="${def.subHeight??def.height??600}"></label></div><div class="grid3"><label class="muted">消息间距<input data-gap type="number" value="${def.messageGap??0}"></label><label class="muted">头像左轨<input data-avatar-left type="number" value="${def.avatarLeft??0}"></label><label class="muted">头像右轨<input data-avatar-right type="number" value="${def.avatarRight??1920}"></label></div><label class="muted">角色映射（每行：key | 子气泡 | 头像 | left/right）<textarea data-parts rows="5" placeholder="Arthur | 气泡左 | Arthur头像 | left">${escapeHtml(formatParticipants(def))}</textarea></label><div class="muted">历史消息会在同一 Chapter/Scene 内按此 ChatWindow 从底部向上堆叠；超出消息区的旧记录自动裁掉。</div>`;
      for(const [sel,key,num] of [['[data-bg]','backgroundSource',false],['[data-x]','x',true],['[data-y]','y',true],['[data-sub-x]','subX',true],['[data-sub-y]','subY',true],['[data-sub-w]','subWidth',true],['[data-sub-h]','subHeight',true],['[data-gap]','messageGap',true],['[data-avatar-left]','avatarLeft',true],['[data-avatar-right]','avatarRight',true]])card.querySelector(sel).onchange=e=>{def[key]=num?Number(e.target.value):e.target.value||null;scheduleSave('编辑聊天窗定义',`media-def:${def.id}`);invalidateMediaCaches();renderAll()};
      card.querySelector('[data-parts]').onchange=e=>{def.participants=parseParticipants(e.target.value);scheduleSave('编辑聊天窗角色映射',`media-def:${def.id}`);renderAll()};
    }else{
      const dynamic=def.type==='dynamic-bubble',balloon=def.type==='balloon';
      card.innerHTML=top+`<div class="grid3"><label class="muted">背景路径<input data-bg value="${escapeHtml(def.backgroundSource||'')}"></label><label class="muted">X<input data-x type="number" value="${def.x}"></label><label class="muted">Y<input data-y type="number" value="${def.y}"></label></div><div class="grid3"><label class="muted">宽<input data-w type="number" value="${def.width??760}"></label><label class="muted">高<input data-h type="number" value="${def.height??240}"></label><label class="muted">缩放<input data-scale type="number" min="0.1" step="0.1" value="${def.scale||1}"></label></div><div class="grid3"><label class="muted">主文本样式<select data-main-style><option value="">默认</option>${textDefs().map(x=>`<option value="${escapeHtml(x.id)}" ${def.mainTextStyleId===x.id?'selected':''}>${escapeHtml(x.name)}</option>`).join('')}</select></label><label class="muted">标题样式<select data-head-style><option value="">默认</option>${textDefs().map(x=>`<option value="${escapeHtml(x.id)}" ${def.headerTextStyleId===x.id?'selected':''}>${escapeHtml(x.name)}</option>`).join('')}</select></label><label class="muted">正文对齐<select data-align>${['left','center','right'].map(v=>`<option value="${v}" ${def.align===v?'selected':''}>${v}</option>`).join('')}</select></label></div>${dynamic?`<div class="grid4"><label class="muted">mt X<input data-mtx type="number" value="${def.mainTextX??0}"></label><label class="muted">mt Y<input data-mty type="number" value="${def.mainTextY??0}"></label><label class="muted">mt_end X<input data-mtex type="number" value="${def.mainTextEndX??0}"></label><label class="muted">mt_end Y<input data-mtey type="number" value="${def.mainTextEndY??0}"></label></div><div class="grid2"><label class="muted">填充<select data-fill><option value="stretch" ${def.fillMode==='stretch'?'selected':''}>stretch</option><option value="collage" ${def.fillMode==='collage'?'selected':''}>collage / 平铺</option></select></label><label class="muted">适应轴<select data-fit>${['free','vertical','horizontal'].map(v=>`<option value="${v}" ${def.fitAxis===v?'selected':''}>${v}</option>`).join('')}</select></label></div><div class="muted">DynamicBubble 按 mt_pos / mt_end 将底图切成 9 片；边和中心按 stretch 或 collage 填入正文所需尺寸。</div>`:''}${balloon?`<label class="muted">多 Header（每行：文本样式 | X | Y | target | align）<textarea data-headers rows="4" placeholder="名字样式 | 200 | 10 | Name | left\nHP样式 | 900 | 20 | HitPoint | right">${escapeHtml(formatHeaders(def))}</textarea></label>`:''}`;
      for(const [sel,key,num] of [['[data-bg]','backgroundSource',false],['[data-x]','x',true],['[data-y]','y',true],['[data-w]','width',true],['[data-h]','height',true],['[data-scale]','scale',true],['[data-main-style]','mainTextStyleId',false],['[data-head-style]','headerTextStyleId',false],['[data-align]','align',false]])card.querySelector(sel).onchange=e=>{def[key]=num?Number(e.target.value):(e.target.value||null);scheduleSave('编辑媒体定义',`media-def:${def.id}`);invalidateMediaCaches();renderAll()};
      if(dynamic){for(const [sel,key] of [['[data-mtx]','mainTextX'],['[data-mty]','mainTextY'],['[data-mtex]','mainTextEndX'],['[data-mtey]','mainTextEndY']])card.querySelector(sel).onchange=e=>{def[key]=Number(e.target.value);scheduleSave('编辑 DynamicBubble',`media-def:${def.id}`);invalidateMediaCaches();renderAll()};card.querySelector('[data-fill]').onchange=e=>{def.fillMode=e.target.value;scheduleSave('编辑 DynamicBubble',`media-def:${def.id}`);renderAll()};card.querySelector('[data-fit]').onchange=e=>{def.fitAxis=e.target.value;scheduleSave('编辑 DynamicBubble',`media-def:${def.id}`);renderAll()}}
      if(balloon)card.querySelector('[data-headers]').onchange=e=>{def.headers=parseHeaders(e.target.value);scheduleSave('编辑 Balloon Headers',`media-def:${def.id}`);renderAll()};
    }
    card.querySelector('[data-name]').onchange=e=>{const name=e.target.value.trim();if(!name){e.target.value=def.name;return}def.name=name;scheduleSave('重命名媒体定义',`media-def:${def.id}`);renderAll()};
    card.querySelector('[data-remove]').onclick=()=>{if(!confirm(`移除媒体定义「${def.name}」？`))return;project.mediaDefinitions=project.mediaDefinitions.filter(x=>x.id!==def.id);for(const line of project.lines){if(line.dialogueStyleId===def.id)line.dialogueStyleId=null;if(line.bubble?.definitionId===def.id)line.bubble.definitionId=null}for(const d of project.mediaDefinitions){if(d.type==='chat-window')for(const p of d.participants||[]){if(p.bubbleDefinitionId===def.id)p.bubbleDefinitionId=null;if(p.avatarDefinitionId===def.id)p.avatarDefinitionId=null}}scheduleSave('移除媒体定义',`media-def-remove:${def.id}`);renderAll()};
    if(def.metadata?.rplgen){const details=document.createElement('details');details.innerHTML=`<summary>RplGen 原始参数</summary><pre style="white-space:pre-wrap;max-height:180px;overflow:auto">${escapeHtml(JSON.stringify(def.metadata.rplgen,null,2))}</pre>`;card.append(details)}
    host.append(card);
  }
}

function renderStageControls(line){
  $('#autoStageModeEdit').value=project.settings.autoStageMode||'vn-continuity';
  $('#maxOnStageEdit').value=String(project.settings.maxOnStage||2);
  $('#speakerFocusEdit').value=project.settings.dimOthers===false?'none':(project.settings.speakerFocus||'subtle');
  $('#stageModeEdit').value=line.stageMode||'auto';
  const custom=line.stageIds||[];
  checkboxList('customStage',custom,(id,checked)=>{line.stageIds??=[];if(checked&&!line.stageIds.includes(id))line.stageIds.push(id);if(!checked)line.stageIds=line.stageIds.filter(x=>x!==id);scheduleSave();renderAll()});
  const roster=(line.stageMode==='custom'?line.stageIds:currentPerf()?.stage.map(a=>a.characterId))||[];
  const posHost=$('#stagePositions');posHost.innerHTML='';
  for(const id of roster){const row=document.createElement('div');row.className='position-row';const current=line.stagePositions?.[id]||project.characters.find(c=>c.id===id)?.defaultPosition||'auto';row.innerHTML=`<span>${escapeHtml(charName(id))}</span><select>${['auto','left','center','right'].map(v=>`<option value="${v}" ${v===current?'selected':''}>${positionLabel(v)}</option>`).join('')}</select>`;row.querySelector('select').onchange=e=>{line.stagePositions??={};if(e.target.value==='auto')delete line.stagePositions[id];else line.stagePositions[id]=e.target.value;scheduleSave();renderAll()};posHost.append(row)}
  const enters=line.scene?.enterIds||[],exits=line.scene?.exitIds||[];
  checkboxList('enterChars',enters,(id,checked)=>{line.scene??={};line.scene.enterIds??=[];line.scene.exitIds??=[];if(checked){if(!line.scene.enterIds.includes(id))line.scene.enterIds.push(id);line.scene.exitIds=line.scene.exitIds.filter(x=>x!==id)}else line.scene.enterIds=line.scene.enterIds.filter(x=>x!==id);scheduleSave();renderAll()});
  checkboxList('exitChars',exits,(id,checked)=>{line.scene??={};line.scene.enterIds??=[];line.scene.exitIds??=[];if(checked){if(!line.scene.exitIds.includes(id))line.scene.exitIds.push(id);line.scene.enterIds=line.scene.enterIds.filter(x=>x!==id)}else line.scene.exitIds=line.scene.exitIds.filter(x=>x!==id);scheduleSave();renderAll()});
}

function formatDiceRolls(rolls){return (rolls||[]).map(r=>`${r.label||''} | ${r.sides||100} | ${r.check==null?'NA':r.check} | ${r.result??1}`).join('\n')}
function parseDiceRollsEditor(value){return String(value||'').split(/\n+/).map(row=>row.trim()).filter(Boolean).map(row=>{const parts=row.split('|').map(x=>x.trim());if(parts.length<4)return null;const sides=Number(parts[1]),result=Number(parts[3]),check=/^NA$/i.test(parts[2])?null:Number(parts[2]);if(!Number.isFinite(sides)||!Number.isFinite(result)||(check!=null&&!Number.isFinite(check)))return null;return {label:parts[0]||`d${sides}`,sides:Math.max(1,Math.round(sides)),check,result:Math.round(result)}}).filter(Boolean)}
function ensureHitPoint(line){line.hitPoint??={label:charName(line.speakerId)||'HP',max:10,before:10,after:10};return line.hitPoint}
function ensureBubble(line){line.bubble??={definitionId:null,headerText:'',mainText:line.text||'',textEffect:line.textEffect||'all',textEffectDuration:line.textEffectDuration??null,metadata:{}};return line.bubble}

function syncCommandLine(line){
  if(!line||line.type!=='command')return {command:null};
  const previous=line.command;
  if(previous?.kind==='scene'&&line.sceneTitle===previous.value)line.sceneTitle='';
  if(previous?.kind==='chapter'&&line.chapterTitle===previous.value)line.chapterTitle='';
  const result=parseDirectorCommand(project,line.text);
  if(result.command&&previous?.beatMode)result.command.beatMode=previous.beatMode;
  line.command=result.command;
  line.mouth='off';
  if(result.command?.kind==='scene')line.sceneTitle=result.command.value||'';
  if(result.command?.kind==='chapter')line.chapterTitle=result.command.value||'';
  return result;
}
function setDirectorCommand(line,command,label='编辑导演指令'){
  const previous=line.command;
  if(previous?.kind==='scene'&&line.sceneTitle===previous.value)line.sceneTitle='';
  if(previous?.kind==='chapter'&&line.chapterTitle===previous.value)line.chapterTitle='';
  line.command=structuredClone(command);line.text=formatDirectorCommand(project,line.command);line.mouth='off';
  if(line.command.kind==='scene')line.sceneTitle=line.command.value||'';
  if(line.command.kind==='chapter')line.chapterTitle=line.command.value||'';
  scheduleSave(label,`${line.id}:director-command`);renderAll();
}
function directorCharacterOptions(value){return project.characters.filter(c=>c.showOnStage).map(c=>`<option value="${escapeHtml(c.id)}" ${c.id===value?'selected':''}>${escapeHtml(c.name)}</option>`).join('')}
function directorAssetOptions(kind,value,noneLabel){return `<option value="">${noneLabel}</option>`+project.assets.filter(a=>a.kind===kind).map(a=>`<option value="${escapeHtml(a.id)}" ${a.id===value?'selected':''}>${escapeHtml(a.name)}</option>`).join('')}
function renderCommandStructuredEditor(line,result){
  const host=$('#commandStructuredEdit');host.innerHTML='';const command=result?.command;if(!command){host.innerHTML='<div class="muted">先把上面的指令文本修到可解析状态；解析成功后这里会出现下拉编辑器。</div>';return}
  const row=document.createElement('div');row.className='stack';
  const bind=(selector,fn)=>{const el=row.querySelector(selector);if(el)el.onchange=()=>fn(el)};
  if(['dismiss','enter','move','motion','expression'].includes(command.kind)){
    const characterId=command.characterId||project.characters.find(c=>c.showOnStage)?.id||'';const character=project.characters.find(c=>c.id===characterId);
    const extra=command.kind==='enter'?`<label>站位<select data-command-position>${['auto','left','center','right'].map(v=>`<option value="${v}" ${v===(command.position||'auto')?'selected':''}>${positionLabel(v)}</option>`).join('')}</select></label>`:command.kind==='expression'?`<label>表情<select data-command-expression>${characterExpressionNames(character).map(v=>`<option value="${escapeHtml(v)}" ${v===(command.expression||'default')?'selected':''}>${escapeHtml(v)}</option>`).join('')}</select></label>`:command.kind==='motion'?`<div class="grid2"><label>已有自定义动作<input data-command-motion list="stageMethodPresets" value="${escapeHtml(command.value||'shake_minor')}"></label><label>动作时长<input data-command-duration type="number" min="0" step="0.05" value="${Number(command.duration)||0.5}"></label></div>`:command.kind==='move'?`<div class="muted">在上方舞台点击“可视化摆放”，直接拖动该角色；/move 行只记录事件位置，精确数值由画布写入工程。</div>`:'';
    row.innerHTML=`<div class="grid2"><label>角色<select data-command-character>${directorCharacterOptions(characterId)}</select></label>${extra}</div>`;
    bind('[data-command-character]',el=>{const next={...command,characterId:el.value,target:project.characters.find(c=>c.id===el.value)?.name||command.target};if(next.kind==='expression'){const c=project.characters.find(c=>c.id===el.value);const names=characterExpressionNames(c);if(!names.includes(next.expression))next.expression='default'}setDirectorCommand(line,next)});
    bind('[data-command-position]',el=>setDirectorCommand(line,{...command,position:el.value}));
    bind('[data-command-expression]',el=>setDirectorCommand(line,{...command,expression:el.value}));
    bind('[data-command-motion]',el=>setDirectorCommand(line,{...command,value:el.value.trim()||'replace'}));
    bind('[data-command-duration]',el=>setDirectorCommand(line,{...command,duration:Math.max(0,Number(el.value)||0.5)}));
  }else if(command.kind==='object'){
    const objects=project.customObjects||[];const object=objects.find(item=>item.id===command.objectId)||objects[0]||null;
    const states=object?.states||[];
    row.innerHTML=`<div class="grid2"><label>自定义对象<select data-command-object>${objects.map(item=>`<option value="${escapeHtml(item.id)}" ${item.id===(command.objectId||object?.id)?'selected':''}>${escapeHtml(item.name)}</option>`).join('')}</select></label><label>动作<select data-command-object-action>${['show','hide','state','transform'].map(v=>`<option value="${v}" ${v===(command.objectAction||'show')?'selected':''}>${({show:'显示',hide:'隐藏',state:'切换状态',transform:'移动 / 缩放（画布/录制）'})[v]}</option>`).join('')}</select></label></div><label>状态<select data-command-object-state><option value="">默认 / 保持</option>${states.map(state=>`<option value="${escapeHtml(state.id)}" ${state.id===command.objectStateId?'selected':''}>${escapeHtml(state.name)}</option>`).join('')}</select></label><div class="muted">“移动 / 缩放”通常由对象交互录制或画布操作生成；文本中的精确数值主要用于可重复回放。</div>`;
    bind('[data-command-object]',el=>{const nextObject=project.customObjects.find(item=>item.id===el.value);setDirectorCommand(line,{...command,objectId:el.value,target:nextObject?.name||command.target,objectStateId:null})});
    bind('[data-command-object-action]',el=>setDirectorCommand(line,{...command,objectAction:el.value}));
    bind('[data-command-object-state]',el=>setDirectorCommand(line,{...command,objectStateId:el.value||null}));
  }else if(['background','cg','bgm','ambient','sfx'].includes(command.kind)){
    const kind=command.kind==='background'?'background':command.kind;const none=command.kind==='bgm'?'停止 BGM':command.kind==='ambient'?'停止环境声':command.kind==='sfx'?'无 / 不播放':'清除';
    row.innerHTML=`<label>${command.kind==='background'?'背景':command.kind.toUpperCase()}<select data-command-asset>${directorAssetOptions(kind,command.assetId,none)}</select></label>`;
    bind('[data-command-asset]',el=>{const asset=project.assets.find(a=>a.id===el.value);setDirectorCommand(line,{...command,assetId:el.value||null,target:asset?.name||(['bgm','ambient'].includes(command.kind)?'stop':'none')})});
  }else if(command.kind==='scene'||command.kind==='chapter'){
    row.innerHTML=`<label>${command.kind==='scene'?'Scene':'Chapter'} 名称<input data-command-text value="${escapeHtml(command.value||'')}"></label>`;
    bind('[data-command-text]',el=>setDirectorCommand(line,{...command,value:el.value.trim()||`新 ${command.kind==='scene'?'Scene':'Chapter'}`}));
  }else if(command.kind==='wait'){
    row.innerHTML=`<label>等待秒数<input data-command-duration type="number" min="0" step="0.05" value="${Number(command.duration)||0}"></label>`;
    bind('[data-command-duration]',el=>setDirectorCommand(line,{...command,duration:Math.max(0,Number(el.value)||0)}));
  }else if(command.kind==='camera'){
    row.innerHTML=`<label>镜头效果<select data-command-value>${['none','push','shake','focus-speaker'].map(v=>`<option value="${v}" ${v===command.value?'selected':''}>${v}</option>`).join('')}</select></label>`;
    bind('[data-command-value]',el=>setDirectorCommand(line,{...command,value:el.value}));
  }else if(command.kind==='transition'){
    row.innerHTML=`<label>转场<select data-command-value>${['cut','fade'].map(v=>`<option value="${v}" ${v===command.value?'selected':''}>${v}</option>`).join('')}</select></label>`;
    bind('[data-command-value]',el=>setDirectorCommand(line,{...command,value:el.value}));
  }
  host.append(row);
}

function preferredDirectorCharacter(){
  const current=currentLine();const currentChar=project.characters.find(c=>c.id===current?.speakerId&&c.showOnStage);
  return currentChar||project.characters.find(c=>c.showOnStage)||project.characters[0]||null;
}
function directorTemplate(kind){
  const c=preferredDirectorCharacter(),name=c?.name||'角色名';
  const quote=v=>/\s/.test(v)?`"${v}"`:v;
  const firstAsset=k=>project.assets.find(a=>a.kind===k)?.name;
  if(kind==='expression'){const expr=characterExpressionNames(c).find(x=>x!=='default')||'default';return `/expression ${quote(name)} ${quote(expr)}`}
  if(kind==='motion')return `/motion ${quote(name)} shake_minor 0.5`;
  if(kind==='move')return `/move ${quote(name)}`;
  if(kind==='enter')return `/enter ${quote(name)} auto`;
  if(kind==='dismiss')return `/dismiss ${quote(name)}`;
  if(kind==='scene')return '/scene 新 Scene';
  if(kind==='background')return `/bg ${quote(firstAsset('background')||'none')}`;
  if(kind==='cg')return `/cg ${quote(firstAsset('cg')||'none')}`;
  if(kind==='object'){const object=project.customObjects?.[0];return object?`/object show ${quote(object.name)}`:'/object show 自定义对象'};
  if(kind==='bgm')return `/bgm ${quote(firstAsset('bgm')||'stop')}`;
  if(kind==='ambient')return `/ambient ${quote(firstAsset('ambient')||'stop')}`;
  if(kind==='sfx')return `/sfx ${quote(firstAsset('sfx')||'SFX素材名')}`;
  if(kind==='camera')return '/camera push';
  if(kind==='wait')return '/wait 0.5';
  return '/';
}
function insertDirectorCommand(kind){
  if(!project)return;selectedBeatId=null;
  const text=directorTemplate(kind);const line=createLine(project,'Director',text,'command');line.mouth='off';line.duration=null;syncCommandLine(line);
  const at=project.lines.length?Math.min(project.lines.length,selectedIndex+1):0;project.lines.splice(at,0,line);selectedIndex=at;selectedLineIds.clear();scheduleSave('插入导演指令',`command-insert:${line.id}`);renderAll();scrollActiveLineIntoView();
  requestAnimationFrame(()=>{if(kind==='raw'||(kind==='sfx'&&!line.command)){$('#textEdit')?.focus();$('#textEdit')?.select?.()}});
}


function insertDirectorCommandIntoBeat(kind,beat){
  if(!project||!beat)return;
  const text=directorTemplate(kind);const line=createLine(project,'Director',text,'command');line.mouth='off';line.duration=null;syncCommandLine(line);
  if(line.command)line.command.beatMode=beat.timingMode;
  const targetIndex=beat.targetLineId?project.lines.findIndex(item=>item.id===beat.targetLineId):Math.min(project.lines.length,beat.endIndex+1);
  const at=targetIndex<0?project.lines.length:targetIndex;project.lines.splice(at,0,line);selectedIndex=at;selectedLineIds.clear();
  scheduleSave('向演出 Beat 添加事件',`beat-add:${line.id}`);renderAll();
}
function moveBeatCommand(beat,lineId,direction){
  const ids=beat.commandLineIds;const pos=ids.indexOf(lineId);const next=pos+direction;if(pos<0||next<0||next>=ids.length)return;
  const a=project.lines.findIndex(line=>line.id===ids[pos]),b=project.lines.findIndex(line=>line.id===ids[next]);if(a<0||b<0)return;
  [project.lines[a],project.lines[b]]=[project.lines[b],project.lines[a]];scheduleSave('调整 Beat 内事件顺序','beat-reorder');renderAll();
}
function renderBeatInspector(beat){
  const card=$('#inspectorCard'),block=$('#beatInspectorBlock');card.classList.add('beat-editing');block.hidden=false;
  $('#inspectorTitle').textContent='当前演出 Beat';$('#beatInspectorSummary').textContent=`${beat.commandLineIds.length} 个事件 · ${beat.timingMode==='parallel'?'同时':'顺序'}`;
  const firstIndex=Math.max(0,beat.startIndex);const outlineEntry=effectiveOutlineAt(project,firstIndex);$('#contextPath').textContent=`# ${outlineEntry?.chapter||'未分章'}  /  § ${outlineEntry?.scene||'默认 Scene'}`;
  const timing=$('#beatTimingMode');timing.value=beat.timingMode;$('#beatTimingHint').textContent=beat.timingMode==='parallel'?'这一拍的非阻塞事件共用同一个 cue；SFX/BGM/状态同时触发，自定义动作与镜头作用到紧随其后的可见台词。/wait 仍然负责明确停顿。':'按左侧指令顺序逐条执行；适合需要先退场、再换景、再进入下一动作的演出。';
  timing.onchange=()=>{if(setDirectorBeatTiming(project,beat.id,timing.value)){scheduleSave('修改 Beat 事件关系','beat-timing');renderAll()}};
  const host=$('#beatEventList');host.innerHTML='';
  beat.commandLineIds.forEach((id,i)=>{const line=project.lines.find(item=>item.id===id);if(!line)return;const change=beat.changes.find(item=>item.lineId===id);const row=document.createElement('div');row.className='beat-event';row.innerHTML=`<div class="beat-event-main"><b>${escapeHtml(change?.label||line.text)}</b><span class="muted">${escapeHtml(line.text)}</span></div><div class="beat-event-actions"><button class="small" data-edit>编辑</button><button class="small" data-up ${i===0?'disabled':''}>↑</button><button class="small" data-down ${i===beat.commandLineIds.length-1?'disabled':''}>↓</button><button class="small danger" data-remove>×</button></div>`;
    row.querySelector('[data-edit]').onclick=()=>{selectedBeatId=null;selectedIndex=project.lines.findIndex(item=>item.id===id);renderAll();scrollActiveLineIntoView()};
    row.querySelector('[data-up]').onclick=()=>moveBeatCommand(beat,id,-1);row.querySelector('[data-down]').onclick=()=>moveBeatCommand(beat,id,1);
    row.querySelector('[data-remove]').onclick=()=>{deleteLinesStructureAware(project,[id]);selectedIndex=Math.max(0,Math.min(beat.startIndex,project.lines.length-1));scheduleSave('从 Beat 删除事件','beat-remove');renderAll()};host.append(row)});
  for(const button of block.querySelectorAll('[data-beat-add]'))button.onclick=()=>insertDirectorCommandIntoBeat(button.dataset.beatAdd,beat);
}

function renderInspector(){
  let beat=currentBeat();if(selectedBeatId&&!beat)selectedBeatId=null;
  const card=$('#inspectorCard'),beatBlock=$('#beatInspectorBlock');
  if(beat){renderBeatInspector(beat);return}
  card.classList.remove('beat-editing');beatBlock.hidden=true;
  const line=currentLine();const ids=['speakerEdit','typeEdit','durationEdit','textEdit','expressionEdit','mouthEdit','sfxEdit','textEffectEdit','textEffectDurationEdit','dialogueStyleEdit','bubbleDefinitionEdit','bubbleHeaderEdit','bubbleMainEdit','chapterEdit','sceneTitleEdit','backgroundEdit','cgEdit','bgmEdit','ambientEdit','cameraEdit','transitionEdit','cameraCurveEdit','transitionCurveEdit','backgroundMethodEdit','backgroundMethodDurationEdit','stageModeEdit','stageMethodEdit','stageMethodDurationEdit','diceRollsEdit','hpLabelEdit','hpMaxEdit','hpBeforeEdit','hpAfterEdit','lineLanguageEdit','linePauseScaleEdit','speechTextEdit','splitChapter','splitScene','mergeScenePrev','mergeChapterPrev','duplicateScene','duplicateChapter','deleteScene','deleteChapter','sceneTargetChapter','moveSceneToChapter'];ids.forEach(id=>$('#'+id).disabled=!line);if(!line)return;
  const isCommand=line.type==='command';const commandResult=isCommand?syncCommandLine(line):{command:null};
  $('#inspectorTitle').textContent=isCommand?'当前导演指令':'当前台词';$('#textEditLabel').firstChild.textContent=isCommand?'指令文本':'显示文字';$('#commandBlock').hidden=!isCommand;
  for(const id of ['displayDetails','sceneDetails','stageDetails','structureDetails','reuseDetails'])$('#'+id).hidden=isCommand;
  if(isCommand){const status=$('#commandParseStatus');status.textContent=commandResult.command?'已解析':(commandResult.error||'待编辑');status.className='status '+(commandResult.command?'ok':'warn');renderCommandStructuredEditor(line,commandResult)}else $('#commandStructuredEdit').innerHTML='';
  $('#speakerEdit').innerHTML=project.characters.map(c=>`<option value="${escapeHtml(c.id)}" ${c.id===line.speakerId?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
  $('#speakerEdit').disabled=isCommand;
  const outlineEntry=effectiveOutlineAt(project,selectedIndex);
  $('#typeEdit').value=line.type;$('#durationEdit').value=line.duration??'';$('#textEdit').value=line.text;$('#textEffectEdit').value=line.textEffect||'all';$('#textEffectDurationEdit').value=line.textEffectDuration??'';$('#lineLanguageEdit').value=line.speech?.languageOverride??'';$('#speechTextEdit').value=line.speech?.textOverride??'';const resolvedPause=resolveSpeechPauseScale(project,line),explicitPause=line.speech?.pauseScale;$('#linePauseScaleEdit').value=String(explicitPause??resolvedPause);$('#linePauseScaleValue').textContent=explicitPause==null?`继承 ${resolvedPause.toFixed(1)}×`:`${Number(explicitPause).toFixed(1)}×`;$('#chapterEdit').value=outlineEntry?.chapter||'';$('#sceneTitleEdit').value=outlineEntry?.scene||'';$('#dialogueStyleEdit').innerHTML=mediaDefOptions(line.dialogueStyleId);$('#dialogueStyleEdit').value=line.dialogueStyleId||'';$('#bubbleDefinitionEdit').innerHTML=mediaDefOptions(line.bubble?.definitionId);$('#bubbleDefinitionEdit').value=line.bubble?.definitionId||'';$('#bubbleHeaderEdit').value=line.bubble?.headerText||'';$('#bubbleMainEdit').value=line.bubble?.mainText||'';$('#dialogueStyleEdit').disabled=line.type!=='dialogue';$('#bubbleDefinitionEdit').disabled=line.type!=='bubble';$('#bubbleHeaderEdit').disabled=line.type!=='bubble';$('#bubbleMainEdit').disabled=line.type!=='bubble';
  const outline=buildScriptOutline(project.lines),chapters=[];const seenChapterKeys=new Set();for(const entry of outline){if(seenChapterKeys.has(entry.chapterKey))continue;seenChapterKeys.add(entry.chapterKey);chapters.push(entry)}
  $('#sceneTargetChapter').innerHTML=chapters.map(entry=>`<option value="${entry.index}" ${entry.chapterKey===outlineEntry?.chapterKey?'selected':''}>${escapeHtml(entry.chapter)}</option>`).join('');
  const character=project.characters.find(c=>c.id===line.speakerId);const exprs=characterExpressionNames(character);const expressionValue=line.expressionMode==='set'?(line.expression||'default'):'__inherit__';$('#expressionEdit').innerHTML=`<option value="__inherit__" ${expressionValue==='__inherit__'?'selected':''}>继承上一表情</option>`+exprs.map(name=>`<option value="${escapeHtml(name)}" ${name===expressionValue?'selected':''}>${escapeHtml(name)}</option>`).join('');
  $('#mouthEdit').value=line.mouth||'auto';$('#sfxEdit').innerHTML=simpleAssetOptions('sfx',line.sfxAssetId,'无 SFX');
  $('#backgroundEdit').innerHTML=patchSelectOptions('background','background');$('#cgEdit').innerHTML=patchSelectOptions('cg','cg');$('#bgmEdit').innerHTML=patchSelectOptions('bgm','bgm');$('#ambientEdit').innerHTML=patchSelectOptions('ambient','ambient');const cgPresentation=line.scene?.cgPresentation||{};$('#cgFitEdit').value=cgPresentation.fit||'contain';$('#cgMotionEdit').value=cgPresentation.motion||'none';$('#cgHideCharacters').checked=!!cgPresentation.hideCharacters;$('#cgHideTextbox').checked=!!cgPresentation.hideTextbox;renderSceneEffectsControls(line);
  $('#cameraEdit').value=line.scene?.camera||'none';$('#transitionEdit').value=line.scene?.transition||'cut';$('#cameraCurveEdit').value=line.scene?.cameraCurve||'sigmoid';$('#transitionCurveEdit').value=line.scene?.transitionCurve||'quadraticR';$('#backgroundMethodEdit').value=line.scene?.backgroundMethod||'replace';$('#backgroundMethodDurationEdit').value=line.scene?.backgroundMethodDuration??'';$('#stageMethodEdit').value=line.stageMethod?.name||'';$('#stageMethodDurationEdit').value=line.stageMethod?.duration??'';$('#diceRollsEdit').value=formatDiceRolls(line.diceRolls);const hp=line.hitPoint;$('#hpLabelEdit').value=hp?.label||'';$('#hpMaxEdit').value=hp?.max??'';$('#hpBeforeEdit').value=hp?.before??'';$('#hpAfterEdit').value=hp?.after??'';renderStageControls(line);
  const isDialogue=line.type==='dialogue',isBubble=line.type==='bubble',isDice=line.type==='dice',isHp=line.type==='hitpoint',isWheel=line.type==='wheel';$('#dialogueStyleWrap').hidden=!isDialogue;$('#bubbleBlock').hidden=!isBubble;$('#diceBlock').hidden=!isDice;$('#hpBlock').hidden=!isHp;$('#wheelBlock').hidden=!isWheel;if(isWheel){const steps=line.wheel?.steps||[];$('#wheelSummary').innerHTML=steps.length?`<strong>${escapeHtml(line.wheel?.title||'转盘')}</strong><div>${steps.length} 次转盘 · ${line.wheel?.mode==='history'?'历史结果重放':'交互抽取'}</div><ol>${steps.map(step=>`<li>${escapeHtml(step.title)} → <b>${escapeHtml(step.resultLabel)}</b></li>`).join('')}</ol>`:'尚未设置转盘演出。'}
  const chapter=outlineEntry?.chapter||'未分章',scene=outlineEntry?.scene||'默认 Scene';$('#contextPath').textContent=`# ${chapter}  /  § ${scene}`;$('#structureSummary').textContent=`${chapter} / ${scene}`;
  const effect=line.textEffect&&line.textEffect!=='all'?({w2w:'逐字',l2l:'逐行',run:'滚动'}[line.textEffect]||line.textEffect):'整句';const duration=line.duration==null?'自动时长':`${line.duration}s`;$('#displaySummary').textContent=isCommand?(line.command?.kind==='wait'?`等待 ${line.command.duration||0}s`:'即时事件'):`${duration} · ${effect}`;
  const assetLabel=id=>project.assets.find(a=>a.id===id)?.name||'';const sceneBits=[];const bg=line.scene&&has(line.scene,'background')?line.scene.background:null;if(bg)sceneBits.push(`背景 ${assetLabel(bg)||'已设置'}`);if(line.scene?.camera&&line.scene.camera!=='none')sceneBits.push(`镜头 ${line.scene.camera}`);if(line.cameraTransform!==undefined||currentPerf()?.cameraPlacementSource==='inherited')sceneBits.push(line.cameraTransform===null?'镜头全景':'镜头已取景');if(line.scene?.transition&&line.scene.transition!=='cut')sceneBits.push('淡入淡出');if(line.scene&&has(line.scene,'bgm')&&line.scene.bgm)sceneBits.push(`BGM ${assetLabel(line.scene.bgm)||'已设置'}`);if(line.scene&&has(line.scene,'ambient')&&line.scene.ambient)sceneBits.push(`环境声 ${assetLabel(line.scene.ambient)||'已设置'}`);$('#sceneSummary').textContent=sceneBits.join(' · ')||'继承 / 默认';
  const roster=currentPerf()?.stage?.map(a=>a.characterId)||[];$('#stageSummary').textContent=line.stageMode==='custom'?`手动 · ${roster.length} 人`:`自动 · ${roster.length} 人`;$('#customStageWrap').hidden=(line.stageMode||'auto')!=='custom';sceneViewport?.render();renderStageQuickControls();
}


async function renderPreviewStatic(){
  if(!renderer||!performanceDoc?.lines.length)return;
  const selected=currentPerf();if(!selected)return;
  const located=locatePerformanceLine(performanceDoc,playbackCursorTime);
  if(!located||located.index!==selectedIndex)playbackCursorTime=selected.start;
  const local=Math.max(0,Math.min(selected.duration,playbackCursorTime-selected.start));
  await renderer.renderLine(selectedIndex,local);
  $('#linePosition').textContent=`${selectedIndex+1} / ${project.lines.length}`;
  $('#timeLabel').textContent=`${playbackCursorTime.toFixed(1)} / ${performanceDoc.duration.toFixed(1)}s`;
  $('#seek').value=performanceDoc.duration?Math.round(playbackCursorTime/performanceDoc.duration*1000):0;
}
function renderState(){const p=currentPerf(),source=currentLine();$('#stateOutput').textContent=p?JSON.stringify({command:source?.command||null,directorBeatId:p.directorBeatId||null,chapter:p.chapterTitle,scene:p.sceneTitle,state:p.state,stage:p.stage,stageMethod:p.stageMethod,expression:p.expression,mouth:p.mouth,textEffect:p.textEffect,textEffectDuration:p.textEffectDuration,camera:p.camera,cameraTransform:p.cameraTransform,cameraPlacementSource:p.cameraPlacementSource,cameraCurve:p.cameraCurve,transition:p.transition,transitionCurve:p.transitionCurve,backgroundMethod:p.backgroundMethod,backgroundMethodDuration:p.backgroundMethodDuration,diceRolls:p.diceRolls,hitPoint:p.hitPoint,wheel:p.wheel,bubble:p.bubble,dialogueStyleId:p.dialogueStyleId,audio:p.audioAssetId,sfx:p.sfxAssetId},null,2):''}

function renderVoiceLineWorkbench(){
  const host=$('#voiceLineWorkbench');if(!host)return;const line=currentLine(),perf=currentPerf();if(!line||!perf){host.innerHTML='<span class="muted">选择一句台词后，这里显示与对话框绑定的人声与本句音效。</span>';return}
  const asset=line.audioAssetId?project.assets.find(a=>a.id===line.audioAssetId):null,sfx=line.sfxAssetId?project.assets.find(a=>a.id===line.sfxAssetId):null,duration=Number(asset?.metadata?.duration)||0,lineMix=line.audioMix??={};
  host.innerHTML=`<div class="row"><strong>${escapeHtml(charName(line.speakerId))}</strong><span class="status ${asset?'ok':'warn'}">${asset?'已绑定 Voice':'无 Voice'}</span><span class="muted" style="margin-left:auto">lineId · ${escapeHtml(line.id)}</span></div><div class="voice-bound-text">${escapeHtml(line.text||'（无显示文字）')}</div><div class="muted">${asset?`${escapeHtml(asset.name)} · ${duration?duration.toFixed(2)+'s':'时长未知'}`:'AI 生成或绑定录音后，Voice Clip 会直接出现在同一句 Dialogue 下方。'}</div><label>人声音量 <span class="summary-meta">${Math.round((Number(lineMix.voiceGain)||1)*100)}%</span><input data-line-audio="voiceGain" type="range" min="0" max="2" step="0.01" value="${Number(lineMix.voiceGain)||1}"></label>${sfx?`<div class="card stack"><div class="row"><strong>本句音效</strong><span class="muted">${escapeHtml(sfx.name)}</span></div><label>音效音量 <span class="summary-meta">${Math.round((Number(lineMix.sfxGain)||1)*100)}%</span><input data-line-audio="sfxGain" type="range" min="0" max="2" step="0.01" value="${Number(lineMix.sfxGain)||1}"></label></div>`:''}<details class="advanced-only"><summary>精确声音时间 / 声像</summary><div class="grid2 disclosure-body"><label>人声声像 <span class="summary-meta">${(Number(lineMix.voicePan)||0).toFixed(2)}</span><input data-line-audio="voicePan" type="range" min="-1" max="1" step="0.01" value="${Number(lineMix.voicePan)||0}"></label><label>人声延后（秒）<input data-line-audio="voiceOffset" type="number" min="-5" max="10" step="0.05" value="${Number(lineMix.voiceOffset)||0}"></label><label>句前停留（秒）<input data-line-audio="preRoll" type="number" min="0" max="10" step="0.05" value="${Number(lineMix.preRoll)||0}"></label><label>句后停留（秒）<input data-line-audio="postRoll" type="number" min="0" max="10" step="0.05" value="${Number(lineMix.postRoll)||0}"></label>${sfx?`<label>音效声像 <span class="summary-meta">${(Number(lineMix.sfxPan)||0).toFixed(2)}</span><input data-line-audio="sfxPan" type="range" min="-1" max="1" step="0.01" value="${Number(lineMix.sfxPan)||0}"></label>`:''}</div></details><div class="row"><button class="small" data-line-audio-action="open">AI 人声 / 选声音</button>${asset?'<button class="small" data-line-audio-action="detach">解除 Voice 绑定</button>':''}</div>`
  host.querySelectorAll('[data-line-audio]').forEach(el=>el.addEventListener('change',()=>{line.audioMix??={};line.audioMix[el.dataset.lineAudio]=Number(el.value);scheduleSave('修改本句音频',`${line.id}:audio-mix`);renderAll()}));
  host.querySelector('[data-line-audio-action="open"]')?.addEventListener('click',()=>$('#openVoiceWorkbench')?.click());
  host.querySelector('[data-line-audio-action="detach"]')?.addEventListener('click',()=>{line.audioAssetId=null;scheduleSave('解除本句 Voice',`${line.id}:voice-detach`);renderAll()});
}
function setWorkbenchTab(tab){
  const allowed=['performance','audio','voice','animation'];if(!allowed.includes(tab))tab='performance';uiPrefs.workbenchTab=tab;saveUiPrefs();
  document.querySelectorAll('[data-workbench-tab]').forEach(button=>button.classList.toggle('active',button.dataset.workbenchTab===tab));
  document.querySelectorAll('[data-workbench-pane]').forEach(pane=>pane.hidden=pane.dataset.workbenchPane!==tab);
  if(tab==='audio')audioWorkbench?.render();if(tab==='voice')renderVoiceLineWorkbench();
}
function setWorkbenchSize(size){
  if(!['collapsed','standard','expanded','custom'].includes(size))size='standard';
  uiPrefs.workbenchSize=size;const bench=$('#workbench');bench.dataset.size=size;
  bench.style.removeProperty('flex');bench.style.removeProperty('min-height');
  if(size==='custom'){const height=clampNumber(uiPrefs.workbenchHeight||400,180,Math.max(300,window.innerHeight*.72));bench.style.flex=`0 0 ${height}px`;bench.style.minHeight=`${height}px`}
  document.querySelectorAll('[data-workbench-size]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.workbenchSize===size)));saveUiPrefs();
}
function renderStageQuickControls(){
  const line=currentLine(),perf=currentPerf();$('#stageQuickControls').hidden=!line||line.type==='command';
  const names=(perf?.stage||[]).map(actor=>project.characters.find(c=>c.id===actor.characterId)?.name).filter(Boolean);
  $('#stageQuickRoster').textContent=names.length?`当前 ${names.length} 人：${names.join('、')}`:'当前无人上镜';
}
function setupWorkbenchResize(){
  const grip=$('#workbenchResize');
  grip.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();const startY=event.clientY,startHeight=$('#workbench').getBoundingClientRect().height;grip.setPointerCapture?.(event.pointerId);
    const move=e=>{uiPrefs.workbenchHeight=clampNumber(startHeight+startY-e.clientY,180,Math.max(300,window.innerHeight*.72));setWorkbenchSize('custom')};
    const finish=()=>{grip.removeEventListener('pointermove',move);grip.removeEventListener('pointerup',finish);grip.removeEventListener('pointercancel',finish)};
    grip.addEventListener('pointermove',move);grip.addEventListener('pointerup',finish);grip.addEventListener('pointercancel',finish);
  };
  grip.onkeydown=event=>{if(!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();uiPrefs.workbenchHeight=$('#workbench').getBoundingClientRect().height+(event.key==='ArrowUp'?40:-40);setWorkbenchSize('custom')};
}

function setContextTab(tab){
  if(!['properties','check','publish'].includes(tab))tab='properties';uiPrefs.contextTab=tab;saveUiPrefs();
  document.querySelectorAll('[data-context-tab]').forEach(button=>button.classList.toggle('active',button.dataset.contextTab===tab));
  document.querySelectorAll('.panel.right>.body>[data-context-pane]').forEach(pane=>pane.hidden=pane.dataset.contextPane!==tab);
  if(tab==='properties')syncCenterContext();
}
function setupWorkbenchLayout(){
  const performancePane=$('#workbenchPerformance'),stage=$('#stageReady');
  $('#stageQuickCount').append($('#maxOnStageEdit').closest('label'));$('#stageQuickMode').append($('#stageModeEdit').closest('label'));
  $('#stageQuickChoose').onclick=()=>{if($('#stageModeEdit').value!=='custom'){$('#stageModeEdit').value='custom';$('#stageModeEdit').dispatchEvent(new Event('change'))}$('#stageDetails').open=true;setWorkbenchTab('performance');if(uiPrefs.workbenchSize==='collapsed')setWorkbenchSize('expanded');$('#stageDetails').scrollIntoView({block:'nearest',behavior:'smooth'})};
  setupWorkbenchResize();
  for(const selector of ['.stage-edit-bar','.playback',':scope > .row','.playtest-entry']){const element=stage?.querySelector(selector);if(element)performancePane.append(element)}
  performancePane.append($('#stageDetails'));
  const rightBody=document.querySelector('.panel.right>.body'),inspector=$('#inspectorCard');if(rightBody&&inspector){inspector.classList.add('context-inspector-host');inspector.dataset.contextPane='properties';rightBody.prepend(inspector)}
  document.querySelectorAll('[data-context-tab]').forEach(button=>button.addEventListener('click',()=>setContextTab(button.dataset.contextTab)));setContextTab(uiPrefs.contextTab||'properties');
  document.querySelectorAll('[data-workbench-tab]').forEach(button=>button.addEventListener('click',()=>setWorkbenchTab(button.dataset.workbenchTab)));
  document.querySelectorAll('[data-workbench-size]').forEach(button=>button.addEventListener('click',()=>setWorkbenchSize(button.dataset.workbenchSize)));
  setWorkbenchSize(uiPrefs.workbenchSize||'standard');setWorkbenchTab(uiPrefs.workbenchTab||'performance');
  audioWorkbench=new AudioWorkbenchController({root:$('#workbenchAudio'),getProject:()=>project,getPerformance:()=>performanceDoc,getSelectedIndex:()=>selectedIndex,getPlayhead:()=>playbackCursorTime,resolveAsset,scheduleBuilder:buildAudioSchedule,escapeHtml,onSelectLine(lineId){const index=project?.lines.findIndex(line=>line.id===lineId)??-1;if(index<0)return;selectedIndex=index;selectedBeatId=null;renderAll();scrollActiveLineIntoView()},onSeek(time){player?.stop();playbackCursorTime=Math.max(0,Math.min(performanceDoc?.duration||0,time));const located=performanceDoc?locatePerformanceLine(performanceDoc,playbackCursorTime):null;if(located){selectedIndex=located.index;void renderer?.renderLine(located.index,located.localTime)}if($('#seek')&&performanceDoc)$('#seek').value=performanceDoc.duration?Math.round(playbackCursorTime/performanceDoc.duration*1000):0;if($('#timeLabel')&&performanceDoc)$('#timeLabel').textContent=`${playbackCursorTime.toFixed(1)} / ${performanceDoc.duration.toFixed(1)}s`;renderScript();renderInspector();renderVoiceLineWorkbench();audioWorkbench?.render()},onMutate(label,key,full){scheduleSave(label,key);compile();if(full)renderAll()}});audioWorkbench.mount();
  $('#voiceWorkbenchOpen').onclick=()=>$('#openVoiceWorkbench')?.click();$('#voiceWorkbenchPlay').onclick=()=>$('#playLine')?.click();
}
function syncCenterContext(){
  const ready=!!project?.lines?.length;
  const inspector=$('#inspectorCard'),hint=$('#centerContextHint');
  const showInspector=ready&&activeView==='script'&&!['stage','output'].includes(uiPrefs.layout);
  if(inspector)inspector.hidden=!showInspector;
  if(!hint)return;
  const messages={
    characters:'<strong>正在编辑角色。</strong> 舞台预览继续保留；当前台词的 Inspector 已收起，避免把角色设置和单句演出混在一起。',
    assets:'<strong>正在管理素材。</strong> 先整理文件和失效链接；要把素材用于具体台词或 Scene 时，回到“剧本”。',
    mediaDefs:'<strong>正在编辑样式。</strong> 这里定义可复用样式；具体绑定到哪句台词 / 气泡仍在“剧本”里完成。'
  };
  const message=ready&&!['stage','output'].includes(uiPrefs.layout)?messages[activeView]:null;
  hint.hidden=!message;
  if(message)hint.innerHTML=message;
}

function renderCurrentView(){if(activeView==='script')renderScript();if(activeView==='characters')renderCharacters();if(activeView==='assets')renderAssets();if(activeView==='mediaDefs')renderMediaDefinitions()}
function setContentView(view,{persist=true,render=true}={}){
  const allowed=['script','characters','assets','mediaDefs'];
  if(!allowed.includes(view))view='script';
  if(view==='mediaDefs'&&!uiPrefs.advanced)view='script';
  activeView=view;
  if(view!=='script'&&scriptVirtualList){scriptVirtualList.destroy();scriptVirtualList=null;virtualRenderToken++}
  if(persist){uiPrefs.activeView=view;saveUiPrefs()}
  for(const button of document.querySelectorAll('#contentTabs [data-view]')){
    const active=button.dataset.view===view;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',active?'true':'false');
    button.tabIndex=active?0:-1;
  }
  $('#scriptTools').hidden=view!=='script';
  $('#assetTools').hidden=view!=='assets';
  for(const panel of document.querySelectorAll('[data-view-panel]'))panel.hidden=panel.dataset.viewPanel!==view;
  syncCenterContext();
  if(render)renderCurrentView();
}
function renderAll(){if(!project)return;selectedIndex=Math.max(0,Math.min(selectedIndex,Math.max(0,project.lines.length-1)));refreshSearch();compile();updateToolbarOptions();renderCurrentView();renderInspector();stageDirectEditor?.render();cameraDirectEditor?.render();sceneViewport?.render();renderStageQuickControls();renderVoiceLineWorkbench();audioWorkbench?.render();updateSelectionUi();updateHistoryUi();void renderPreviewStatic();emitProjectState()}

function bindEdit(id,fn,event='change',fullRender=true){$('#'+id).addEventListener(event,()=>{const line=currentLine();if(!line)return;fn(line,$('#'+id).value);scheduleSave('编辑台词',`${line.id}:${id}`);if(fullRender)renderAll()})}
bindEdit('speakerEdit',(l,v)=>l.speakerId=v);bindEdit('typeEdit',(l,v)=>{l.type=v;if(v==='command'){l.text=l.text.startsWith('/')?l.text:'/wait 0';l.mouth='off';syncCommandLine(l)}else l.command=null;if(v==='dice')l.diceRolls??=[];if(v==='hitpoint')ensureHitPoint(l);if(v==='wheel'){l.wheel??={title:'转盘',mode:'history',steps:[{title:'转盘',options:[{id:'a',label:'A',weight:1},{id:'b',label:'B',weight:1}],resultId:'a',resultLabel:'A'}],blockingAuto:false};l.mouth='off';l.duration??=2.8}if(v==='bubble'){ensureBubble(l);l.mouth='off'}});bindEdit('durationEdit',(l,v)=>l.duration=v===''?null:Number(v));bindEdit('textEdit',(l,v)=>{l.text=v;if(l.type==='command')syncCommandLine(l);if(l.type==='bubble')ensureBubble(l).mainText=v},'input',false);$('#textEdit').addEventListener('change',()=>renderAll());bindEdit('expressionEdit',(l,v)=>{if(v==='__inherit__'){l.expressionMode='inherit';return}l.expressionMode='set';l.expression=v});bindEdit('mouthEdit',(l,v)=>l.mouth=v);bindEdit('sfxEdit',(l,v)=>l.sfxAssetId=v||null);bindEdit('textEffectEdit',(l,v)=>l.textEffect=v);bindEdit('textEffectDurationEdit',(l,v)=>l.textEffectDuration=v===''?null:Number(v));
$('#lineLanguageEdit').addEventListener('change',()=>{const l=currentLine();if(!l)return;l.speech??={};l.speech.languageOverride=$('#lineLanguageEdit').value.trim()||null;scheduleSave('修改本句朗读语言',`${l.id}:speech-language`);renderAll()});$('#speechTextEdit').addEventListener('change',()=>{const l=currentLine();if(!l)return;l.speech??={};l.speech.textOverride=$('#speechTextEdit').value||null;scheduleSave('修改本句朗读文本',`${l.id}:speech-text`);renderAll()});$('#linePauseScaleEdit').addEventListener('input',()=>{const l=currentLine();if(!l)return;l.speech??={};l.speech.pauseScale=Number($('#linePauseScaleEdit').value);$('#linePauseScaleValue').textContent=`${Number(l.speech.pauseScale).toFixed(1)}×`;scheduleSave('修改本句停顿强度',`${l.id}:speech-pause`)});
$('#linePauseReset').onclick=()=>{const l=currentLine();if(!l)return;l.speech??={};delete l.speech.pauseScale;scheduleSave('恢复本句停顿继承',`${l.id}:speech-pause-reset`);renderInspector()};
bindEdit('dialogueStyleEdit',(l,v)=>l.dialogueStyleId=v||null);bindEdit('bubbleDefinitionEdit',(l,v)=>ensureBubble(l).definitionId=v||null);bindEdit('bubbleHeaderEdit',(l,v)=>ensureBubble(l).headerText=v);bindEdit('bubbleMainEdit',(l,v)=>{const b=ensureBubble(l);b.mainText=v;l.text=v},'input',false);$('#bubbleMainEdit').addEventListener('change',()=>renderAll());
$('#chapterEdit').addEventListener('change',()=>{if(!project?.lines.length)return;if(renameChapter(project,selectedIndex,$('#chapterEdit').value)){scheduleSave('重命名 Chapter','outline-rename');renderAll()}});
$('#sceneTitleEdit').addEventListener('change',()=>{if(!project?.lines.length)return;if(renameScene(project,selectedIndex,$('#sceneTitleEdit').value)){scheduleSave('重命名 Scene','outline-rename');renderAll()}});
bindEdit('backgroundEdit',(l,v)=>setPatch(l,'background',v));bindEdit('cgEdit',(l,v)=>setPatch(l,'cg',v));bindEdit('bgmEdit',(l,v)=>setPatch(l,'bgm',v));bindEdit('ambientEdit',(l,v)=>setPatch(l,'ambient',v));
function updateCgPresentation(mutator,label){const l=currentLine();if(!l)return;l.scene??={};l.scene.cgPresentation??={};mutator(l.scene.cgPresentation);scheduleSave(label||'修改 CG 演出',`${l.id}:cg-presentation`);renderAll()}

const SCENE_FILTER_PRESETS={
  none:[],
  night:[{kind:'brightness',amount:.78,metadata:{preset:'night'}},{kind:'saturation',amount:.72},{kind:'tint',amount:.26,color:'#6577ad'}],
  warm:[{kind:'brightness',amount:.98,metadata:{preset:'warm'}},{kind:'tint',amount:.18,color:'#f0b36b'}],
  desaturate:[{kind:'saturation',amount:.48,metadata:{preset:'desaturate'}}],
  grayscale:[{kind:'grayscale',amount:1,metadata:{preset:'grayscale'}}],
  dream:[{kind:'brightness',amount:1.06,metadata:{preset:'dream'}},{kind:'saturation',amount:.82},{kind:'blur',amount:1.2}],
  blur:[{kind:'blur',amount:4,metadata:{preset:'blur'}}],
  contrast:[{kind:'contrast',amount:1.24,metadata:{preset:'contrast'}},{kind:'saturation',amount:1.08}]
};
function sceneFilterStack(name){return {filters:structuredClone(SCENE_FILTER_PRESETS[name]||[]),mask:null}}
function sceneFilterPresetName(stack){return stack?.filters?.find(filter=>filter?.metadata?.preset)?.metadata?.preset||(!stack?.filters?.length?'none':'none')}
function ensureSceneGraphPatch(line){line.scene??={};line.scene.sceneGraph??={};return line.scene.sceneGraph}
function effectiveSceneGraph(){return currentPerf()?.sceneGraph||project?.sceneGraph||{ambientLight:{enabled:false,color:'#ffffff',intensity:0,layers:[]},worldEffects:{filters:[],mask:null},outputEffects:{filters:[],mask:null},layers:[]}}
function updateSceneGraphPatch(mutator,label,key='scene-graph'){const line=currentLine();if(!line)return;const patch=ensureSceneGraphPatch(line);mutator(patch,effectiveSceneGraph());scheduleSave(label,key);renderAll()}
function renderSceneEffectsControls(line){
  const graph=effectiveSceneGraph(),ambient=graph.ambientLight||{enabled:false,color:'#ffffff',intensity:0,layers:[]};
  $('#ambientLightEnable').checked=!!ambient.enabled;$('#ambientLightColor').value=/^#[0-9a-f]{6}$/i.test(ambient.color||'')?ambient.color:'#ffffff';$('#ambientLightIntensity').value=String(Number(ambient.intensity)||0);$('#ambientLightValue').textContent=`${Math.round((Number(ambient.intensity)||0)*100)}%`;
  const layers=new Set(ambient.layers||[]);$('#ambientLayerBackground').checked=layers.has('world.background');$('#ambientLayerCg').checked=layers.has('world.cg');$('#ambientLayerCharacters').checked=layers.has('world.characters');
  $('#worldFilterPreset').value=sceneFilterPresetName(graph.worldEffects);$('#outputFilterPreset').value=sceneFilterPresetName(graph.outputEffects);
  const target=$('#layerFilterTarget').value||'world.characters';const layer=graph.layers?.find(item=>item.id===target);$('#layerFilterPreset').value=sceneFilterPresetName(layer?.effects);
  const effectiveCg=currentPerf()?.state?.cgPresentation||line.scene?.cgPresentation||{};const mask=effectiveCg.mask||null;$('#cgMaskKind').value=mask?.kind||'none';$('#cgMaskAnimation').value=mask?.animation||'none';$('#cgMaskInvert').checked=!!mask?.inverted;$('#cgMaskX').value=String(mask?.x??.5);$('#cgMaskY').value=String(mask?.y??.5);$('#cgMaskSize').value=String(mask?.kind==='rect'?(mask?.width??.7):(mask?.radius??.42));$('#cgMaskFeather').value=String(mask?.feather??.08);
  const imageAssets=project.assets.filter(asset=>['background','cg','character','other'].includes(asset.kind));$('#cgMaskAsset').innerHTML=`<option value="">选择 Alpha 遮罩图片</option>${imageAssets.map(asset=>`<option value="${escapeHtml(asset.id)}" ${asset.id===mask?.assetId?'selected':''}>${escapeHtml(asset.name)}</option>`).join('')}`;$('#cgMaskAsset').disabled=$('#cgMaskKind').value!=='asset';
}
$('#cgFitEdit').addEventListener('change',()=>updateCgPresentation(p=>p.fit=$('#cgFitEdit').value));$('#cgMotionEdit').addEventListener('change',()=>updateCgPresentation(p=>p.motion=$('#cgMotionEdit').value));$('#cgHideCharacters').addEventListener('change',()=>updateCgPresentation(p=>p.hideCharacters=$('#cgHideCharacters').checked));$('#cgHideTextbox').addEventListener('change',()=>updateCgPresentation(p=>p.hideTextbox=$('#cgHideTextbox').checked));
function writeAmbientFromControls(){updateSceneGraphPatch((patch,graph)=>{patch.ambientLight={enabled:$('#ambientLightEnable').checked,color:$('#ambientLightColor').value,intensity:Number($('#ambientLightIntensity').value)||0,layers:[...new Set([$('#ambientLayerBackground').checked?'world.background':null,$('#ambientLayerCg').checked?'world.cg':null,$('#ambientLayerCharacters').checked?'world.characters':null,'world.front-fx'].filter(Boolean))]}} ,'修改环境光','scene-light')}
$('#ambientLightEnable').addEventListener('change',writeAmbientFromControls);$('#ambientLightColor').addEventListener('input',writeAmbientFromControls);$('#ambientLightIntensity').addEventListener('input',()=>{$('#ambientLightValue').textContent=`${Math.round(Number($('#ambientLightIntensity').value)*100)}%`;writeAmbientFromControls()});for(const id of ['ambientLayerBackground','ambientLayerCg','ambientLayerCharacters'])$('#'+id).addEventListener('change',writeAmbientFromControls);
$('#worldFilterPreset').addEventListener('change',()=>updateSceneGraphPatch(p=>p.worldEffects=sceneFilterStack($('#worldFilterPreset').value),'修改世界滤镜','scene-world-filter'));
$('#outputFilterPreset').addEventListener('change',()=>updateSceneGraphPatch(p=>p.outputEffects=sceneFilterStack($('#outputFilterPreset').value),'修改最终画面滤镜','scene-output-filter'));
$('#layerFilterTarget').addEventListener('change',()=>renderSceneEffectsControls(currentLine()));$('#layerFilterPreset').addEventListener('change',()=>updateSceneGraphPatch(p=>{p.layerEffects??={};p.layerEffects[$('#layerFilterTarget').value]=sceneFilterStack($('#layerFilterPreset').value)},'修改图层滤镜','scene-layer-filter'));
function writeCgMask(){const kind=$('#cgMaskKind').value;if(kind==='none'){updateCgPresentation(p=>p.mask=null,'移除 CG 遮罩');return}updateCgPresentation(p=>{const size=Number($('#cgMaskSize').value)||.42;p.mask={kind,assetId:kind==='asset'?($('#cgMaskAsset').value||null):null,inverted:$('#cgMaskInvert').checked,x:Number($('#cgMaskX').value)||.5,y:Number($('#cgMaskY').value)||.5,radius:size,width:size,height:Math.min(1.5,size),feather:Number($('#cgMaskFeather').value)||0,animation:$('#cgMaskAnimation').value,duration:Number(p.duration)||.6}},'修改 CG 遮罩')}
for(const id of ['cgMaskKind','cgMaskAsset','cgMaskAnimation','cgMaskInvert'])$('#'+id).addEventListener('change',writeCgMask);for(const id of ['cgMaskX','cgMaskY','cgMaskSize','cgMaskFeather'])$('#'+id).addEventListener('input',writeCgMask);
bindEdit('cameraEdit',(l,v)=>{l.scene??={};l.scene.camera=v});bindEdit('transitionEdit',(l,v)=>{l.scene??={};l.scene.transition=v});bindEdit('cameraCurveEdit',(l,v)=>{l.scene??={};l.scene.cameraCurve=v});bindEdit('transitionCurveEdit',(l,v)=>{l.scene??={};l.scene.transitionCurve=v});bindEdit('backgroundMethodEdit',(l,v)=>{l.scene??={};l.scene.backgroundMethod=v});bindEdit('backgroundMethodDurationEdit',(l,v)=>{l.scene??={};l.scene.backgroundMethodDuration=v===''?null:Number(v)});bindEdit('stageModeEdit',(l,v)=>{if(v==='custom'&&!(l.stageIds?.length)){const stage=currentPerf()?.stage||[];l.stageIds=stage.map(actor=>actor.characterId);l.stagePositions=Object.fromEntries(stage.map(actor=>[actor.characterId,actor.position]))}l.stageMode=v});
$('#autoStageModeEdit').addEventListener('change',()=>{if(!project)return;project.settings.autoStageMode=$('#autoStageModeEdit').value;scheduleSave('修改自动立绘调度','auto-stage-mode');renderAll()});
$('#maxOnStageEdit').addEventListener('change',()=>{if(!project)return;project.settings.maxOnStage=Math.max(1,Math.min(3,Number($('#maxOnStageEdit').value)||2));scheduleSave('修改自动同屏人数','auto-stage-count');renderAll()});
$('#speakerFocusEdit').addEventListener('change',()=>{if(!project)return;const value=$('#speakerFocusEdit').value;project.settings.speakerFocus=value;project.settings.dimOthers=value!=='none';scheduleSave('修改说话人焦点','speaker-focus');renderAll()});
bindEdit('stageMethodEdit',(l,v)=>{if(!v.trim()){l.stageMethod=null;return}l.stageMethod={name:v.trim(),duration:l.stageMethod?.duration??0.5}});bindEdit('stageMethodDurationEdit',(l,v)=>{if(v===''&&!l.stageMethod)return;l.stageMethod??={name:'replace',duration:0.5};l.stageMethod.duration=v===''?0.5:Number(v)});
$('#diceRollsEdit').addEventListener('change',()=>{const l=currentLine();if(!l)return;l.diceRolls=parseDiceRollsEditor($('#diceRollsEdit').value);scheduleSave('编辑骰点演出',`${l.id}:dice`);renderAll()});
for(const id of ['hpLabelEdit','hpMaxEdit','hpBeforeEdit','hpAfterEdit'])$('#'+id).addEventListener('change',()=>{const l=currentLine();if(!l)return;const hp=ensureHitPoint(l);hp.label=$('#hpLabelEdit').value||hp.label;const max=Number($('#hpMaxEdit').value),before=Number($('#hpBeforeEdit').value),after=Number($('#hpAfterEdit').value);if(Number.isFinite(max)&&max>0)hp.max=max;if(Number.isFinite(before))hp.before=before;if(Number.isFinite(after))hp.after=after;scheduleSave('编辑 HP 演出',`${l.id}:hp`);renderAll()});

$('#projectTitle').onchange=()=>{if(!project)return;project.title=$('#projectTitle').value.trim()||'未命名 Replay';scheduleSave('重命名工程','project-title');renderAll()};
$('#newProject').onclick=async()=>{if(project?.lines?.length&&!confirm('新建工程会替换当前内容，并更新自动恢复快照。若尚未保存到工程目录，请先保存或导出 Project JSON。继续吗？'))return;workspace=null;runtimeFiles.clear();$('#projectState').textContent='未保存到文件夹';$('#projectState').className='status';$('#saveProject').disabled=true;$('#workspaceDetail').textContent='未连接工程目录。剧本会自动恢复；图片和音频最好连接目录后保存。';await setProject(createProject('未命名 Replay'),'新建工程');$('#importDetails').open=true};
$('#chooseWorkspace').onclick=chooseWorkspace;$('#saveProject').onclick=async()=>{await saveIfConnected()};$('#reloadWorkspace').onclick=async()=>{if(!workspace)return;if(project&&history.canUndo()&&!confirm('重新载入会用目录中的最新工程替换本页当前状态。若本页改动需要保留，请先在右侧导出 Project JSON。继续吗？'))return;try{const latest=await workspace.loadProject();if(!latest){$('#workspaceDetail').textContent='目录里没有 project.replaylab.json。';return}workspaceConflict=false;$('#reloadWorkspace').hidden=true;$('#saveProject').disabled=false;$('#projectState').textContent='工程目录 · 自动保存';$('#projectState').className='status ok';runtimeFiles.clear();project=normalizeReplayProject(latest);selectedIndex=0;selectedBeatId=null;selectedLineIds.clear();collapsedGroups.clear();performanceClipboard=null;history.reset(project,'重新载入目录版本');invalidateMediaCaches();renderAll();await refreshWorkspace();$('#importStatus').textContent='已重新载入目录中的最新工程。'}catch(error){$('#workspaceDetail').textContent=`重新载入失败：${error.message||error}`}};
$('#parseText').onclick=async()=>{const text=$('#logInput').value.trim();if(!text){$('#importStatus').textContent='先粘贴一段 Log，或改用文件导入。';return}if(!confirmScriptReimport('解析这份 Log'))return;const importer=registry.choose(text,{sourceName:'log.txt'});if(!importer){$('#importStatus').textContent='没有识别出 Log 格式。';return}const imported=importer.parse(text,{title:project?.title||'Replay'});if(preservingSetupOnReimport()){applyScriptReimport(imported,`重新解析 Log · 保留角色设置`);return}runtimeFiles.clear();invalidateMediaCaches();await setProject(imported,importer.label);$('#importDetails').open=false};
$('#parseStory').onclick=async()=>{const text=$('#logInput').value.trim();if(!text){$('#importStatus').textContent='先粘贴剧情台本。';return}if(!confirmScriptReimport('解析这份剧情台本'))return;const imported=parseStoryScript(text,project?.title||'Replay');if(preservingSetupOnReimport()){applyScriptReimport(imported,'重新解析剧情台本 · 保留角色设置');return}runtimeFiles.clear();invalidateMediaCaches();await setProject(imported,'剧情台本 / 伪 TRPG 文游');$('#importDetails').open=false};
$('#importWheelHistory').onclick=()=>$('#wheelHistoryFile').click();$('#wheelHistoryFile').onchange=async event=>{const file=event.target.files?.[0];if(!file||!project)return;try{const summary=appendWheelHistoryToProject(project,await file.text());if(summary.imported){const first=project.lines.findIndex(line=>line.id===summary.lines[0]);if(first>=0)selectedIndex=first;scheduleSave('导入转盘历史','wheel-history-import');await saveIfConnected();renderAll();$('#importStatus').textContent=`转盘历史：导入 ${summary.imported} 条演出 · 跳过 ${summary.skipped} 条非转盘记录`;$('#importDetails').open=false}else $('#importStatus').textContent='档案里没有可转换的转盘历史。'}catch(error){$('#importStatus').textContent=`转盘历史导入失败：${error.message||error}`}finally{event.target.value=''}};
$('#showSample').onclick=()=>{$('#logInput').value='Arthur: 我要调查这扇门。\nKP: 投一个侦查。\nArthur: 1d100 = 32 / 65，成功。\nMatthew: 我看看地上有没有脚印。';$('#logInput').focus()};
$('#pickLogFiles').onclick=()=>$('#logFiles').click();$('#logFiles').onchange=async event=>{const files=[...event.target.files];if(!files.length)return;if(!confirmScriptReimport('导入这些 Log')){event.target.value='';return}const result=await importVirtualFolder(files.map(virtualFile),registry);if(preservingSetupOnReimport()){applyScriptReimport(result.project,`重新导入 ${files.length} 个 Log · 保留角色设置`);event.target.value='';return}runtimeFiles.clear();await setProject(result.project,`导入 ${files.length} 个文件 · 忽略 ${result.ignored.length}`);$('#importDetails').open=false;event.target.value=''};
$('#pickFolder').onclick=()=>$('#folderFiles').click();$('#folderFiles').onchange=async event=>{
  const files=[...event.target.files];if(!files.length)return;if(!confirmReplaceCurrent('导入这个制作文件夹')){event.target.value='';return}runtimeFiles.clear();const result=await importVirtualFolder(files.map(virtualFile),registry);
  for(const asset of result.project.assets){const file=files.find(f=>(f.webkitRelativePath||f.name)===asset.sourcePath||f.name===asset.name);if(file)runtimeFiles.set(asset.id,file)}
  await setProject(result.project,`制作文件夹：${result.project.lines.length} 行 · ${result.project.assets.length} 素材索引`);$('#importDetails').open=false;
  if(workspace){for(const asset of project.assets){const file=runtimeFiles.get(asset.id);if(!file)continue;const path=`${assetDirectory(asset.kind)}/${asset.id}_${sanitizePathPart(file.name)}`;await persistAssetFile(workspace,project,asset,file,path)}await refreshWorkspace();invalidateMediaCaches();renderAll()}
};

async function probeDuration(file){if(!file.type.startsWith('audio/'))return null;return await new Promise(resolve=>{const audio=document.createElement('audio'),url=URL.createObjectURL(file);audio.preload='metadata';audio.onloadedmetadata=()=>{const d=Number.isFinite(audio.duration)?audio.duration:null;URL.revokeObjectURL(url);resolve(d)};audio.onerror=()=>{URL.revokeObjectURL(url);resolve(null)};audio.src=url})}
$('#importAssets').onclick=async()=>{
  if(!project)return;const kind=$('#assetKind').value,files=[...$('#assetFiles').files];
  for(const file of files){const duration=mediaKinds().has(kind)?await probeDuration(file):null;const asset={id:makeId('asset'),kind,name:file.name,mime:file.type,sourcePath:file.name,metadata:duration?{duration}: {}};project.assets.push(asset);runtimeFiles.set(asset.id,file);if(workspace){const path=`${assetDirectory(kind)}/${asset.id}_${sanitizePathPart(file.name)}`;await persistAssetFile(workspace,project,asset,file,path)}}
  scheduleSave('导入素材','asset-import');await saveIfConnected();invalidateMediaCaches();renderAll();
};

$('#bulkRelinkAssets').onclick=()=>{if(project)$('#relinkFolderFiles').click()};
$('#relinkFolderFiles').onchange=async event=>{
  if(!project)return;const files=[...event.target.files];if(!files.length)return;
  const candidateFiles=files.map(file=>({path:file.webkitRelativePath||file.name,name:file.name,size:file.size,file}));
  const plan=planMediaRelink(project,candidateFiles);const matched=plan.filter(item=>item.status==='matched'),ambiguous=plan.filter(item=>item.status==='ambiguous'),missing=plan.filter(item=>item.status==='missing');
  let applied=0;
  for(const item of matched){const chosen=candidateFiles.find(candidate=>candidate.path===item.selectedPath);const asset=project.assets.find(asset=>asset.id===item.assetId);if(!chosen?.file||!asset)continue;const file=chosen.file;runtimeFiles.set(asset.id,file);asset.name=file.name;asset.mime=file.type;const duration=mediaKinds().has(asset.kind)?await probeDuration(file):null;asset.metadata={...(asset.metadata||{}),...(duration?{duration}:{})};if(workspace){const path=asset.sourcePath?.startsWith('assets/')?asset.sourcePath:`${assetDirectory(asset.kind)}/${asset.id}_${sanitizePathPart(file.name)}`;await persistAssetFile(workspace,project,asset,file,path)}else asset.sourcePath=chosen.path;applied++;}
  $('#relinkStatus').textContent=`${applied} 已重定位 · ${ambiguous.length} 重名冲突 · ${missing.length} 未找到`;
  if(applied){scheduleSave('批量重定位素材','asset-bulk-relink');await saveIfConnected();invalidateMediaCaches();renderAll()}
  event.target.value='';
};

for(const button of document.querySelectorAll('[data-insert-command]'))button.addEventListener('click',()=>insertDirectorCommand(button.dataset.insertCommand));
$('#prevLine').onclick=()=>{player?.stop();if(!project?.lines.length)return;selectedBeatId=null;selectedIndex=Math.max(0,selectedIndex-1);renderAll();scrollActiveLineIntoView()};$('#nextLine').onclick=()=>{player?.stop();if(!project?.lines.length)return;selectedBeatId=null;selectedIndex=Math.min(project.lines.length-1,selectedIndex+1);renderAll();scrollActiveLineIntoView()};
$('#addLine').onclick=()=>{if(!project)return;const base=currentLine();const speaker=base?charName(base.speakerId):(project.characters[0]?.name||'角色1');const line=createLine(project,speaker,'新台词','dialogue');project.lines.splice(Math.min(project.lines.length,selectedIndex+1),0,line);selectedIndex=project.lines.indexOf(line);scheduleSave('新增台词','line-add');renderAll()};
$('#duplicateLine').onclick=()=>{const line=currentLine();if(!line)return;const copy=structuredClone(line);copy.id=makeId('line');copy.audioAssetId=null;delete copy.chapterTitle;delete copy.sceneTitle;project.lines.splice(selectedIndex+1,0,copy);selectedIndex++;scheduleSave('复制台词','line-duplicate');renderAll()};
$('#deleteLine').onclick=()=>{const line=currentLine();if(!line)return;deleteLinesStructureAware(project,[line.id]);selectedIndex=Math.max(0,Math.min(selectedIndex,project.lines.length-1));scheduleSave('删除台词','line-delete');renderAll()};
function moveCurrentSelection(direction){if(!project?.lines.length)return;const currentId=currentLine()?.id;const ids=selectedLineIds.size?[...selectedLineIds]:(currentId?[currentId]:[]);if(moveLinesOneStepStructureAware(project,ids,direction)){if(currentId){const idx=project.lines.findIndex(line=>line.id===currentId);if(idx>=0)selectedIndex=idx}scheduleSave('移动台词','line-reorder');renderAll()}}
$('#moveLineUp').onclick=()=>moveCurrentSelection(-1);$('#moveLineDown').onclick=()=>moveCurrentSelection(1);


function promptStructureName(label,initial){const value=window.prompt(label,initial);return value==null?null:value.trim()}
$('#splitChapter').onclick=()=>{if(!project?.lines.length)return;const name=promptStructureName('新 Chapter 名称','新 Chapter');if(name==null)return;if(splitChapterAt(project,selectedIndex,name)){scheduleSave('拆分 Chapter','outline-split');renderAll()}};
$('#splitScene').onclick=()=>{if(!project?.lines.length)return;const name=promptStructureName('新 Scene 名称','新 Scene');if(name==null)return;if(splitSceneAt(project,selectedIndex,name)){scheduleSave('拆分 Scene','outline-split');renderAll()}};
$('#mergeScenePrev').onclick=()=>{if(mergeSceneWithPrevious(project,selectedIndex)){scheduleSave('合并 Scene','outline-merge');renderAll()}};
$('#mergeChapterPrev').onclick=()=>{if(mergeChapterWithPrevious(project,selectedIndex)){scheduleSave('合并 Chapter','outline-merge');renderAll()}};
$('#moveSceneToChapter').onclick=()=>{if(!project?.lines.length)return;const currentId=currentLine()?.id,targetIndex=Number($('#sceneTargetChapter').value);if(!Number.isInteger(targetIndex))return;if(moveSceneToChapter(project,selectedIndex,targetIndex)){const idx=project.lines.findIndex(line=>line.id===currentId);if(idx>=0)selectedIndex=idx;scheduleSave('Scene 跨 Chapter 移动','outline-move-chapter');renderAll()}};
$('#duplicateScene').onclick=()=>{if(!project?.lines.length)return;const result=duplicateOutlineGroup(project,selectedIndex,'scene');if(!result)return;selectedIndex=result.start;scheduleSave('复制 Scene','outline-duplicate');renderAll()};
$('#duplicateChapter').onclick=()=>{if(!project?.lines.length)return;const result=duplicateOutlineGroup(project,selectedIndex,'chapter');if(!result)return;selectedIndex=result.start;scheduleSave('复制 Chapter','outline-duplicate');renderAll()};
$('#deleteScene').onclick=()=>{if(!project?.lines.length||!confirm('删除当前整个 Scene？'))return;if(deleteOutlineGroup(project,selectedIndex,'scene')){selectedIndex=Math.min(selectedIndex,Math.max(0,project.lines.length-1));scheduleSave('删除 Scene','outline-delete');renderAll()}};
$('#deleteChapter').onclick=()=>{if(!project?.lines.length||!confirm('删除当前整个 Chapter？'))return;if(deleteOutlineGroup(project,selectedIndex,'chapter')){selectedIndex=Math.min(selectedIndex,Math.max(0,project.lines.length-1));scheduleSave('删除 Chapter','outline-delete');renderAll()}};

async function restoreHistorySnapshot(snapshot){if(!snapshot)return;player?.stop();project=snapshot;selectedLineIds.clear();invalidateMediaCaches();await saveIfConnected();renderAll()}
$('#undoEdit').onclick=async()=>restoreHistorySnapshot(history.undo());
$('#redoEdit').onclick=async()=>restoreHistorySnapshot(history.redo());
$('#scriptSearch').oninput=()=>{searchCursor=-1;refreshSearch();renderScript()};$('#scriptSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();goSearch(e.shiftKey?-1:1)}};
function goSearch(delta){if(!searchHits.length)return;selectedBeatId=null;searchCursor=(searchCursor+delta+searchHits.length)%searchHits.length;selectedIndex=searchHits[searchCursor].index;expandForIndex(selectedIndex);refreshSearch();renderAll();setTimeout(scrollActiveLineIntoView,30)}
$('#searchPrev').onclick=()=>goSearch(-1);$('#searchNext').onclick=()=>goSearch(1);
$('#selectSearch').onclick=()=>{for(const hit of searchHits)selectedLineIds.add(project.lines[hit.index].id);updateSelectionUi();renderScript()};
function selectOutlineGroup(kind){if(!project?.lines.length)return;const outline=buildScriptOutline(project.lines),current=outline[selectedIndex];if(!current)return;const key=kind==='chapter'?current.chapterKey:current.sceneKey;for(const entry of outline)if((kind==='chapter'?entry.chapterKey:entry.sceneKey)===key)selectedLineIds.add(project.lines[entry.index].id);updateSelectionUi();renderScript()}
$('#selectScene').onclick=()=>selectOutlineGroup('scene');$('#selectChapter').onclick=()=>selectOutlineGroup('chapter');$('#clearSelection').onclick=()=>{selectedLineIds.clear();lastSelectionIndex=null;updateSelectionUi();renderScript()};
$('#projectSpeechLanguage')?.addEventListener('change',()=>{if(!project)return;project.settings.speechLanguage=$('#projectSpeechLanguage').value.trim()||'auto';scheduleSave('修改工程朗读语言','project-speech-language');renderAll();});
$('#projectTtsProvider').addEventListener('change',()=>{if(!project)return;project.settings.ttsProvider=$('#projectTtsProvider').value;scheduleSave('修改默认声音服务','project-tts-provider');renderAll();});
$('#globalPauseScale').oninput=()=>{if(!project)return;project.settings.speechPauseScale=Number($('#globalPauseScale').value);$('#globalPauseScaleValue').textContent=`${Number(project.settings.speechPauseScale).toFixed(1)}×`;scheduleSave('修改全剧朗读停顿','global-speech-pause');if(activeView==='characters')renderCharacters();if(currentLine())renderInspector()};
$('#applyGlobalTextEffect').onclick=()=>{if(!project?.lines.length)return;const effect=$('#globalTextEffect').value;const ids=project.lines.filter(line=>String(line.text||'').trim()).map(line=>line.id);applyBatchEdit(project,ids,{textEffect:effect});scheduleSave('设置全剧文字出现','global-text-effect');renderAll();$('#importStatus').textContent=`已把 ${ids.length} 行文字设置为“${$('#globalTextEffect').selectedOptions[0]?.textContent||effect}”。`};
$('#batchPunctuationMode').onchange=()=>{const mode=$('#batchPunctuationMode').value;$('#batchPunctuationUniform').hidden=mode!=='uniform';$('#batchPunctuationCustom').hidden=mode!=='custom'};
$('#applyBatch').onclick=()=>{if(!selectedLineIds.size)return;const patch={};if($('#batchSpeaker').value)patch.speakerId=$('#batchSpeaker').value;if($('#batchType').value)patch.type=$('#batchType').value;if($('#batchTextEffect').value)patch.textEffect=$('#batchTextEffect').value;if($('#batchTextEffectDuration').value!=='')patch.textEffectDuration=Number($('#batchTextEffectDuration').value);const punctuationMode=$('#batchPunctuationMode').value;if(punctuationMode==='reset')patch.punctuationPauses=null;else if(punctuationMode==='uniform')patch.punctuationPauses={mode:'uniform',uniformSeconds:Number($('#batchPunctuationUniformSeconds').value||0)};else if(punctuationMode==='custom')patch.punctuationPauses={mode:'custom',comma:Number($('#batchPauseComma').value||0),period:Number($('#batchPausePeriod').value||0),question:Number($('#batchPauseQuestion').value||0),exclamation:Number($('#batchPauseExclamation').value||0),ellipsis:Number($('#batchPauseEllipsis').value||0),semicolon:Number($('#batchPauseSemicolon').value||0),colon:Number($('#batchPauseColon').value||0)};if(!Object.keys(patch).length)return;applyBatchEdit(project,selectedLineIds,patch);scheduleSave('批量编辑','batch-edit');renderAll()};
$('#applyPreset').onclick=()=>{const preset=BUILTIN_PERFORMANCE_PRESETS.find(p=>p.id===$('#performancePreset').value);if(!preset)return;for(const id of targetLineIds()){const line=project.lines.find(l=>l.id===id);if(line)applyPerformancePatch(line,preset.patch)}scheduleSave(`演出预设：${preset.label}`,'performance-preset');renderAll()};
$('#copyPerformance').onclick=()=>{if(!currentLine())return;performanceClipboard=copyPerformanceSettings(currentLine());$('#pastePerformance').disabled=false;updateSelectionUi()};
$('#pastePerformance').onclick=()=>{if(!currentLine()||!performanceClipboard)return;pastePerformanceSettings(currentLine(),performanceClipboard);scheduleSave('粘贴演出设置','performance-paste');renderAll()};
$('#pastePerformanceSelected').onclick=()=>{if(!performanceClipboard||!selectedLineIds.size)return;for(const line of project.lines)if(selectedLineIds.has(line.id))pastePerformanceSettings(line,performanceClipboard);scheduleSave('批量粘贴演出设置','performance-paste-selected');renderAll()};
$('#deleteSelected').onclick=()=>{if(!selectedLineIds.size||!confirm(`删除选中的 ${selectedLineIds.size} 句台词？`))return;deleteLinesStructureAware(project,selectedLineIds);selectedLineIds.clear();selectedIndex=Math.max(0,Math.min(selectedIndex,project.lines.length-1));scheduleSave('删除选中台词','delete-selected');renderAll()};

function updateDiagnosticsSummary(){if(!project){$('#diagnosticsStatus').textContent='';return}const issues=diagnoseProject(project),errors=issues.filter(x=>x.severity==='error').length,warnings=issues.filter(x=>x.severity==='warning').length;$('#diagnosticsStatus').textContent=errors?`${errors} 错误 · ${warnings} 警告`:warnings?`${warnings} 个提醒`:'结构正常'}
function flashElement(element){if(!element)return;element.scrollIntoView({block:'center',behavior:'smooth'});element.classList.remove('attention-flash');requestAnimationFrame(()=>element.classList.add('attention-flash'));setTimeout(()=>element.classList.remove('attention-flash'),1400)}
function navigateDiagnostic(issue){
  if(issue.lineId){const idx=project.lines.findIndex(line=>line.id===issue.lineId);if(idx>=0){selectedIndex=idx;expandForIndex(idx);setContentView('script');renderAll();requestAnimationFrame(()=>flashElement(document.querySelector(`[data-line-id="${CSS.escape(issue.lineId)}"]`)));return true}}
  if(issue.characterId&&project.characters.some(character=>character.id===issue.characterId)){selectedCharacterId=issue.characterId;if(uiPrefs.characterUsedOnly&&!collectScriptCharacterIds(project).has(issue.characterId)){uiPrefs.characterUsedOnly=false;saveUiPrefs()}setContentView('characters');renderAll();requestAnimationFrame(()=>flashElement([...document.querySelectorAll('.character-chip')].find(button=>button.title===project.characters.find(character=>character.id===issue.characterId)?.name)));return true}
  if(issue.assetId&&project.assets.some(asset=>asset.id===issue.assetId)){setContentView('assets');renderAll();requestAnimationFrame(()=>flashElement(document.querySelector(`[data-asset-id="${CSS.escape(issue.assetId)}"]`)));return true}
  return false;
}
async function runDiagnostics(){if(!project)return;const issues=diagnoseProject(project);if(workspace){issues.push(...await diagnoseWorkspaceAssets(project.assets,workspace))}else{for(const asset of project.assets){if(runtimeFiles.has(asset.id))continue;if(asset.uri?.startsWith('project://')||asset.sourcePath?.startsWith('assets/'))issues.push({code:'workspace-disconnected',severity:'warning',assetId:asset.id,message:`素材需要重新连接原工程目录或重新链接：${asset.name}`})}}
  const host=$('#diagnosticsView');host.innerHTML='';const counts={error:0,warning:0,info:0};for(const issue of issues){counts[issue.severity]=(counts[issue.severity]||0)+1;const item=document.createElement('button');const canJump=Boolean(issue.lineId||issue.characterId||issue.assetId);item.className=`diagnostic ${issue.severity}${canJump?' can-jump':''}`;item.style.textAlign='left';item.innerHTML=`<strong>${issue.severity==='error'?'错误':issue.severity==='warning'?'警告':'提示'}</strong>${canJump?'<span class="summary-meta">定位 →</span>':''}<div>${escapeHtml(issue.message)}</div>`;if(canJump)item.onclick=()=>navigateDiagnostic(issue);else item.setAttribute('aria-disabled','true');host.append(item)}
  if(!issues.length)host.innerHTML='<div class="muted">没有发现结构性问题。</div>';$('#diagnosticsStatus').textContent=`${counts.error||0} 错误 · ${counts.warning||0} 警告`;}
$('#runDiagnostics').onclick=runDiagnostics;

for(const button of document.querySelectorAll('#contentTabs [data-view]'))button.setAttribute('role','tab');
$('#contentTabs').addEventListener('click',event=>{const button=event.target.closest('[data-view]');if(button)setContentView(button.dataset.view)});
$('#contentTabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=[...document.querySelectorAll('#contentTabs [data-view]')].filter(b=>!b.hidden&&getComputedStyle(b).display!=='none');if(!buttons.length)return;const current=Math.max(0,buttons.findIndex(b=>b.dataset.view===activeView));let next=current;if(event.key==='ArrowLeft')next=(current-1+buttons.length)%buttons.length;if(event.key==='ArrowRight')next=(current+1)%buttons.length;if(event.key==='Home')next=0;if(event.key==='End')next=buttons.length-1;event.preventDefault();buttons[next].focus();setContentView(buttons[next].dataset.view)});

async function emitTextExport(name,text,mime='text/plain;charset=utf-8'){
  const blob=new Blob([text],{type:mime});
  if(workspace)await workspace.write(`exports/${name}`,blob,mime);
  downloadBlob(name,blob);
}

function sceneStartIndex(index=selectedIndex){
  if(!project?.lines.length)return 0;
  const outline=buildScriptOutline(project.lines),entry=outline[index];
  if(!entry)return Math.max(0,Math.min(index,project.lines.length-1));
  const found=outline.find(item=>item.sceneKey===entry.sceneKey);
  return found?.index??index;
}
function renderPlaytestLog(){
  const host=$('#playtestLog');if(!host||!playtestRuntime)return;
  const entries=playtestRuntime.backlog();
  host.innerHTML=entries.length?entries.map(entry=>`<div class="playtest-log-entry"><b>${escapeHtml(entry.speaker)}</b><span>${escapeHtml(entry.text)}</span></div>`).join(''):'<div class="muted">还没有已读台词。</div>';
  host.scrollTop=host.scrollHeight;
}
function closePlaytest(){
  playtestRuntime?.stop();playtestMediaPlayer?.stop();
  playtestRuntime=null;playtestMediaPlayer=null;playtestRenderer=null;playtestObjectInteraction=null;playtestObjectDrag=null;playtestRecordingPending=false;const record=$('#playtestRecordObject');if(record){record.classList.remove('active');record.textContent='录制对象交互'}$('#playtestObjectRecordState').textContent='';
  const modal=$('#playtestModal');if(modal)modal.hidden=true;
  const log=$('#playtestLog');if(log)log.hidden=true;
}
async function openPlaytest(index){
  if(!performanceDoc?.lines.length)return;
  player?.stop();closePlaytest();
  const modal=$('#playtestModal');modal.hidden=false;
  playtestOriginIndex=Math.max(0,Math.min(index,performanceDoc.lines.length-1));
  playtestRenderer=new CanvasStageRenderer({canvas:$('#playtestCanvas'),performance:performanceDoc,resolveAsset});
  playtestMediaPlayer=new BrowserReplayPlayer(performanceDoc,playtestRenderer,resolveAsset);
  playtestObjectInteraction=new CustomObjectInteractionController(performanceDoc,playtestRenderer,{onInteraction(event){const object=performanceDoc.customObjects?.find(item=>item.id===event.objectId);const hint=$('#playtestObjectHint');hint.textContent=event.kind==='note'?(event.note||object?.name||'对象'):`${object?.name||'对象'} · ${event.kind==='state'?'状态切换':event.kind==='hide'?'关闭':event.kind==='pan'?'拖动':event.kind==='zoom'?'缩放':event.kind==='inspect-open'?'查看':event.kind==='inspect-close'?'收起':'交互'}`;hint.hidden=false;clearTimeout(playtestObjectHintTimer);playtestObjectHintTimer=setTimeout(()=>hint.hidden=true,1500)}});
  playtestRuntime=new VNReplayRuntime(performanceDoc,playtestRenderer,playtestMediaPlayer,{
    onLine(i,line){
      playtestObjectInteraction?.setLine(i);$('#playtestPosition').textContent=`${i+1} / ${performanceDoc.lines.length} · ${line.speakerName||'旁白'}`;
      if(!$('#playtestLog').hidden)renderPlaytestLog();
    },
    onMode({auto,skip}){
      $('#playtestAuto').classList.toggle('active',auto);$('#playtestSkip').classList.toggle('active',skip);
      $('#playtestModeText').textContent=skip?'SKIP':auto?'AUTO':'手动';
    },
    onEnd(){$('#playtestModeText').textContent='END'}
  });
  $('#playtestModeText').textContent='手动';
  try{await playtestRuntime.start(playtestOriginIndex)}catch(error){$('#playtestModeText').textContent=`试玩失败：${error.message||error}`}
}

function safePlayableAssetPath(asset){
  const source=String(asset.sourcePath||'').replace(/\\/g,'/');
  if(/^assets\//.test(source)&&!source.split('/').includes('..'))return source;
  return `${assetDirectory(asset.kind)}/${asset.id}_${sanitizePathPart(asset.name||asset.id)}`;
}
async function exportPlayableDirectory(){
  if(!project||!performanceDoc?.lines.length)return;
  if(!workspace){$('#playableExportStatus').textContent='先连接工程目录，再导出可玩网页文件夹。';return}
  const safe=sanitizePathPart(project.title||'Replay'),prefix=`exports/${safe}-playable`;
  $('#exportPlayable').disabled=true;$('#playableExportStatus').textContent='正在准备可玩网页…';
  try{
    const exported=structuredClone(performanceDoc),referenced=collectReferencedAssetRefs(project);let copied=0,unresolved=[];
    for(const asset of exported.assets){
      const source=await resolveAsset(asset.id);
      const isReferenced=referenced.has(asset.id)||referenced.has(asset.name)||Boolean(asset.sourcePath&&referenced.has(asset.sourcePath));
      if(typeof source==='string'&&/^(https?:|data:)/i.test(source)){asset.uri=source;asset.sourcePath='';continue}
      let payload=source;
      if(typeof source==='string'&&/^blob:/i.test(source)){try{payload=await (await fetch(source)).blob()}catch{payload=null}}
      if(payload instanceof Blob||payload instanceof ArrayBuffer||payload instanceof Uint8Array){
        const path=safePlayableAssetPath(asset);await workspace.write(`${prefix}/${path}`,payload,asset.mime);asset.sourcePath=path;asset.uri=`project://${path}`;copied++;
      }else if(isReferenced){unresolved.push(asset.name||asset.id)}
    }
    if(unresolved.length)throw new Error(`这些已使用素材无法读取：${unresolved.slice(0,5).join('、')}${unresolved.length>5?'…':''}`);
    await workspace.write(`${prefix}/performance.json`,JSON.stringify(exported,null,2),'application/json;charset=utf-8');
    const [html,js,manifest]=await Promise.all([
      fetch('./player.html').then(r=>{if(!r.ok)throw new Error('player.html 无法读取');return r.text()}),
      fetch('./player.js').then(r=>{if(!r.ok)throw new Error('player.js 无法读取');return r.text()}),
      fetch('./runtime-files.json').then(r=>{if(!r.ok)throw new Error('runtime-files.json 无法读取');return r.json()})
    ]);
    await workspace.write(`${prefix}/index.html`,html,'text/html;charset=utf-8');
    await workspace.write(`${prefix}/player.js`,js,'text/javascript;charset=utf-8');
    let runtimeCount=0;
    for(const path of manifest.files||[]){
      const response=await fetch(`../dist/${path}`);if(!response.ok)throw new Error(`Runtime 文件缺失：${path}`);
      await workspace.write(`${prefix}/dist/${path}`,await response.blob(),'text/javascript;charset=utf-8');runtimeCount++;
    }
    await workspace.write(`${prefix}/README.txt`,`Replay Lab 可玩网页\n\n入口：index.html\n\n请通过 HTTP 静态服务器、GitHub Pages、Netlify 等方式打开；浏览器直接 file:// 打开 ES Module 可能被安全策略拦截。\n\n此目录由 Replay Lab ${project.version||''} 生成。\n`,'text/plain;charset=utf-8');
    await refreshWorkspace();$('#playableExportStatus').textContent=`完成 · ${copied} 个素材 · ${runtimeCount} 个 Runtime 文件 · ${workspace.label}/${prefix}`;
  }catch(error){console.error(error);$('#playableExportStatus').textContent=`网页导出失败：${error.message||error}`}
  finally{$('#exportPlayable').disabled=false}
}
function playtestCanvasPoint(event){const canvas=$('#playtestCanvas'),rect=canvas.getBoundingClientRect();return {x:(event.clientX-rect.left)*canvas.width/Math.max(1,rect.width),y:(event.clientY-rect.top)*canvas.height/Math.max(1,rect.height)}}
async function refreshPlaytestInteractiveFrame(){if(!playtestRenderer||!playtestRuntime||!performanceDoc)return;const line=performanceDoc.lines[playtestRuntime.index];if(line)await playtestRenderer.renderLine(playtestRuntime.index,line.duration)}
$('#playtestCanvas').addEventListener('pointerdown',event=>{if(!playtestObjectInteraction||!playtestRenderer)return;const point=playtestCanvasPoint(event),hit=playtestRenderer.customObjectHitTest(point.x,point.y);if(!hit)return;if(playtestRecordingPending&&!playtestObjectInteraction.isRecording){const object=performanceDoc.customObjects?.find(item=>item.id===hit.objectId);playtestObjectInteraction.beginRecording(hit.objectId,`${object?.name||'对象'} · 交互 Take`);playtestRecordingPending=false;$('#playtestRecordObject').textContent='停止录制';$('#playtestObjectRecordState').textContent=`正在录制 ${object?.name||'对象'}`}
  const object=performanceDoc.customObjects?.find(item=>item.id===hit.objectId);if(object?.interactionMode==='pan-zoom'){playtestObjectDrag={objectId:hit.objectId,x:event.clientX,y:event.clientY,moved:false};event.currentTarget.setPointerCapture?.(event.pointerId);event.preventDefault()}});
$('#playtestCanvas').addEventListener('pointermove',event=>{if(!playtestObjectDrag||!playtestObjectInteraction)return;const rect=$('#playtestCanvas').getBoundingClientRect(),dx=(event.clientX-playtestObjectDrag.x)/Math.max(1,rect.width),dy=(event.clientY-playtestObjectDrag.y)/Math.max(1,rect.height);if(Math.abs(dx)+Math.abs(dy)<.001)return;playtestObjectDrag.moved=true;playtestObjectDrag.x=event.clientX;playtestObjectDrag.y=event.clientY;playtestObjectInteraction.panBy(playtestObjectDrag.objectId,dx,dy);void refreshPlaytestInteractiveFrame()});
$('#playtestCanvas').addEventListener('pointerup',event=>{if(!playtestObjectInteraction)return;const point=playtestCanvasPoint(event);if(playtestObjectDrag){const moved=playtestObjectDrag.moved;playtestObjectDrag=null;if(moved){void refreshPlaytestInteractiveFrame();return}}const result=playtestObjectInteraction.interactAt(point.x,point.y);if(result){event.preventDefault();void refreshPlaytestInteractiveFrame()}});
$('#playtestCanvas').addEventListener('wheel',event=>{if(!playtestObjectInteraction||!playtestRenderer)return;const point=playtestCanvasPoint(event),hit=playtestRenderer.customObjectHitTest(point.x,point.y);if(!hit)return;const object=performanceDoc.customObjects?.find(item=>item.id===hit.objectId);if(object?.interactionMode!=='pan-zoom')return;event.preventDefault();playtestObjectInteraction.zoomBy(hit.objectId,event.deltaY<0?1.08:.92);void refreshPlaytestInteractiveFrame()},{passive:false});
$('#playtestRecordObject').onclick=()=>{if(!playtestObjectInteraction)return;if(playtestObjectInteraction.isRecording){const take=playtestObjectInteraction.stopRecording();if(take){project.customObjectTakes??=[];project.customObjectTakes.push(take);scheduleSave('保存对象交互录制','object-take-record');$('#playtestObjectRecordState').textContent=`已保存 ${take.steps.length} 步 · 到素材页可烘焙`;renderAssets()}$('#playtestRecordObject').classList.remove('active');$('#playtestRecordObject').textContent='录制对象交互';return}playtestRecordingPending=!playtestRecordingPending;$('#playtestRecordObject').classList.toggle('active',playtestRecordingPending);$('#playtestRecordObject').textContent=playtestRecordingPending?'点击对象开始录制':'录制对象交互';$('#playtestObjectRecordState').textContent=playtestRecordingPending?'下一次点击的对象将成为录制目标':''};

$('#playtestHere').onclick=()=>{stageDirectEditor?.exit();cameraDirectEditor?.exit();sceneViewport?.exit();void openPlaytest(selectedIndex)};
$('#playtestScene').onclick=()=>{stageDirectEditor?.exit();cameraDirectEditor?.exit();sceneViewport?.exit();void openPlaytest(sceneStartIndex(selectedIndex))};
$('#playtestStart').onclick=()=>{stageDirectEditor?.exit();cameraDirectEditor?.exit();sceneViewport?.exit();void openPlaytest(0)};
$('#playtestNext').onclick=()=>void playtestRuntime?.next();$('#playtestPrev').onclick=()=>void playtestRuntime?.previous();
$('#playtestAuto').onclick=()=>playtestRuntime?.toggleAuto();$('#playtestSkip').onclick=()=>playtestRuntime?.toggleSkip();
$('#playtestRestart').onclick=()=>void playtestRuntime?.restart(playtestOriginIndex);
$('#playtestBacklog').onclick=()=>{const log=$('#playtestLog');log.hidden=!log.hidden;if(!log.hidden)renderPlaytestLog()};
$('#playtestClose').onclick=closePlaytest;$('#exportPlayable').onclick=()=>void exportPlayableDirectory();
$('#openVoiceWorkbench').onclick=openVoiceWorkbench;
for(const link of document.querySelectorAll('a[href="./index.html"]'))link.onclick=event=>{event.preventDefault();openVoiceWorkbench();};

document.querySelectorAll('[data-export]').forEach(button=>button.onclick=async()=>{
  if(!project)return;const type=button.dataset.export;
  if(type==='performance')await emitTextExport('replay.performance.json',exportPerformanceJson(project),'application/json');
  if(type==='project')await emitTextExport('project.replaylab.json',JSON.stringify(project,null,2),'application/json');
  if(type==='ymm')await emitTextExport('replay-ymm.txt',exportYmmScript(project));
  if(type==='csv')await emitTextExport('replay.csv',exportCsvScript(project),'text/csv;charset=utf-8');
  if(type==='tyrano')await emitTextExport('replay.ks',exportTyranoScript(project));
  if(workspace)await refreshWorkspace();
});

$('#playLine').onclick=async()=>{if(!player||!currentPerf())return;stageDirectEditor?.exit();cameraDirectEditor?.exit();sceneViewport?.exit();setPlaybackButtons(true);try{await player.playLine(selectedIndex)}catch(error){setPlaybackButtons(false);$('#renderStatus').textContent=`播放失败：${error.message||error}`}};
$('#playAll').onclick=async()=>{if(!player||!performanceDoc?.lines.length)return;stageDirectEditor?.exit();cameraDirectEditor?.exit();sceneViewport?.exit();const current=currentPerf();if(!Number.isFinite(playbackCursorTime)||playbackCursorTime<0||playbackCursorTime>=performanceDoc.duration)playbackCursorTime=current?.start??0;setPlaybackButtons(true);try{await player.playAll(playbackCursorTime)}catch(error){setPlaybackButtons(false);$('#renderStatus').textContent=`播放失败：${error.message||error}`}};
$('#stopPlay').onclick=()=>{player?.stop();void renderPreviewStatic()};
$('#seek').oninput=async event=>{if(!performanceDoc||!renderer)return;player?.stop();const time=performanceDoc.duration*Number(event.target.value)/1000;playbackCursorTime=time;const located=locatePerformanceLine(performanceDoc,time);if(located){selectedIndex=located.index;await renderer.renderLine(located.index,located.localTime);$('#timeLabel').textContent=`${time.toFixed(1)} / ${performanceDoc.duration.toFixed(1)}s`;renderScript();renderInspector();renderVoiceLineWorkbench();audioWorkbench?.render();renderState()}};

async function acquireFastExportTarget(name,directory=workspace){
  if(directory?.createWritable){return {writable:await directory.createWritable(`exports/${name}`),location:`${directory.label}/exports/${name}`}}
  const picker=globalThis.showSaveFilePicker;
  if(picker){
    try{
      const handle=await picker({suggestedName:name,types:[{description:'MP4 视频',accept:{'video/mp4':['.mp4']}}]});
      return {writable:await handle.createWritable(),location:handle.name||name};
    }catch(error){if(error?.name==='AbortError')return null;throw error}
  }
  return {writable:null,location:'浏览器内存'};
}
let activeExportController=null;
let exportBusy=false;
function captureExport(){return createExportSession({project,performance:performanceDoc,workspace,files:runtimeFiles,width:$('#stageCanvas').width,height:$('#stageCanvas').height});}
$('#exportQuality').onchange=updateExportEstimate;
$('#cancelExport').onclick=()=>activeExportController?.abort();
$('#exportMp4').onclick=async()=>{
  if(exportBusy||!player||!performanceDoc?.lines.length)return;
  const session=captureExport();exportBusy=true;let target,exportCompleted=false;
  const preset=selectedExportPreset(),safe=(project.title||'replay').replace(/[^\w\u3400-\u9fff-]+/g,'_'),name=`${safe}.mp4`;
  $('#exportMp4').disabled=true;$('#exportWebm').disabled=true;$('#cancelExport').hidden=false;activeExportController=new AbortController();$('#renderStatus').textContent='准备离线编码器…';$('#renderProgress').style.width='0%';
  try{
    target=await acquireFastExportTarget(name,session.workspace);if(!target){$('#renderStatus').textContent='已取消导出。';return}
    const estimate=session.performance.duration*(preset.video+preset.audio)/8;
    if(!target.writable&&estimate>100*1024*1024&&!confirm(`当前浏览器无法直接流式写文件，预计需要在内存中暂存约 ${formatBytes(estimate)}。继续可能占用较多内存。\n\n建议使用 Chrome/Edge 或先连接工程目录。仍要继续吗？`)){return}
    const phaseLabel={loading:'加载编码器',audio:'混合音频',video:'编码画面',finalizing:'封装 MP4'};
    const result=await session.player.exportMp4Fast({fps:30,videoBitsPerSecond:preset.video,audioBitsPerSecond:preset.audio,chunkSeconds:10,moduleSpecifier:MEDIABUNNY_BROWSER_MODULE,writable:target.writable||undefined,signal:activeExportController.signal,onProgress:(progress,phase)=>{$('#renderProgress').style.width=`${(progress*100).toFixed(1)}%`;$('#renderStatus').textContent=`${phaseLabel[phase]} · ${(progress*100).toFixed(1)}%`}});
    exportCompleted=true;if(result.blob)downloadBlob(name,result.blob);
    if(workspace)await refreshWorkspace();
    $('#renderProgress').style.width='100%';$('#renderStatus').textContent=`完成 · ${formatBytes(result.bytesWritten)} · ${result.streamed?'已直接写入 '+target.location:'已生成 MP4'}`;
  }catch(error){if(error?.name==='AbortError'){$('#renderStatus').textContent='导出已取消。';$('#renderProgress').style.width='0%'}else{console.error(error);const hint=/aac|audio|encoder/i.test(String(error?.message||error))?'；当前浏览器的 AAC/WebCodecs 不可用时，可改用下面的 WebM 兼容导出':'';$('#renderStatus').textContent=`快速 MP4 失败：${error.message||error}${hint}`}}
  finally{await session.player.dispose();if(!exportCompleted){try{await target?.writable?.abort?.();}catch{}}exportBusy=false;activeExportController=null;$('#cancelExport').hidden=true;$('#exportMp4').disabled=false;$('#exportWebm').disabled=false;}
};

$('#exportWebm').onclick=async()=>{
  if(exportBusy||!player||!performanceDoc?.lines.length)return;
  const session=captureExport();exportBusy=true;$('#exportMp4').disabled=true;$('#exportWebm').disabled=true;$('#renderStatus').textContent='准备素材和音轨…';$('#renderProgress').style.width='0%';
  try{const blob=await session.player.exportWebM({onProgress:p=>{$('#renderProgress').style.width=`${(p*100).toFixed(1)}%`;$('#renderStatus').textContent=`实时成片 ${(p*100).toFixed(1)}% · ${session.performance.duration.toFixed(1)}s`}});const name=`${(session.title||'replay').replace(/[^\w\u3400-\u9fff-]+/g,'_')}.webm`;if(session.workspace){await session.workspace.write(`exports/${name}`,blob,'video/webm');if(workspace===session.workspace)await refreshWorkspace()}downloadBlob(name,blob);$('#renderStatus').textContent=`完成 · ${(blob.size/1024/1024).toFixed(1)} MB${session.workspace?' · 已写入 exports/':''}`}
  catch(error){console.error(error);$('#renderStatus').textContent=`导出失败：${error.message||error}`}
  finally{await session.player.dispose();exportBusy=false;$('#exportWebm').disabled=false;$('#exportMp4').disabled=false;}
};

stageDirectEditor=new StageDirectEditorController({host:$('#stageDirectEditor'),toggle:$('#stageEditToggle'),hint:$('#stageEditHint'),copyButton:$('#stageCopyComposition'),pasteButton:$('#stagePasteComposition'),inheritButton:$('#stageInheritComposition'),resetButton:$('#stageResetAuto'),projectionControl:$('#stageProjectionMode'),onionControls:$('#stageOnionControls'),onionPrev:$('#onionPrev'),onionNext:$('#onionNext'),onionScope:$('#onionScope'),onionOpacity:$('#onionOpacity'),getProject:()=>project,getLine:()=>currentLine(),getPerformanceLine:()=>currentPerf(),getPreviousPerformanceLine:()=>performanceDoc?.lines?.[selectedIndex-1]??null,getNextPerformanceLine:()=>performanceDoc?.lines?.[selectedIndex+1]??null,resolveAsset,onMutation:(label,key)=>{scheduleSave(label,key);renderAll()},onStopPlayback:()=>player?.stop(),onPreviewRefresh:()=>void renderPreviewStatic(),onActivate:()=>{cameraDirectEditor?.exit();sceneViewport?.exit()}});
cameraDirectEditor=new CameraDirectEditorController({host:$('#cameraDirectEditor'),toggle:$('#cameraEditToggle'),hint:$('#cameraEditHint'),inheritButton:$('#cameraInherit'),resetButton:$('#cameraReset'),getLine:()=>currentLine(),getPerformanceLine:()=>currentPerf(),onMutation:(label,key)=>{scheduleSave(label,key);renderAll()},onStopPlayback:()=>player?.stop(),onPreviewRefresh:()=>void renderPreviewStatic(),onActivate:()=>{stageDirectEditor?.exit();sceneViewport?.showCameraControls()}});
sceneViewport=new SceneViewportController({root:$('#sceneViewToolbar'),host:$('#stageSpatialViewport'),controls:$('#cameraControls'),getProject:()=>project,getLine:()=>currentLine(),getPerformanceLine:()=>currentPerf(),onMutation:(label,key)=>{scheduleSave(label,key);renderAll()},onStopPlayback:()=>player?.stop(),onActivate:()=>{stageDirectEditor?.exit();cameraDirectEditor?.exit()},onPreviewRefresh:()=>void renderPreviewStatic()});
window.addEventListener('keydown',e=>{if(!$('#playtestModal').hidden){if(e.key==='Escape'){if(!$('#playtestLog').hidden){$('#playtestLog').hidden=true;return}closePlaytest();return}if((e.key==='ArrowRight'||e.key==='Enter'||e.key===' ')&&!e.target?.matches?.('button,input,textarea,select')){e.preventDefault();void playtestRuntime?.next();return}if(e.key==='ArrowLeft'&&!e.target?.matches?.('button,input,textarea,select')){e.preventDefault();void playtestRuntime?.previous();return}}if(e.key==='Escape'&&uiPrefs.layout!=='edit'){setLayoutMode('edit');return}if(e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){const target=e.target;if(target?.matches?.('input,textarea,select'))return;e.preventDefault();const dir=e.key==='ArrowUp'?-1:1;if(e.shiftKey){if(project?.lines.length&&moveOutlineGroup(project,selectedIndex,'scene',dir)){scheduleSave('Scene 整块移动','outline-reorder');renderAll()}}else moveCurrentSelection(dir);return}const mod=e.ctrlKey||e.metaKey;if(!mod)return;if(['z','y'].includes(e.key.toLowerCase())&&e.target?.closest?.('input,textarea,[contenteditable]:not([contenteditable="false"])'))return;if(e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)$('#redoEdit').click();else $('#undoEdit').click()}else if(e.key.toLowerCase()==='y'){e.preventDefault();$('#redoEdit').click()}else if(e.key.toLowerCase()==='f'){e.preventDefault();$('#scriptSearch').focus();$('#scriptSearch').select()}});
async function initRecovery(){
  $('#pastePerformance').disabled=true;$('#pastePerformanceSelected').disabled=true;setPlaybackButtons(false);updateHistoryUi();updateSelectionUi();
  try{recoverySnapshot=await recoveryStore.latest()}catch(error){console.warn('Recovery unavailable',error);recoverySnapshot=null}
  if(recoverySnapshot?.project?.lines?.length){const age=Math.max(0,Date.now()-recoverySnapshot.updatedAt),mins=Math.round(age/60000);$('#recoveryText').textContent=`${recoverySnapshot.project.title||'未命名工程'} · ${recoverySnapshot.project.lines.length} 行 · ${mins<60?mins+' 分钟前':Math.round(mins/60)+' 小时前'}${recoverySnapshot.workspaceLabel?' · 原目录 '+recoverySnapshot.workspaceLabel:''}`;$('#recoveryBar').hidden=false;project=createProject('未命名 Replay');history.reset(project,'等待恢复');renderAll();$('#importDetails').open=false;return}
  await setProject(createProject('未命名 Replay'),'新建工程');$('#importDetails').open=true;
}
$('#restoreRecovery').onclick=async()=>{if(!recoverySnapshot)return;runtimeFiles.clear();workspace=null;$('#projectState').textContent='临时 · 已恢复';$('#projectState').className='status warn';$('#saveProject').disabled=true;$('#workspaceDetail').textContent='已恢复工程 JSON；上次未写入工程目录的二进制素材需要重新链接。';$('#recoveryBar').hidden=true;await setProject(structuredClone(recoverySnapshot.project),'自动恢复快照')};
$('#discardRecovery').onclick=async()=>{try{await recoveryStore.clear()}catch{}recoverySnapshot=null;$('#recoveryBar').hidden=true;await setProject(createProject('未命名 Replay'),'新建工程');$('#importDetails').open=true};
$('#emptyPaste').onclick=()=>{$('#importDetails').open=true;$('#logInput').focus();$('#logInput').scrollIntoView({block:'center'})};$('#emptyFiles').onclick=()=>$('#pickLogFiles').click();$('#emptyFolder').onclick=()=>$('#pickFolder').click();$('#emptyManual').onclick=()=>{$('#addLine').click()};
$('#openDiagnosticsPanel').onclick=()=>{setLayoutMode('output');setContextTab('check');void runDiagnostics().then(()=>requestAnimationFrame(()=>$('#diagnosticsView')?.scrollIntoView({block:'center',behavior:'smooth'})))};
$('#openExportPanel').onclick=()=>{setLayoutMode('output');setContextTab('publish');requestAnimationFrame(()=>document.querySelector('.panel.right')?.scrollIntoView({block:'start',behavior:'smooth'}))};
$('#layoutMode').onchange=e=>setLayoutMode(e.target.value);
$('#resetLayout').onclick=()=>{uiPrefs.leftWidth=310;uiPrefs.rightWidth=390;uiPrefs.layout='edit';applyLayoutPrefs();saveUiPrefs()};
setupWorkbenchLayout();bindSplitter('#splitLeft','left');bindSplitter('#splitRight','right');applyLayoutPrefs();initStageMiniPreview();
$('#advancedToggle').onchange=e=>setAdvancedUi(e.target.checked);bindDisclosurePrefs();setAdvancedUi(uiPrefs.advanced);const initialView=(uiPrefs.activeView==='mediaDefs'&&!uiPrefs.advanced)?'script':uiPrefs.activeView;setContentView(initialView,{persist:false});
window.__replayLabMarkBootReady?.();
void initRecovery().catch(error=>{console.error('Studio initialization failed',error);const status=$('#importStatus');if(status)status.textContent=`启动后的工程初始化失败：${error?.message||error}`});

document.addEventListener('replaylab:open-recent',event=>void chooseWorkspace(event.detail));
document.addEventListener('replaylab:desktop-command',event=>{if(event.detail==='home')player?.stop();});
window.addEventListener('beforeunload',event=>{if(!workspace&&runtimeFiles.size){event.preventDefault();event.returnValue='';}});
