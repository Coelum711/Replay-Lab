import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const studioHtml = await readFile(new URL('../web/studio.html', import.meta.url), 'utf8');
const studioJs = await readFile(new URL('../web/studio.js', import.meta.url), 'utf8');
const voiceHtml = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const voiceJs = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const stageEditorJs = await readFile(new URL('../web/stage-editor-controller.js', import.meta.url), 'utf8');
const canvasStageTs = await readFile(new URL('../src/renderers/canvas-stage.ts', import.meta.url), 'utf8');
const facePackageControllerJs = await readFile(new URL('../web/face-package-controller.js', import.meta.url), 'utf8');
const characterIdentityControllerJs = await readFile(new URL('../web/character-identity-controller.js', import.meta.url), 'utf8');
const faceFitControllerJs = await readFile(new URL('../web/face-fit-controller.js', import.meta.url), 'utf8');
const characterSpeechControllerJs = await readFile(new URL('../web/character-speech-controller.js', import.meta.url), 'utf8');
const customObjectEditorJs = await readFile(new URL('../web/custom-object-editor-controller.js', import.meta.url), 'utf8');
const playerJs = await readFile(new URL('../web/player.js', import.meta.url), 'utf8');
const audioWorkbenchJs = await readFile(new URL('../web/audio-workbench-controller.js', import.meta.url), 'utf8');

test('Studio defaults to progressive disclosure instead of showing every advanced control', () => {
  assert.match(studioHtml, /id="advancedToggle"/);
  assert.match(studioHtml, /class="tab advanced-only" data-view="mediaDefs"/);
  assert.match(studioHtml, /id="displayDetails"[^>]*data-ui-key="display"/);
  assert.match(studioHtml, /id="sceneDetails"[^>]*data-ui-key="scene"/);
  assert.match(studioHtml, /id="stageDetails"[^>]*data-ui-key="stage"/);
  assert.match(studioHtml, /id="structureDetails"[^>]*data-ui-key="structure"/);
  assert.doesNotMatch(studioHtml, /<details[^>]+id="sceneDetails"[^>]+open/);
  assert.doesNotMatch(studioHtml, /本体下一步/);
});

test('Studio exposes an empty-state task path and no longer auto-parses a fake demo on startup', () => {
  assert.match(studioHtml, /id="emptyState"/);
  assert.match(studioHtml, /id="emptyPaste"/);
  assert.match(studioHtml, /id="emptyFiles"/);
  assert.match(studioHtml, /id="emptyFolder"/);
  assert.match(studioHtml, /id="emptyManual"/);
  assert.doesNotMatch(studioJs, /\$\('#parseText'\)\.click\(\)/);
  assert.match(studioJs, /createProject\('未命名 Replay'\)/);
});

test('Studio hides irrelevant line-type editors and keeps asset importing in the asset view', () => {
  assert.match(studioHtml, /id="bubbleBlock"[^>]*hidden/);
  assert.match(studioHtml, /id="diceBlock"[^>]*hidden/);
  assert.match(studioHtml, /id="hpBlock"[^>]*hidden/);
  assert.match(studioJs, /\$\('#bubbleBlock'\)\.hidden=!isBubble/);
  assert.match(studioJs, /\$\('#diceBlock'\)\.hidden=!isDice/);
  assert.match(studioJs, /\$\('#hpBlock'\)\.hidden=!isHp/);
  const assetTools = studioHtml.indexOf('id="assetTools"');
  const inspector = studioHtml.indexOf('id="inspectorCard"');
  assert.ok(assetTools > 0 && inspector > 0 && assetTools < inspector, 'asset tools should live with project content, not inside the line inspector');
});

test('Studio protects project-replacing actions and only shows batch checkboxes in batch mode', () => {
  assert.match(studioJs, /function confirmReplaceCurrent/);
  assert.match(studioJs, /confirmScriptReimport\('解析这份 Log'\)/);
  assert.match(studioJs, /confirmScriptReimport\('导入这些 Log'\)/);
  assert.match(studioJs, /confirmReplaceCurrent\('导入这个制作文件夹'\)/);
  assert.match(studioHtml, /\.mini-check\{display:none/);
  assert.match(studioHtml, /\.batch-mode \.mini-check\{display:flex/);
  assert.match(studioJs, /function syncBatchMode/);
});

test('Voice workbench is task-focused and does not auto-create a sample project', () => {
  assert.match(voiceHtml, /Replay Lab 0\.57\.0-dev · 声音/);
  assert.match(voiceHtml, /<details class="card" id="voiceInputDetails">/);
  assert.match(voiceHtml, /<details class="card"><summary>调试：Performance JSON<\/summary>/);
  assert.doesNotMatch(voiceJs.trimEnd(), /parse\(\);$/);
  assert.match(voiceJs, /口音 \/ 地区（可选）/);
  assert.match(voiceHtml, /id="currentLineCard"[^>]*hidden/);
});


test('0.23 Studio exposes focus layouts, splitters, virtual long-log adapter, and fast cancellable MP4 export', () => {
  assert.match(studioHtml, /id="layoutMode"/);
  assert.match(studioHtml, /id="splitLeft"[^>]*role="separator"/);
  assert.match(studioHtml, /id="splitRight"[^>]*role="separator"/);
  assert.match(studioHtml, /id="scriptViewport"/);
  assert.match(studioHtml, /id="exportMp4"/);
  assert.match(studioHtml, /id="cancelExport"[^>]*hidden/);
  assert.match(studioJs, /new VirtualScriptList/);
  assert.match(studioJs, /@tanstack\/virtual-core@3\.17\.9/);
  assert.match(studioJs, /mediabunny@1\.56\.0/);
  assert.match(studioJs, /AbortController/);
  assert.match(studioJs, /signal:activeExportController\.signal/);
});

test('0.23 character editor uses a picker + one detail panel rather than a wall of full cards', () => {
  assert.match(studioHtml, /\.character-picker/);
  assert.match(studioHtml, /\.character-detail/);
  assert.match(studioJs, /selectedCharacterId/);
  assert.match(studioJs, /character-chip/);
});

test('0.24 content tabs use one view state machine instead of mixing inline display and hidden state', () => {
  assert.match(studioHtml, /id="contentTabs"/);
  assert.match(studioHtml, /data-view-panel="script"/);
  assert.match(studioHtml, /data-view-panel="characters"[^>]*hidden/);
  assert.match(studioHtml, /data-view-panel="assets"[^>]*hidden/);
  assert.match(studioJs, /function setContentView/);
  assert.match(studioJs, /panel\.hidden=panel\.dataset\.viewPanel!==view/);
  assert.doesNotMatch(studioJs, /\$\('#characterView'\)\.style\.display/);
});

test('0.24 character editor makes layered art primary and keeps whole-frame sprites as compatibility UI', () => {
  assert.match(studioJs, /data-layer-slot="base"/);
  assert.match(studioJs, /data-layer-slot="eyesOpen"/);
  assert.match(studioJs, /data-layer-slot="eyesClosed"/);
  assert.match(studioJs, /data-layer-slot="mouthClosed"/);
  assert.match(studioJs, /data-layer-slot="mouthOpen"/);
  assert.match(studioJs, /正在使用占位角色/);
  assert.match(studioJs, /整帧立绘兼容（旧项目）/);
});


test('0.25 character editor supports half-body anchors and Inochi-style parameter/lattice expressions', () => {
  assert.match(studioJs, /立绘构图/);
  assert.match(studioJs, /半身/);
  assert.match(studioJs, /data-anchor-x/);
  assert.match(studioJs, /data-layer-slot="brows"/);
  assert.match(studioJs, /data-layer-slot="pupils"/);
  assert.match(studioJs, /data-layer-slot="eyelidsClosed"/);
  assert.match(studioJs, /参数形变/);
  assert.match(studioJs, /网格拉形变/);
  assert.match(studioJs, /setExpressionLatticeWarp/);
  assert.match(studioJs, /data-warp-canvas/);
});


test('0.32 Characters view exposes project-level face package routing with manual unresolved targets', () => {
  assert.match(studioJs, /导入一整包角色图片/);
  assert.match(studioJs, /FacePackageController/);
  assert.match(facePackageControllerJs, /planFacePackageBindings/);
  assert.match(facePackageControllerJs, /共享模板怎么处理/);
  assert.match(facePackageControllerJs, /未确定/);
  assert.match(facePackageControllerJs, /确认并导入/);
  assert.match(studioHtml, /face-package-row/);
});

test('0.31 Studio previews face-template autobind suggestions before applying files', () => {
  assert.match(studioJs, /选择几张脸部图片/);
  assert.match(studioJs, /planFaceTemplateBindings/);
  assert.match(studioJs, /data-face-autobind-preview/);
  assert.match(studioJs, /你只需要处理黄色项/);
  assert.match(studioJs, /确认并使用这些素材/);
  assert.match(studioHtml, /face-autobind-row/);
});

test('0.34 Studio exposes explicit character alias and merge workflow without auto-merging cross-language names', () => {
  assert.match(studioJs, /CharacterIdentityController/);
  assert.match(characterIdentityControllerJs, /(可能有重复角色|角色身份 \/ 手动合并)/);
  assert.match(characterIdentityControllerJs, /data-character-merge-keep/);
  assert.match(characterIdentityControllerJs, /data-character-merge-source/);
  assert.match(studioJs, /data-aliases/);
  assert.match(characterIdentityControllerJs, /跨语言关系不会自动猜/);
  assert.match(characterIdentityControllerJs, /mergeCharacters/);
});

test('0.29 Studio exposes shared face templates and lightweight Face Fit controls', () => {
  assert.match(studioJs, /脸部素材（可选）/);
  assert.match(studioJs, /data-face-template-select/);
  assert.match(studioJs, /从当前角色新建模板/);
  assert.match(studioJs, /把五官贴到脸上/);
  assert.match(studioJs, /data-face-orientation/);
  assert.match(faceFitControllerJs, /character\.faceFit\.features\[feature\]/);
  assert.match(studioJs, /data-facefit-canvas/);
  assert.match(faceFitControllerJs, /拖彩色点移动五官/);
  assert.match(studioHtml, /facefit-preview/);
});

test('0.30 Studio exposes split left/right face assets and draggable perspective fit controls', () => {
  assert.match(studioJs, /3\/4 侧脸：左右分开/);
  assert.match(studioJs, /data-template-slot="eyeLeftOpen"/);
  assert.match(studioJs, /data-template-slot="eyeRightOpen"/);
  assert.match(studioJs, /data-template-slot="browLeft"/);
  assert.match(studioJs, /data-template-slot="browRight"/);
  assert.match(studioJs, /leftEye/);
  assert.match(studioJs, /rightEye/);
  assert.match(studioJs, /远侧五官会自动向脸中心收并缩小/);
});

test('0.26 character editor exposes optional English phoneme mouths without cluttering the default layer grid', () => {
  assert.match(studioHtml, /Replay Lab Studio 0\.57\.0-dev/);
  assert.match(studioJs, /英语精细口型/);
  assert.match(studioJs, /mouthSchwa/);
  assert.match(studioJs, /mouthAe/);
  assert.match(studioJs, /mouthUu/);
  assert.match(studioJs, /mouthOo/);
  assert.match(studioJs, /mouthW/);
  assert.match(studioJs, /mouthF/);
  assert.match(studioJs, /mouthTh/);
  assert.match(studioJs, /mouthM/);
});


test('voice workbench starts with finding a role and choosing its voice without another mouth setup step', () => {
  assert.match(voiceHtml, /先找到角色，再选择语言和声线/);
  assert.doesNotMatch(voiceHtml, /小众语言口型配置/);
});

test('0.35 Studio makes speech, accents, global text reveal, and resume playback discoverable', () => {
  assert.match(studioHtml, /全剧文字出现/);
  assert.match(studioHtml, /全剧朗读停顿强度/);
  assert.match(studioHtml, /本句朗读语言/);
  assert.match(studioHtml, /朗读文本（可选）/);
  assert.match(studioJs, /data-character-language/);
  assert.match(studioJs, /data-character-accent/);
  assert.match(studioJs, /searchAccents/);
  assert.match(studioJs, /playAll\(playbackCursorTime\)/);
  assert.doesNotMatch(studioJs, /playAll\(0\)/);
});


test('0.35 low-attention contract keeps face import self-explanatory and repairable in place', () => {
  assert.match(studioJs, /不用先学规则/);
  assert.match(studioJs, /eyes_open\.png/);
  assert.match(studioJs, /复制命名清单/);
  assert.match(studioJs, /这张图是什么/);
  assert.match(studioJs, /你只需要处理黄色项/);
  assert.match(studioJs, /已经认对的 .*通常不用看/);
  assert.match(studioJs, /没有立绘也完全没关系/);
  assert.match(studioJs, /这个角色自己的五官（只有和通用脸不一样时才用）/);
  assert.doesNotMatch(studioJs, /<details open><summary>声音/);
  assert.match(studioHtml, /low-attention-callout/);
});




test('0.51.1 keeps the 2D / 2.5D projection switch visible on the preview stage', () => {
  const stageWrapStart=studioHtml.indexOf('<div class="stage-wrap">');
  const stageBarStart=studioHtml.indexOf('<div class="stage-edit-bar">');
  const projection=studioHtml.indexOf('id="stageProjectionMode"');
  assert.ok(stageWrapStart >= 0 && stageBarStart > stageWrapStart && projection > stageWrapStart && projection < stageBarStart,
    'projection control should live inside the preview stage, before the tool bar');
  assert.match(studioHtml, /stage-projection-overlay/);
  assert.match(studioHtml, /<option value="flat">2D<\/option>/);
  assert.match(studioHtml, /<option value="2\.5d">2\.5D<\/option>/);
});
test('0.43 stage preview supports direct human manipulation instead of requiring Inspector coordinate entry', () => {
  assert.match(studioHtml, /id="stageDirectEditor"/);
  assert.match(studioHtml, /id="stageEditToggle"/);
  assert.match(studioHtml, /直接拖立绘上下左右/);
  assert.match(stageEditorJs, /setStageActorTransform/);
  assert.match(stageEditorJs, /beginMove/);
  assert.match(stageEditorJs, /beginScale/);
  assert.match(stageEditorJs, /addStageActorToSlot/);
  assert.match(stageEditorJs, /removeStageActor/);
  assert.match(studioJs, /StageDirectEditorController/);
  assert.match(studioHtml, /数值只在工程内部保存/);
});


test('0.37 save location is optional-first and workspace conflicts are recoverable in place', () => {
  assert.match(studioHtml, /保存位置/);
  assert.match(studioHtml, /自动备份不包含图片和音频/);
  assert.match(studioHtml, /id="reloadWorkspace"[^>]*hidden/);
  assert.match(studioJs, /isWorkspaceConflictError/);
  assert.match(studioJs, /目录有新版本 · 已暂停保存/);
  assert.match(voiceHtml, /id="reloadVoiceWorkspace"[^>]*hidden/);
  assert.match(voiceJs, /showVoiceWorkspaceConflict/);
});

test('0.39 character merge uses pure planning and consequence-first impact UI', () => {
  assert.match(characterIdentityControllerJs, /planCharacterMerge\(project, keepId, mergeId\)/);
  assert.match(characterIdentityControllerJs, /preview\.linesReassigned/);
  assert.match(characterIdentityControllerJs, /preview\.stageRefsReassigned/);
  assert.match(characterIdentityControllerJs, /preview\.filled/);
  assert.match(characterIdentityControllerJs, /preview\.conflictGroups/);
  assert.match(characterIdentityControllerJs, /不会覆盖/);
  assert.match(characterIdentityControllerJs, /此操作可用 Undo 撤销/);
  assert.match(studioHtml, /merge-impact/);
});


test('0.39 character authoring separates controller lifecycles and shows a stop-when-good setup path', () => {
  assert.match(studioJs, /FaceFitController/);
  assert.match(studioJs, /CharacterSpeechController/);
  assert.doesNotMatch(studioJs, /function renderFaceFitPreview/);
  assert.match(faceFitControllerJs, /clearImageCache/);
  assert.match(characterSpeechControllerJs, /已保留地区\/口音意图/);
  assert.match(studioJs, /现在就能用：占位形象/);
  assert.match(studioJs, /立绘已经能上镜/);
  assert.match(studioJs, /脸部素材已启用/);
  assert.match(studioJs, /看着对就停/);
  assert.match(studioHtml, /character-path/);
});

test('0.38 revised-script reimport preserves character setup by default and makes destructive replacement explicit', () => {
  assert.match(studioHtml, /id="preserveSetupOnReimport"[^>]*checked/);
  assert.match(studioHtml, /重新导入时保留角色素材 \/ 声音 \/ 模板/);
  assert.match(studioJs, /reimportScriptPreservingSetup/);
  assert.match(studioJs, /只替换剧本|替换当前 .* 行剧本/);
  assert.match(studioJs, /角色素材绑定、共享模板和声音\/演出设置都会被新导入内容替换/);
  assert.match(studioJs, /当前新剧本未使用的旧角色（素材不会删除）/);
});


test('0.40 mature-tool UX pass keeps authoring primary and makes low-frequency output contextual', () => {
  assert.match(studioHtml, /工作区<select id="layoutMode"/);
  assert.match(studioHtml, /制作（推荐）/);
  assert.match(studioHtml, /输出 \/ 检查/);
  assert.match(studioHtml, /id="openDiagnosticsPanel"/);
  assert.match(studioHtml, /id="openExportPanel"/);
  assert.match(studioHtml, /id="centerContextHint"/);
  assert.match(studioHtml, /body\.layout-output/);
  assert.match(studioJs, /function syncCenterContext/);
  assert.match(studioJs, /setLayoutMode\('output'\)/);
  assert.match(studioJs, /navigateDiagnostic/);
  assert.match(studioJs, /issue\.characterId/);
  assert.match(studioJs, /issue\.assetId/);
  assert.match(studioJs, /data-character-used-only/);
  assert.match(studioJs, /collectScriptCharacterIds/);
  assert.match(studioJs, /normalizeReplayProject/);
  assert.doesNotMatch(studioJs, /function normalizeProjectShape/);
});

test('0.40 manifest autosave does not recursively rescan the whole workspace', () => {
  assert.match(studioJs, /workspaceSummary\.projectSaved=true/);
  assert.doesNotMatch(studioJs, /await workspace\.saveProject\(project\);\s*await refreshWorkspace\(\)/);
});

test('0.40 fast MP4 export decodes audio incrementally instead of retaining the whole soundtrack', async () => {
  const mediaTs=await readFile(new URL('../src/renderers/browser-media.ts', import.meta.url),'utf8');
  assert.match(mediaTs,/decodedAudioCacheBytes/);
  assert.match(mediaTs,/const activeAudio:/);
  assert.match(mediaTs,/evictDecoded\(/);
  assert.doesNotMatch(mediaTs,/decodedAudioBuffers\(events/);
});

test('0.41 Studio exposes VN-style Auto Director controls without removing manual stage editing', () => {
  assert.match(studioHtml, /id="autoStageModeEdit"/);
  assert.match(studioHtml, /id="maxOnStageEdit"/);
  assert.match(studioHtml, /id="speakerFocusEdit"/);
  assert.match(studioJs, /project\.settings\.autoStageMode/);
  assert.match(studioJs, /project\.settings\.speakerFocus/);
  assert.match(studioHtml, /id="stageModeEdit"/);
});

test('0.42 Studio exposes draggable director command rows and bidirectional structured command editing', () => {
  assert.match(studioHtml, /data-insert-command="expression"/);
  assert.match(studioHtml, /data-insert-command="dismiss"/);
  assert.match(studioHtml, /id="commandStructuredEdit"/);
  assert.match(studioHtml, /导演指令/);
  assert.match(studioJs, /function insertDirectorCommand/);
  assert.match(studioJs, /function renderCommandStructuredEditor/);
  assert.match(studioJs, /parseDirectorCommand/);
  assert.match(studioJs, /formatDirectorCommand/);
  assert.match(studioJs, /line\.type==='command'/);
  assert.match(studioJs, /row\.draggable=true/);
});


test('0.44.1 Studio treats mirror-safe art as normal and asymmetric left/right art as the opt-in exception', () => {
  assert.match(studioHtml, /id="stageCopyComposition"/);
  assert.match(studioHtml, /id="stagePasteComposition"/);
  assert.match(studioHtml, /id="stageInheritComposition"/);
  assert.match(studioHtml, /id="stageResetAuto"/);
  assert.match(studioHtml, /直接拖立绘上下左右/);
  assert.match(studioJs, /data-asymmetric-facing/);
  assert.match(studioJs, /这个角色左右不对称/);
  assert.match(studioJs, /普通立绘默认可左右镜像/);
  assert.doesNotMatch(studioJs, /data-facing-policy|data-native-facing/);
  assert.match(stageEditorJs, /\['flippable','paired'\]\.includes\(policy\)/);
  assert.match(stageEditorJs, /切换左右独立素材/);
  assert.match(canvasStageTs, /policy !== 'flippable'\) return false/);
});


test('0.44 Studio binds real paired left/right art and provides direct-manipulation camera framing', () => {
  assert.match(studioJs, /data-paired-layer="left:base"/);
  assert.match(studioJs, /data-paired-layer="right:base"/);
  assert.match(studioJs, /L\/R 独立素材/);
  assert.match(stageEditorJs, /切换左右独立素材/);
  assert.match(canvasStageTs, /characterForStageFacing/);
  assert.match(canvasStageTs, /policy !== 'paired'/);
  assert.match(studioHtml, /id="cameraDirectEditor"/);
  assert.match(studioHtml, /id="cameraEditToggle"/);
  assert.match(studioHtml, /拖动画面重新取景/);
  assert.doesNotMatch(studioHtml, /cameraXEdit|cameraYEdit|cameraZoomNumber/);
});


test('0.44.3 Studio exposes human-readable batch punctuation timing instead of editing dialogue text', () => {
  assert.match(studioHtml, /id="batchPunctuationMode"/);
  assert.match(studioHtml, /所有标点同一停顿/);
  assert.match(studioHtml, /不同标点分别设置/);
  assert.match(studioHtml, /连续标点按一个标点簇处理/);
  assert.match(studioJs, /punctuationPauses=\{mode:'custom'/);
});

test('0.45 Studio exposes collapsible Director Beats and expression inheritance', () => {
  assert.match(studioHtml, /Replay Lab Studio 0\.57\.0-dev/);
  assert.match(studioJs, /function makeScriptBeat/);
  assert.match(studioJs, /演出 ×\$\{row\.count\}/);
  assert.match(studioJs, /继承上一表情/);
  assert.match(studioJs, /expressionMode='inherit'/);
  assert.match(studioJs, /expressionMode='set'/);
});


test('0.46 Studio edits Director Beats and reuses the existing custom-action vocabulary', () => {
  assert.match(studioHtml, /id="beatInspectorBlock"/);
  assert.match(studioHtml, /同时发生/);
  assert.match(studioHtml, /顺序发生/);
  assert.match(studioHtml, /data-beat-add="motion"/);
  assert.match(studioJs, /function renderBeatInspector/);
  assert.match(studioJs, /setDirectorBeatTiming/);
  assert.match(studioJs, /\/motion \$\{quote\(name\)\} shake_minor 0\.5/);
  assert.match(studioJs, /data-command-motion/);
  assert.match(studioJs, /指令加入演出 Beat/);
});

test('0.47 Stage Direct Editor exposes onion-skin references without writing them into project authoring',()=>{
  assert.match(studioHtml,/id="stageOnionControls"/);
  assert.match(studioHtml,/id="onionPrev"/);
  assert.match(studioHtml,/id="onionNext"/);
  assert.match(studioHtml,/id="onionScope"/);
  assert.match(stageEditorJs,/renderOnionGhosts/);
  assert.match(stageEditorJs,/getPreviousPerformanceLine/);
  assert.match(stageEditorJs,/getNextPerformanceLine/);
});

test('0.47 Studio treats fullscreen CG and arbitrary Custom Objects as separate presentation layers',()=>{
  assert.match(studioHtml,/id="cgFitEdit"/);
  assert.match(studioHtml,/id="cgHideCharacters"/);
  assert.match(studioHtml,/id="cgHideTextbox"/);
  assert.match(studioJs,/自定义对象/);
  assert.match(studioJs,/createCustomObject/);
  assert.match(studioJs,/\/object show/);
  assert.match(canvasStageTs,/drawCustomObjects/);
  assert.match(canvasStageTs,/cgPresentation/);
});


test('0.50 Studio exposes scene-local lighting, scoped filters and CG masks without numeric shader authoring',()=>{
  assert.match(studioHtml,/id="ambientLightEnable"/);
  assert.match(studioHtml,/id="worldFilterPreset"/);
  assert.match(studioHtml,/id="outputFilterPreset"/);
  assert.match(studioHtml,/id="layerFilterTarget"/);
  assert.match(studioHtml,/id="cgMaskKind"/);
  assert.match(studioHtml,/圆形 \/ 手电筒/);
  assert.match(studioJs,/SCENE_FILTER_PRESETS/);
  assert.match(studioJs,/ensureSceneGraphPatch/);
  assert.match(canvasStageTs,/withEffects/);
  assert.match(canvasStageTs,/worldEffects/);
  assert.match(canvasStageTs,/outputEffects/);
});


test('0.51 Custom Object authoring uses direct hotspot manipulation and playable interaction recording',()=>{
  assert.match(studioJs,/可视化交互 \/ 热点编辑/);
  assert.match(customObjectEditorJs,/object-hotspot-box/);
  assert.match(customObjectEditorJs,/右下角拖柄缩放/);
  assert.match(customObjectEditorJs,/切换状态/);
  assert.match(studioHtml,/id="playtestRecordObject"/);
  assert.match(studioJs,/beginRecording/);
  assert.match(studioJs,/bakeCustomObjectInteractionTake/);
  assert.match(playerJs,/CustomObjectInteractionController/);
  assert.match(playerJs,/panBy/);
  assert.match(playerJs,/zoomBy/);
});


test('0.51.2 Studio keeps a read-only live mini preview when the main stage scrolls out of view', () => {
  assert.match(studioHtml, /id="stageMiniPreview"/);
  assert.match(studioHtml, /id="stageMiniCanvas"/);
  assert.match(studioHtml, /实时预览/);
  assert.match(studioHtml, /只读/);
  assert.match(studioHtml, /resize:both/);
  assert.match(studioJs, /IntersectionObserver/);
  assert.match(studioJs, /ctx\.drawImage\(source,0,0,target\.width,target\.height\)/);
  assert.match(studioJs, /rendered&&!entry\.isIntersecting/);
});


test('0.52 Studio uses a fixed Program Monitor plus a collapsible semantic Workbench',()=>{
  assert.match(studioHtml,/id="workbench"/);
  assert.match(studioHtml,/data-workbench-tab="performance"[^>]*>演出/);
  assert.match(studioHtml,/data-workbench-tab="audio"[^>]*>音频/);
  assert.match(studioHtml,/data-workbench-tab="voice"[^>]*>朗读/);
  assert.match(studioHtml,/data-workbench-size="collapsed"/);
  assert.match(studioHtml,/data-workbench-size="expanded"/);
  assert.match(studioHtml,/data-context-tab="properties"[^>]*>属性/);
  assert.match(studioHtml,/data-context-tab="check"[^>]*>检查/);
  assert.match(studioHtml,/data-context-tab="publish"[^>]*>发布/);
  assert.match(studioJs,/performancePane\.append/);
  assert.match(studioJs,/inspector\.dataset\.contextPane='properties'/);
});

test('0.53 Audio Workbench binds Dialogue and Voice by lineId and exposes real semantic tracks',()=>{
  assert.match(audioWorkbenchJs,/Dialogue \/ Voice \/ SFX \/ Ambient \/ BGM/);
  assert.match(audioWorkbenchJs,/data-line-id="\$\{line\.lineId\}"/);
  assert.match(audioWorkbenchJs,/class="waveform"/);
  assert.match(audioWorkbenchJs,/ReplayLabWaveforms/);
  assert.match(audioWorkbenchJs,/bgmCrossfadeSeconds/);
  assert.match(audioWorkbenchJs,/data-mix-check="ducking"/);
  assert.match(audioWorkbenchJs,/data-mix-check="limiter"/);
  assert.match(studioJs,/data-line-audio="voicePan"/);
  assert.match(studioJs,/data-line-audio="sfxPan"/);
  assert.match(studioHtml,/id="ambientEdit"/);
});

test('0.53.1 default audio UI stays simple while precise mix controls remain behind Advanced Tools',()=>{
  assert.match(audioWorkbenchJs,/人声','voiceVolume'/);
  assert.match(audioWorkbenchJs,/背景音乐','bgmVolume'/);
  assert.match(audioWorkbenchJs,/环境声','ambientVolume'/);
  assert.match(audioWorkbenchJs,/音效','sfxVolume'/);
  assert.match(audioWorkbenchJs,/对白时自动降低背景音乐/);
  assert.match(audioWorkbenchJs,/BGM 自动淡入淡出/);
  assert.match(audioWorkbenchJs,/audio-advanced advanced-only/);
  assert.match(audioWorkbenchJs,/精确混音/);
  assert.match(audioWorkbenchJs,/输出保护（Limiter）/);
  assert.match(studioJs,/精确声音时间 \/ 声像/);
  assert.match(studioJs,/data-line-audio="voicePan"/);
  assert.match(studioJs,/data-line-audio="voiceOffset"/);
  assert.match(studioJs,/data-line-audio="sfxPan"/);
});



test('0.53.2 exposes a project-wide spoken language separate from Log language and an optional Voicebox Local backend', () => {
  assert.match(studioHtml, /id="projectSpeechLanguage"/);
  assert.match(studioHtml, /工程统一朗读语言/);
  assert.match(studioJs, /project\.settings\.speechLanguage/);
  assert.match(voiceHtml, /id="speechLanguage"/);
  assert.match(voiceHtml, /Voicebox Local（可选）/);
  assert.match(voiceJs, /VOICEBOX_LOCAL_TTS_ID/);
  assert.match(voiceJs, /同语言样本会优先显示/);
});
