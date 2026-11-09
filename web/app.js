import { WorkerReplayLabFreeTtsProvider } from './worker-tts-provider.js';
import {serviceFetch} from './desktop-client.js';
import {createProsodyEditor} from './prosody-editor.js';
import {createTranslationBridge} from './translation-bridge-controller.js';
import {createVoiceReview} from './voice-review-controller.js';
import {
  createDefaultImporterRegistry,
  compilePerformance,
  BUILTIN_TEMPLATES,
  applyTemplate,
  resolveSpeechPolicy,
  resolveSpeechTargetLanguage,
  resolveCachedSpeech,
  speechInputFingerprint,
  captureSpeechGuard,
  StaleSpeechError,
  prepareLineSpeech,
  prepareProjectSpeech,
  TranslationRegistry,
  LibreTranslateProvider,
  searchAccents,
  getAccentProfile,
  resolveCharacterAccent,
  accentSynthesisHint,
  REPLAYLAB_FREE_TTS_ID,
  VOICEBOX_LOCAL_TTS_ID,
  VoiceboxLocalTtsProvider,
  TtsRegistry,
  BrowserFileSystemWorkspace,
  isWorkspaceConflictError,
  persistGeneratedSpeech
} from '../dist/index.js';

const KOKORO_BROWSER_MODULE = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
const KOKORO_MODEL_BASE = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main';
const registry = createDefaultImporterRegistry();
const $ = s => document.querySelector(s);
if(!window.name)window.name='replaylab-voice';
let project = null;
let workspace = null;
let linkedHost = null;
let linkedSnapshot = '';
let linkedNotifyTimer;
let workspaceConflict = false;
let freeModelReady = false;
let freeModelLoading = false;
let freeModelPromise = null;
let activeVoiceJobs = 0;
let prosodyEditor = null;
let lastModelProgress = null;
const freeVoiceCache = new Map();
const batchReports = new Map();
const generatedAudio = new Map(); // lineId -> { blob, url, fingerprint, prepared }

async function refreshWorkspaceUi() {
  const state = $('#workspaceState');
  const detail = $('#workspaceDetail');
  if (workspaceConflict) return;
  if (linkedHost) {
    state.className = 'speech-status ok'; state.textContent = '已接续 Studio';
    detail.textContent = '与主窗口共用工程；保存和素材写入由 Studio 处理。';
    updateJobControls(); return;
  }
  if (!workspace) {
    state.className = 'speech-status'; state.textContent = '未连接';
    $('#saveWorkspace').disabled = true; $('#refreshWorkspace').disabled = true;
    detail.textContent = '选择工程文件夹后，生成的音频会随工程保存。';
    return;
  }
  const files = await workspace.list().catch(() => []);
  const voices = files.filter(file => file.path.startsWith('assets/voice/')).length;
  const media = files.filter(file => file.path.startsWith('assets/')).length;
  state.className = 'speech-status ok'; state.textContent = '已连接';
  $('#saveWorkspace').disabled = false; $('#refreshWorkspace').disabled = false;
  detail.textContent = `${workspace.label} · ${media} 个素材文件 · ${voices} 个语音文件 · project.replaylab.json ${files.some(f=>f.path==='project.replaylab.json')?'已存在':'未保存'}`;
}

function showVoiceWorkspaceConflict(error) {
  workspaceConflict = true;
  $('#voiceWorkspaceDetails').open = true;
  $('#workspaceState').textContent = '目录有新版本';
  $('#workspaceState').className = 'speech-status error';
  $('#saveWorkspace').disabled = true;
  $('#reloadVoiceWorkspace').hidden = false;
  $('#workspaceDetail').textContent = `另一个 Replay Lab 窗口或程序已经修改工程目录。声音页已停止写入，避免覆盖 Studio 的新内容。若本页设置要保留，请先记下或导出；然后重新载入目录版本。${error?.message ? ` · ${error.message}` : ''}`;
}

async function chooseWorkspace() {
  if (linkedHost || activeVoiceJobs) return;
  const previous = workspace;
  const previousProject = project;
  try {
    const next = await BrowserFileSystemWorkspace.choose();
    const existing = await next.loadProject();
    if (existing && project?.lines?.length && !confirm(`所选目录已有工程「${existing.title || '未命名 Replay'}」。打开它会替换当前声音页中的测试工程。继续吗？`)) return;
    workspace = next; workspaceConflict = false; $('#reloadVoiceWorkspace').hidden = true;
    if (existing) {
      clearGeneratedAudio();
      project = existing;
      $('#logLanguage').value = project.settings?.logLanguage || 'auto';
      $('#speechLanguage').value = project.settings?.speechLanguage || 'auto';
      renderCharacters(); renderLineSelect(); compile();
      setStatus(`已载入工程目录：${workspace.label}`, 'ok');
      $('#voiceWorkspaceDetails').open = false;
    } else if (project) {
      await workspace.saveProject(project);
      setStatus(`已连接工程目录：${workspace.label}`, 'ok');
    }
    await refreshWorkspaceUi();
  } catch (error) {
    workspace = previous;
    project = previousProject;
    if (error?.name === 'AbortError') return;
    setStatus(`工程目录连接失败：${error.message || error}`, 'error');
  }
}
async function persistPreparedLineAudio(line, prepared) {
  if (linkedHost && prepared?.ttsResult) {
    const result = await linkedHost.adopt(project, line, prepared);
    if (!result.saved) throw new Error('音频已保留在 Studio 草稿中，但目录保存失败。请在主窗口处理保存提示。');
    return result;
  }
  if (!workspace || !prepared?.ttsResult) return null;
  const result = await persistGeneratedSpeech(workspace, project, line, prepared);
  return result;
}

function updateModelProgress(event = {}) {
  lastModelProgress = { ...event };
  const state = $('#freeModelState');
  const bar = $('#freeModelProgress');
  const detail = $('#freeModelDetail');
  const status = String(event.status || 'loading');
  let progress = Number(event.progress);
  if (!Number.isFinite(progress) && event.loaded && event.total) progress = Number(event.loaded) / Number(event.total) * 100;
  if (Number.isFinite(progress)) {
    if (progress <= 1) progress *= 100;
    bar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
  }
  state.className = 'speech-status busy';
  state.textContent = '加载中';
  const file = event.file ? ` · ${event.file}` : '';
  const pct = Number.isFinite(progress) ? ` · ${progress.toFixed(0)}%` : '';
  detail.textContent = `${status}${file}${pct}`;
}

const freeProvider = new WorkerReplayLabFreeTtsProvider({
  moduleSpecifier: KOKORO_BROWSER_MODULE,
  dtype: 'q8',
  device: 'auto',
  onProgress: updateModelProgress
});
let voiceboxProvider = new VoiceboxLocalTtsProvider({ baseUrl: 'http://127.0.0.1:17493',fetchImpl:serviceFetch });
const ttsRegistry = new TtsRegistry().register(freeProvider).register(voiceboxProvider);
for (const id of ['voiceboxEndpoint', 'bridgeEndpoint', 'translateEndpoint']) {
  try { const saved = localStorage.getItem(`replaylab.${id}`); if (saved) $(`#${id}`).value = saved; } catch {}
}
function resetVoiceboxProvider(){
  const endpoint=$('#voiceboxEndpoint')?.value.trim()||'http://127.0.0.1:17493';
  const bridgeUrl=$('#bridgeEndpoint')?.value.trim()||'http://127.0.0.1:17494';
  voiceboxProvider=new VoiceboxLocalTtsProvider({baseUrl:endpoint, bridgeUrl,fetchImpl:serviceFetch});
  ttsRegistry.register(voiceboxProvider);
  for (const [id, value] of [['voiceboxEndpoint', endpoint], ['bridgeEndpoint', bridgeUrl]]) {
    try { localStorage.setItem(`replaylab.${id}`, value); } catch {}
  }
  return voiceboxProvider;
}
resetVoiceboxProvider();

function freeProviderSupportsLanguage(language) {
  if (!language || language === 'auto') return true;
  const supported = freeProvider?.capabilities?.supportedLanguages || [];
  return supported.some(item => item.toLowerCase() === language.toLowerCase());
}

for (const template of BUILTIN_TEMPLATES) {
  const option = document.createElement('option');
  option.value = template.id;
  option.textContent = template.name;
  $('#template').append(option);
}

$('#freeRuntimeHint').textContent = navigator.gpu ? '预计使用 WebGPU' : '当前浏览器将使用 WASM fallback';

function languageBase(language = '') { return language.toLowerCase().split('-')[0]; }
function currentAccentSelection(character, language) {
  return resolveCharacterAccent(character, language)?.selection ?? null;
}
function ensureAccentSelection(character, language) {
  character.speech ??= { voices: {}, accents: {} };
  character.speech.accents ??= {};
  return character.speech.accents[language] ??= structuredClone(currentAccentSelection(character, language) ?? { accentId: null, query: '', strength: 'natural', useRegionalVocabulary: false });
}
function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function setStatus(text, kind = '') {
  const el = $('#status');
  el.textContent = text;
  el.className = kind ? `speech-status ${kind}` : 'muted';
}
function setLineSpeechState(text, kind = '') {
  const el = $('#lineSpeechState');
  el.textContent = text;
  el.className = `speech-status${kind ? ` ${kind}` : ''}`;
}
function blobFromTtsAudio(result) {
  const audio = result?.audio;
  if (audio instanceof Blob) return audio;
  if (audio instanceof ArrayBuffer) return new Blob([audio], { type: result.mime || 'audio/wav' });
  if (audio instanceof Uint8Array) return new Blob([audio], { type: result.mime || 'audio/wav' });
  throw new Error('TTS provider returned an unsupported audio payload.');
}
function audioExtension(blob) {
  const type = blob?.type || '';
  if (type.includes('wav')) return 'wav';
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('webm')) return 'webm';
  return 'audio';
}
function revokeCacheEntry(entry) { if (entry?.url) URL.revokeObjectURL(entry.url); }
function clearGeneratedAudio() {
  batchReports.clear();
  for (const entry of generatedAudio.values()) revokeCacheEntry(entry);
  generatedAudio.clear();
  syncCurrentAudioUi();
}
function lineFingerprint(line) {
  if (!project || !line) return '';
  return JSON.stringify({
    input: speechInputFingerprint(project,line),
    audioAssetId: line.audioAssetId || null,
    endpoints: connectionFingerprint(),
    translation: line.speech?.translationCache
  });
}
function cachedLineAudio(line) {
  const entry = line ? generatedAudio.get(line.id) : null;
  if (!entry) return null;
  if (entry.fingerprint !== lineFingerprint(line)) {
    return null;
  }
  return entry;
}
function storeGeneratedLineAudio(line, prepared) {
  if (!prepared?.ttsResult) return null;
  const old = generatedAudio.get(line.id);
  if (old) revokeCacheEntry(old);
  const blob = blobFromTtsAudio(prepared.ttsResult);
  const entry = {
    blob,
    url: URL.createObjectURL(blob),
    fingerprint: lineFingerprint(line),
    prepared
  };
  generatedAudio.set(line.id, entry);
  return entry;
}
function invalidateCharacterAudio(characterId) {
  syncCurrentAudioUi();
}

function accentRuleGroups(profile, selection) {
  if (!profile) return '';
  const titles = { pronunciation: '发音', prosody: '韵律', vocabulary: '地区用词' };
  const categories = ['pronunciation', 'prosody', 'vocabulary'];
  const explicit = Array.isArray(selection?.enabledRuleIds) ? new Set(selection.enabledRuleIds) : null;
  return categories.map(category => {
    const rules = profile.rules.filter(rule => rule.category === category);
    if (!rules.length) return '';
    const content = rules.map(rule => {
      const checked = explicit ? explicit.has(rule.id) : rule.defaultEnabled !== false;
      const examples = rule.examples?.length ? `<div class="rule-examples">例：${rule.examples.map(escapeHtml).join(' · ')}</div>` : '';
      return `<label class="rule-row"><input type="checkbox" data-rule-id="${rule.id}" ${checked ? 'checked' : ''}><span><b>${escapeHtml(rule.label)}</b><small>${escapeHtml(rule.description)}</small>${examples}</span></label>`;
    }).join('');
    return `<div class="rule-group"><div class="rule-title">${titles[category]}</div>${content}</div>`;
  }).join('');
}

function renderAccentDetails(host, character, language, selection) {
  const profile = getAccentProfile(selection?.accentId);
  if (!profile) {
    host.innerHTML = selection?.query
      ? `<div class="muted">“${escapeHtml(selection.query)}” 暂无精确目录项。保留口音意图，但 TTS 只能按语言/locale 回退。</div>`
      : '<div class="muted">未选择口音。TTS 只按语言和声音本身处理。</div>';
    return;
  }
  const region = [profile.region?.city, profile.region?.region, profile.region?.country].filter(Boolean).join(' · ');
  host.innerHTML = `<div class="accent-picked"><div><b>${escapeHtml(profile.label)}</b>${region ? `<div class="muted">${escapeHtml(region)}</div>` : ''}</div><span class="support-pill">fallback ${escapeHtml(profile.localeFallback)}</span></div>
    <div class="muted">${escapeHtml(profile.summary)}</div>
    <details class="accent-rules"><summary>发音规则 / 韵律 / 地区用词（高级）</summary>
      <div class="warning-note">${escapeHtml(profile.variabilityNote ?? '')}</div>
      ${accentRuleGroups(profile, selection)}
    </details>`;
  host.querySelectorAll('[data-rule-id]').forEach(box => box.addEventListener('change', () => {
    const selected = ensureAccentSelection(character, language);
    selected.enabledRuleIds = [...host.querySelectorAll('[data-rule-id]:checked')].map(input => input.dataset.ruleId);
    invalidateCharacterAudio(character.id);
    compile();
  }));
}

function voiceTaskBusy(){ return freeModelLoading || activeVoiceJobs > 0; }
function updateJobControls(){
  for (const id of ['chooseWorkspace','parse','reloadVoiceWorkspace','template']) $("#"+id).disabled = !!linkedHost || activeVoiceJobs > 0;
  $('#saveWorkspace').disabled = activeVoiceJobs > 0 || workspaceConflict || (!workspace && !linkedHost);
  $('#refreshWorkspace').disabled = !workspace || activeVoiceJobs > 0;
}
function beginVoiceJob(){ activeVoiceJobs += 1; updateJobControls(); }
function endVoiceJob(){ activeVoiceJobs = Math.max(0, activeVoiceJobs - 1); updateJobControls(); notifyHost(); }
function connectionFingerprint(){return ['voiceboxEndpoint','bridgeEndpoint','translateEndpoint'].map(id=>$('#'+id).value.trim()).join('\n');}
function captureContext(line){
  const owner=project,directory=workspace,host=linkedHost,connections=connectionFingerprint();
  const guard=line?captureSpeechGuard(owner,line):()=>{};
  return {owner,assertCurrent(){
    if(project!==owner||workspace!==directory||linkedHost!==host||connectionFingerprint()!==connections) throw new StaleSpeechError('工程或服务连接已改变；旧请求结果未采用。');
    host?.assert(owner); guard();
  }};
}
window.addEventListener('beforeunload', event => {
  if(linkedHost&&project)void linkedHost.changed(project).catch(()=>{});
  if (!voiceTaskBusy()) return;
  event.preventDefault();
  event.returnValue = '';
});

async function checkFreeModelNetwork() {
  const button=$('#checkFreeModelNetwork'),old=button.textContent;button.disabled=true;button.textContent='检查中…';
  const checks=[
    ['kokoro-js 模块',KOKORO_BROWSER_MODULE,'GET'],
    ['Hugging Face 配置',`${KOKORO_MODEL_BASE}/config.json`,'GET'],
    ['Q8 模型文件',`${KOKORO_MODEL_BASE}/onnx/model_quantized.onnx`,'HEAD']
  ];
  const results=[];
  for(const [label,url,method] of checks){
    try{const response=await fetch(url,{method,cache:'no-store'});results.push(`${label}：${response.ok?'可访问':`HTTP ${response.status}`}`)}
    catch(error){results.push(`${label}：不可访问（${error.message||error}）`)}
  }
  const failed=results.some(text=>/不可访问|HTTP [45]/.test(text));
  $('#freeModelDetail').textContent=results.join('；');
  setStatus(failed?'下载连接存在阻断；上面的结果可以看出是代码模块还是模型源不可达。':'下载入口均可访问；如果仍失败，更可能是浏览器内存/WebGPU/WASM 初始化问题。',failed?'error':'ok');
  button.disabled=false;button.textContent=old;
}

async function retryFreeModelDownload(device = 'auto') {
  freeModelReady = false;
  freeVoiceCache.clear();
  freeProvider.restart?.({ device });
  $('#freeModelProgress').style.width = '0%';
  $('#retryFreeModel').hidden = true;
  $('#retryFreeModelWasm').hidden = true;
  $('#freeRuntimeHint').textContent = device === 'wasm' ? '强制使用 WASM（兼容模式）' : (navigator.gpu ? '预计使用 WebGPU' : '当前浏览器将使用 WASM fallback');
  return await loadFreeModel();
}

async function loadFreeModel() {
  if (freeModelReady) return true;
  if (freeModelPromise) return await freeModelPromise;
  if (!freeProvider?.warmup) throw new Error('Replay Lab Free provider does not expose warmup().');
  freeModelLoading = true;
  $('#loadFreeModel').disabled = true;
  $('#cancelFreeModel').hidden = false;
  $('#retryFreeModelWasm').hidden = true;
  $('#freeModelState').className = 'speech-status busy';
  $('#freeModelState').textContent = '后台加载中';
  $('#freeModelDetail').textContent = '模型正在独立 Worker 中下载 / 初始化；你可以继续编辑这个页面。';
  const task = (async () => {
    try {
      await freeProvider.warmup();
      freeModelReady = true;
      $('#freeModelProgress').style.width = '100%';
      $('#freeModelState').className = 'speech-status ok';
      $('#freeModelState').textContent = '已加载';
      $('#freeModelDetail').textContent = '后台 Worker 已就绪。免费 Voice 可列出、试听和批量生成。';
      $('#loadFreeModel').textContent = '免费声音已加载';
      freeVoiceCache.clear();
      renderCharacters();
      setStatus('Replay Lab Free 已在后台 Worker 中就绪。', 'ok');
      return true;
    } catch (error) {
      if (error?.name === 'AbortError') {
        $('#freeModelState').className = 'speech-status';
        $('#freeModelState').textContent = '已取消';
        $('#freeModelDetail').textContent = '加载已取消；页面仍可继续使用。需要时可重新后台加载。';
        setStatus('已取消免费声音后台加载。');
        return false;
      }
      $('#freeModelState').className = 'speech-status error';
      $('#freeModelState').textContent = '加载失败';
      const lastFile=lastModelProgress?.file?`；最后处理：${lastModelProgress.file}`:'';
      $('#freeModelDetail').textContent = `${error.message || String(error)}${lastFile}`;
      $('#retryFreeModel').hidden = false;
      $('#retryFreeModelWasm').hidden = false;
      freeProvider.restart?.({});
      setStatus(`免费声音加载失败：${error.message || error}`, 'error');
      return false;
    } finally {
      freeModelLoading = false;
      $('#cancelFreeModel').hidden = true;
      $('#loadFreeModel').disabled = freeModelReady;
      if (!freeModelReady) $('#loadFreeModel').textContent = '后台加载免费声音';
    }
  })();
  freeModelPromise = task;
  try { return await task; }
  finally { if (freeModelPromise === task) freeModelPromise = null; }
}

function cancelFreeModelLoad() {
  if (!freeModelLoading) return;
  freeProvider.cancel?.();
}

async function retryFreeModelWithWasm() { await retryFreeModelDownload('wasm'); }

async function freeVoicesForLanguage(language) {
  const key = language || 'auto';
  if (freeVoiceCache.has(key)) return freeVoiceCache.get(key);
  if (!freeModelReady) return [];
  const voices = await freeProvider.listVoices(language === 'auto' ? undefined : language);
  freeVoiceCache.set(key, voices);
  return voices;
}

function voicePreviewText(language = 'en-US') {
  const base = languageBase(language);
  const samples = {
    zh: '这是 Replay Lab 的免费声音试听。',
    ja: 'これはリプレイラボの無料音声プレビューです。',
    fr: 'Ceci est un aperçu de la voix gratuite de Replay Lab.',
    es: 'Esta es una muestra de la voz gratuita de Replay Lab.',
    it: 'Questa è un’anteprima della voce gratuita di Replay Lab.',
    pt: 'Esta é uma prévia da voz gratuita do Replay Lab.',
    hi: 'यह Replay Lab की निःशुल्क आवाज़ का नमूना है।',
    en: 'This is a Replay Lab free voice preview.'
  };
  return samples[base] || samples.en;
}

async function previewFreeVoice(character, language, voiceId, audioEl, button) {
  if (!(await loadFreeModel())) return;
  if (!voiceId) {
    setStatus('请先选择一个免费 Voice。', 'error');
    return;
  }
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = '生成试听…';
  beginVoiceJob();
  try {
    const accent = resolveCharacterAccent(character, language);
    const result = await freeProvider.synthesize({
      text: voicePreviewText(language),
      language,
      voiceId,
      accent: accentSynthesisHint(accent)
    });
    const blob = blobFromTtsAudio(result);
    if (audioEl.dataset.objectUrl) URL.revokeObjectURL(audioEl.dataset.objectUrl);
    const url = URL.createObjectURL(blob);
    audioEl.dataset.objectUrl = url;
    audioEl.src = url;
    audioEl.style.display = 'block';
    await audioEl.play().catch(() => {});
  } catch (error) {
    setStatus(`试听失败：${error.message || error}`, 'error');
  } finally {
    endVoiceJob();
    button.disabled = false;
    button.textContent = oldText;
  }
}

function buildTranslationRegistry() {
  const translations = new TranslationRegistry();
  const endpoint = $('#translateEndpoint').value.trim();
  if (endpoint) {
    translations.register(new LibreTranslateProvider({ endpoint,fetchImpl:serviceFetch }));
  }
  return translations;
}

async function synthesizeLine(line, { autoplay = false } = {}) {
  if(activeVoiceJobs)throw new Error('已有声音任务在运行，请完成后再生成。');
  if (!line) throw new Error('没有选中的台词。');
  const context=captureContext(line);
  beginVoiceJob();
  try {
  context.assertCurrent();
  const policy = resolveSpeechPolicy(context.owner, line);
  const bound=context.owner.assets.find(a=>a.id===line.audioAssetId);
  const needsTts=line.type!=='command'&&(!line.audioAssetId||bound?.metadata?.generated);
  if (needsTts && (policy.ttsProvider || REPLAYLAB_FREE_TTS_ID) === REPLAYLAB_FREE_TTS_ID && !freeProviderSupportsLanguage(policy.targetLanguage)) {
    throw new Error(`当前内置免费引擎尚未覆盖 ${policy.targetLanguage}。请为这个语言槽绑定其他本地/外部 TTS。`);
  }
  if (needsTts && (policy.ttsProvider || REPLAYLAB_FREE_TTS_ID) === REPLAYLAB_FREE_TTS_ID && !freeModelReady) {
    const ok = await loadFreeModel();
    if (!ok) throw new Error('Replay Lab Free 模型未能加载。');
  }
  context.assertCurrent();
  const prepared = await prepareLineSpeech(context.owner, line, {
    assertCurrent: context.assertCurrent,
    translations: buildTranslationRegistry(),
    tts: ttsRegistry,
    translate: true,
    synthesize: true,
    regenerateGeneratedAudio: true
  });
  if (prepared.audioSource === 'imported') return { prepared, entry: null };
  const entry = storeGeneratedLineAudio(line, prepared);
  try { await persistPreparedLineAudio(line, prepared); }
  catch(error) { error.voicePhase='保存'; throw error; }
  finally {
    if(entry&&project===context.owner&&speechInputFingerprint(context.owner,line)===prepared.inputFingerprint)entry.fingerprint=lineFingerprint(line);
    syncCurrentAudioUi();
  }
  if (autoplay && entry && currentLine()?.id===line.id) {
    const audio = $('#lineAudioPreview');
    audio.src = entry.url;
    audio.style.display = 'block';
    await audio.play().catch(() => {});
  }
  return { prepared, entry };
  } finally { endVoiceJob(); }
}

function voiceFailureReport(owner,line,error,phase='生成') {
  const policy=line?resolveSpeechPolicy(owner,line):null;
  const message=String(error?.message||error);
  const heading=line?`第 ${owner.lines.indexOf(line)+1} 句 · ${phase}失败`:`${phase}失败`;
  const voice=policy?.voice||{};
  const route=policy?`${policy.ttsProvider} · ${policy.sourceLanguage} → ${policy.targetLanguage}`:'';
  const model=policy?.ttsProvider===VOICEBOX_LOCAL_TTS_ID?`${voice.mode==='experimental-clone-instruct'?'实验情绪桥':'稳定克隆'} · ${voice.modelSize||'0.6B'} · Profile：${voice.voiceId||'未选择'}`:'';
  let hint='';
  if(/fetch|connect|network|ECONNREFUSED|Failed to fetch/i.test(message))hint='请确认 Voicebox 已启动，再点上方「检查连接」；实验模式还需要单独启动情绪桥。';
  else if(/Translation required|translation provider/i.test(message))hint='原文与朗读语言需要翻译。请检查原文语言、翻译服务，或为这句填写译好的朗读文本。';
  else if(/timed? ?out|timeout/i.test(message))hint='服务响应超时；请查看 Voicebox 是否仍在加载模型或排队。';
  return [heading,route,model,line?`台词：${line.text.slice(0,160)}`:'',message,hint].filter(Boolean).join('\n');
}
async function batchSynthesizeCharacter(character, progressEl, button, reportEl) {
  if(activeVoiceJobs){setStatus('已有声音任务在运行，请完成后再批量生成。');return;}
  const context=captureContext();
  let activeLine=null,phase='准备',finished=0;
  const report=(text,kind='error')=>{batchReports.set(character.id,{text,kind});if(reportEl){reportEl.hidden=!text;reportEl.textContent=text;reportEl.className=`voice-batch-report ${kind}`}};
  report('','');
  const lines = context.owner.lines.filter(line => line.speakerId === character.id && line.type!=='command');
  if (!lines.length) return;
  const freePolicies = lines.filter(line=>!line.audioAssetId||context.owner.assets.find(a=>a.id===line.audioAssetId)?.metadata?.generated).map(line => resolveSpeechPolicy(context.owner, line))
    .filter(policy => policy.ttsProvider === REPLAYLAB_FREE_TTS_ID);
  const unsupported = freePolicies.find(policy => !freeProviderSupportsLanguage(policy.targetLanguage));
  if (unsupported) {
    const language = unsupported.targetLanguage;
    progressEl.className = 'speech-status error';
    progressEl.textContent = `免费引擎未覆盖 ${language}`;
    report(`${character.name}：当前有效服务是 Replay Lab Free，尚未覆盖 ${language}。请检查此角色及单句的声音服务选择。`);
    setStatus(`${character.name}：当前内置免费引擎尚未覆盖 ${language}，请绑定其他本地/外部 TTS。`, 'error');
    return;
  }
  const oldText = button.textContent;
  beginVoiceJob();
  button.disabled = true;
  button.textContent = '生成中…';
  progressEl.className = 'speech-status busy';
  progressEl.textContent = `0 / ${lines.length}`;
  try {
    if (freePolicies.length && !(await loadFreeModel())) throw new Error('免费模型未能加载。');
    context.assertCurrent();
    const results = await prepareProjectSpeech(context.owner, {
      assertCurrent: context.assertCurrent,
      translations: buildTranslationRegistry(),
      tts: ttsRegistry,
      translate: true,
      synthesize: true,
      regenerateGeneratedAudio: true,
      concurrency: 1, // local MLX inference is serialized to bound memory use
      onLineStart(line,index,total){activeLine=line;phase='生成';progressEl.textContent=`${finished} / ${total} · 第 ${index+1} 句`;},
      include: line => line.speakerId === character.id,
      async onProgress(completed, total, line, result) {
        context.assertCurrent();
        if(result.ttsResult){
          phase='保存';
          // Retain a downloadable session copy even if disk/host adoption fails.
          const entry=storeGeneratedLineAudio(line,result);
          try{await persistPreparedLineAudio(line,result);}
          finally{if(entry&&project===context.owner&&speechInputFingerprint(context.owner,line)===result.inputFingerprint)entry.fingerprint=lineFingerprint(line);}
        }
        finished=completed;phase='生成';
        progressEl.textContent = `${completed} / ${total}`;
      }
    });
    const generated = results.filter(result => result.ttsResult).length;
    const imported = results.filter(result => result.audioSource === 'imported').length;
    progressEl.className = 'speech-status ok';
    progressEl.textContent = `完成 ${generated}${imported ? ` · 已有音频 ${imported}` : ''}`;
    report(`已准备 ${results.length} 句。${workspace||linkedHost?'已采用的音频随工程保存；主窗口未选目录时仍是会话草稿。':'当前为会话音频，请下载或连接工程目录保存。'}`,'ok');
    setStatus(`${character.name}：已准备 ${results.length} 句语音。`, 'ok');
    syncCurrentAudioUi();
  } catch (error) {
    if (isWorkspaceConflictError(error)) showVoiceWorkspaceConflict(error);
    progressEl.className = 'speech-status error';
    progressEl.textContent = `停止 · 已完成 ${finished} / ${lines.length}`;
    report(voiceFailureReport(context.owner,activeLine,error,phase));
    syncCurrentAudioUi();
    setStatus(`${character.name} 批量生成停止，已完成的音频已保留：${error.message || error}`, 'error');
  } finally {
    endVoiceJob();
    button.disabled = false;
    button.textContent = oldText;
  }
}

function filterVoiceCharacters(){
  const query=$('#voiceCharacterSearch').value.trim().toLocaleLowerCase();
  const cards=[...$('#characters').querySelectorAll('.character-card')];let shown=0;
  for(const card of cards){card.hidden=!!query&&!card.dataset.characterName.toLocaleLowerCase().includes(query);if(!card.hidden)shown++;}
  $('#voiceCharacterCount').textContent=cards.length?(shown?`${shown} / ${cards.length} 个角色`:'没有匹配角色，请换个名字或显示全部'):'尚无角色';
  $('#clearVoiceCharacterSearch').disabled=!query;
}
$('#voiceCharacterSearch').addEventListener('input',filterVoiceCharacters);
$('#clearVoiceCharacterSearch').addEventListener('click',()=>{$('#voiceCharacterSearch').value='';filterVoiceCharacters();});
function renderCharacters() {
  const host = $('#characters');
  host.innerHTML = '';
  if (!(project?.characters?.length)) { host.innerHTML = '<div class="voice-empty">先打开工程目录，或在上方导入一份 Log。</div>'; filterVoiceCharacters();return; }
  for (const character of project?.characters ?? []) {
    character.speech ??= { defaultLanguage: null, voices: {}, accents: {} };
    character.speech.voices ??= {};
    character.speech.accents ??= {};

    const card = document.createElement('div');
    card.className = 'character-card stack';
    card.dataset.characterName=character.name;
    const head = document.createElement('div');
    head.className = 'character-head';
    head.innerHTML = `<strong>${escapeHtml(character.name)}</strong><span class="muted">语言与声音</span>`;

    const langRow = document.createElement('div');
    langRow.className = 'field-grid';
    const langLabel = document.createElement('label');
    langLabel.innerHTML = '<span>默认语言</span><small>留空 = 工程统一朗读语言</small>';
    const langInput = document.createElement('input');
    langInput.placeholder = 'en-GB / fr-FR / ja-JP';
    langInput.setAttribute('list', 'languageOptions');
    langInput.value = character.speech.defaultLanguage ?? '';
    langRow.append(langLabel, langInput);

    const pauseRow = document.createElement('div');
    pauseRow.className = 'field-grid';
    const pauseLabel = document.createElement('label');
    pauseLabel.innerHTML = '<span>朗读停顿</span><small>句末自动小停顿；/ 是手动停顿</small>';
    const pauseControls = document.createElement('div');
    pauseControls.className = 'row';
    const pauseRange = document.createElement('input');
    pauseRange.type = 'range'; pauseRange.min = '0'; pauseRange.max = '3'; pauseRange.step = '0.1'; pauseRange.style.flex = '1';
    pauseRange.value = String(character.speech.pauseScale ?? project.settings.speechPauseScale ?? 1);
    const pauseValue = document.createElement('span'); pauseValue.className = 'speech-status';
    const pauseReset = document.createElement('button'); pauseReset.type = 'button'; pauseReset.className = 'small'; pauseReset.textContent = '继承全剧';
    const refreshPause = () => { const value = character.speech.pauseScale ?? project.settings.speechPauseScale ?? 1; pauseRange.value = String(value); pauseValue.textContent = character.speech.pauseScale == null ? `继承 ${Number(value).toFixed(1)}×` : `${Number(value).toFixed(1)}×`; };
    pauseControls.append(pauseRange, pauseValue, pauseReset); pauseRow.append(pauseLabel, pauseControls); refreshPause();

    const accentArea = document.createElement('div');
    accentArea.className = 'accent-area stack';
    const controls = document.createElement('div');
    controls.className = 'accent-controls';
    const searchWrap = document.createElement('label');
    searchWrap.innerHTML = '<span>口音 / 地区（可选）</span><small>可以搜 London、Texas、India、伦敦、德州…</small>';
    const accentInput = document.createElement('input');
    accentInput.placeholder = '搜索地区或口音';
    const currentLanguage = () => resolveSpeechTargetLanguage(project, { speakerId: character.id });
    let selection = currentAccentSelection(character, currentLanguage());
    accentInput.value = selection?.query || getAccentProfile(selection?.accentId)?.shortLabel || '';
    searchWrap.append(accentInput);

    const strengthWrap = document.createElement('label');
    strengthWrap.innerHTML = '<span>口音强度</span><small>仅表达演出意图；provider 可忽略</small>';
    const strength = document.createElement('select');
    strength.innerHTML = '<option value="off">关闭</option><option value="light">轻微</option><option value="natural">自然</option><option value="strong">明显</option>';
    strength.value = selection?.strength ?? 'natural';
    strengthWrap.append(strength);

    const vocabWrap = document.createElement('label');
    vocabWrap.className = 'check-label';
    const vocab = document.createElement('input');
    vocab.type = 'checkbox';
    vocab.checked = !!selection?.useRegionalVocabulary;
    vocabWrap.append(vocab, document.createTextNode(' 翻译时采用地区自然用词'));
    controls.append(searchWrap, strengthWrap, vocabWrap);

    const results = document.createElement('div');
    results.className = 'accent-results';
    const details = document.createElement('div');
    details.className = 'accent-details';
    accentArea.append(controls, results, details);

    const voiceArea = document.createElement('div');
    voiceArea.className = 'voice-area stack';
    const voiceTitle = document.createElement('div');
    voiceTitle.innerHTML = '<strong>声音</strong><div class="voice-note">继承工程的默认声音服务，也可以为这个角色单独选择声线。</div>';
    const voiceControls = document.createElement('div');
    voiceControls.className = 'voice-controls';

    const sourceWrap = document.createElement('label');
    sourceWrap.innerHTML = '<span>声音来源</span><small>可继承工程或单独指定</small>';
    const sourceSelect = document.createElement('select');
    sourceSelect.innerHTML = '<option value="inherit">继承默认服务</option><option value="free">Replay Lab Free（浏览器）</option><option value="voicebox">Voicebox Local（可选）</option><option value="external" disabled>未注册的外部 TTS（不可生成）</option>';
    sourceWrap.append(sourceSelect);

    const providerWrap = document.createElement('label');
    providerWrap.innerHTML = '<span>Provider ID</span><small>例如 elevenlabs / my-local-tts</small>';
    const providerInput = document.createElement('input');
    providerInput.placeholder = '外部时填写';
    providerWrap.append(providerInput);

    const freeVoiceWrap = document.createElement('label');
    freeVoiceWrap.innerHTML = '<span>免费 Voice</span><small>模型加载后按语言列出</small>';
    const freeVoiceSelect = document.createElement('select');
    freeVoiceSelect.innerHTML = '<option value="">自动选择</option>';
    freeVoiceWrap.append(freeVoiceSelect);

    const voiceboxVoiceWrap = document.createElement('label');
    voiceboxVoiceWrap.innerHTML = '<span>Voicebox Profile</span><small>同语言样本优先；不同语言仍可选</small>';
    const voiceboxVoiceSelect = document.createElement('select');
    voiceboxVoiceSelect.innerHTML = '<option value="">先检查 Voicebox 连接</option>';
    voiceboxVoiceWrap.append(voiceboxVoiceSelect);

    const actingWrap = document.createElement('div');
    actingWrap.className = 'stack';
    actingWrap.style.gridColumn = '1 / -1';
    actingWrap.innerHTML = `<div class="warning-note"><b>实验：克隆声纹 + 情绪指令</b> · 需要启动本机 MLX 情绪桥和准备同尺寸 1.7B Base / CustomVoice。0.6B 不支持本桥的文字情绪。该模式只保证注入指定声纹，生成后的相似度仍需试听。</div>`;
    const actingGrid = document.createElement('div'); actingGrid.className = 'voice-controls';
    const modeLabel = document.createElement('label'); modeLabel.innerHTML = '<span>生成模式</span><small>稳定克隆 / 邪修实验</small>';
    const modeSelect = document.createElement('select'); modeSelect.innerHTML = '<option value="stable-clone">稳定声音克隆</option><option value="experimental-clone-instruct">实验：克隆 + 情绪</option>'; modeLabel.append(modeSelect);
    const emotionLabel = document.createElement('label'); emotionLabel.innerHTML = '<span>情绪基调</span><small>会组合为独立表演指令</small>';
    const emotionSelect = document.createElement('select'); emotionSelect.innerHTML = '<option value="">中性</option><option value="warm and gentle">温柔</option><option value="restrained anger, low and cold, do not shout">压着火气</option><option value="frightened, breath unsteady, trying to stay quiet">恐惧</option><option value="exhausted, quiet and slightly breathy">疲惫</option><option value="amused, with a slight smile">愉快</option><option value="whisper, intimate and close">耳语</option>'; emotionLabel.append(emotionSelect);
    const strengthLabel = document.createElement('label'); strengthLabel.innerHTML = '<span>情绪强度</span><small>轻 / 自然 / 强</small>';
    const actingStrength = document.createElement('select'); actingStrength.innerHTML = '<option value="subtle">轻微</option><option value="natural" selected>自然</option><option value="strong">明显</option>'; strengthLabel.append(actingStrength);
    const instructLabel = document.createElement('label'); instructLabel.style.gridColumn = '1 / -1'; instructLabel.innerHTML = '<span>补充表演指令</span><small>不要把台词写进这里</small>';
    const instructInput = document.createElement('textarea'); instructInput.rows = 2; instructInput.placeholder = '例如：前半句克制，最后两个词加重；不要喊叫。'; instructLabel.append(instructInput);
    const modelLabel = document.createElement('label'); modelLabel.innerHTML = '<span>模型</span><small>0.6B 稳定克隆；1.7B 可选文字情绪桥</small>';
    const modelSelect = document.createElement('select'); modelSelect.innerHTML = '<option value="0.6B">0.6B</option><option value="1.7B">1.7B</option>'; modelLabel.append(modelSelect);
    const seedLabel = document.createElement('label'); seedLabel.innerHTML = '<span>固定 Seed</span><small>留空 = 每次变化</small>';
    const seedInput = document.createElement('input'); seedInput.type = 'number'; seedInput.step = '1'; seedInput.placeholder = '例如 42'; seedLabel.append(seedInput);
    actingGrid.append(modeLabel, emotionLabel, strengthLabel, modelLabel, seedLabel, instructLabel);
    const stableActingNote = document.createElement('div'); stableActingNote.className = 'muted'; stableActingNote.textContent = '稳定声音克隆不使用情绪基调、强度和补充表演指令；需要时请切换到实验模式。';
    const syncStableActingNote = () => { stableActingNote.hidden = modeSelect.value !== 'stable-clone'; };
    modeSelect.addEventListener('change', syncStableActingNote);
    actingWrap.append(actingGrid, stableActingNote);

    const externalVoiceWrap = document.createElement('label');
    externalVoiceWrap.innerHTML = '<span>Voice ID</span><small>由用户自己的 Provider 提供</small>';
    const externalVoiceInput = document.createElement('input');
    externalVoiceInput.placeholder = '例如 arthur-v3';
    externalVoiceWrap.append(externalVoiceInput);

    voiceControls.append(sourceWrap, providerWrap, freeVoiceWrap, voiceboxVoiceWrap, externalVoiceWrap, actingWrap);

    const previewRow = document.createElement('div');
    previewRow.className = 'voice-action-row';
    const previewButton = document.createElement('button');
    previewButton.textContent = '试听当前免费 Voice';
    const loadVoicesButton = document.createElement('button');
    loadVoicesButton.textContent = '加载免费 Voice 列表';
    const batchButton = document.createElement('button');
    batchButton.className = 'primary';
    batchButton.textContent = '一键生成该角色语音';
    const batchState = document.createElement('span');
    batchState.className = 'speech-status';
    batchState.textContent = '未生成';
    previewRow.append(loadVoicesButton, previewButton, batchButton, batchState);
    const batchReport=document.createElement('pre');const lastReport=batchReports.get(character.id);batchReport.className=`voice-batch-report ${lastReport?.kind||''}`;batchReport.hidden=!lastReport?.text;batchReport.textContent=lastReport?.text||'';batchReport.setAttribute('role','status');batchReport.setAttribute('aria-live','polite');
    const previewAudio = document.createElement('audio');
    previewAudio.className = 'audio-player';
    previewAudio.controls = true;
    previewAudio.style.display = 'none';

    const priority = document.createElement('div');
    priority.className = 'voice-note';
    priority.textContent = '优先级：本句导入音频 > 外部 voice binding > Replay Lab Free。未连接工程目录时只保存在当前会话；连接后会落盘为正式工程素材。';
    voiceArea.append(voiceTitle, voiceControls, previewRow, batchReport, previewAudio, priority);
    const accentDisclosure = document.createElement('details');
    const accentSummary = document.createElement('summary');
    accentSummary.textContent = '口音 / 地区（可选）';
    accentDisclosure.append(accentSummary, accentArea);
    card.append(head, langRow, pauseRow, voiceArea, accentDisclosure);
    host.append(card);

    const getPreset = () => resolveSpeechPolicy(project,{speakerId:character.id}).voice;
    let freeListRequest=0,voiceboxListRequest=0;
    const keepSelectedVoice=(select,id)=>{
      if(id && ![...select.options].some(option=>option.value===id)){
        const option=document.createElement('option');option.value=id;option.textContent=`${id}（已保存，列表暂未提供）`;select.append(option);
      }
      select.value=id||'';
    };

    const populateFreeVoices = async () => {
      const request=++freeListRequest;
      const language = currentLanguage();
      const preset = getPreset();
      freeVoiceSelect.innerHTML = '<option value="">自动选择</option>';
      keepSelectedVoice(freeVoiceSelect,preset.voiceId);
      if (!freeProviderSupportsLanguage(language)) {
        freeVoiceSelect.innerHTML = `<option value="">当前内置免费引擎未覆盖 ${escapeHtml(language)}</option>`;
        freeVoiceSelect.disabled = true;
        loadVoicesButton.disabled = true;
        previewButton.disabled = true;
        return;
      }
      freeVoiceSelect.disabled = false;
      loadVoicesButton.disabled = false;
      previewButton.disabled = false;
      if (!freeModelReady) {
        const option = document.createElement('option');
        option.disabled = true;
        option.textContent = '先加载免费声音模型';
        freeVoiceSelect.append(option);
        return;
      }
      try {
        const voices = await freeVoicesForLanguage(language);
        if(request!==freeListRequest||language!==currentLanguage()||!card.isConnected)return;
        freeVoiceSelect.innerHTML='<option value="">自动选择</option>';
        for (const voice of voices) {
          const option = document.createElement('option');
          option.value = voice.id;
          const suffix = [voice.gender, voice.quality, ...(voice.tags || [])].filter(Boolean).join(' · ');
          option.textContent = `${voice.label}${suffix ? ` · ${suffix}` : ''}`;
          freeVoiceSelect.append(option);
        }
        keepSelectedVoice(freeVoiceSelect,getPreset().voiceId);
        if (!voices.length) {
          const option = document.createElement('option');
          option.disabled = true;
          option.textContent = `暂无 ${language} 免费 Voice`;
          freeVoiceSelect.append(option);
        }
      } catch (error) {
        setStatus(`读取免费 Voice 失败：${error.message || error}`, 'error');
      }
    };

    const populateVoiceboxVoices = async () => {
      const request=++voiceboxListRequest;
      const language = currentLanguage();
      const preset = getPreset();
      voiceboxVoiceSelect.innerHTML = '<option value="">选择 Voicebox Profile</option>';
      keepSelectedVoice(voiceboxVoiceSelect,preset.voiceId);
      try {
        const voices = await resetVoiceboxProvider().listVoices(language);
        if(request!==voiceboxListRequest||language!==currentLanguage()||!card.isConnected)return;
        voiceboxVoiceSelect.innerHTML='<option value="">选择 Voicebox Profile</option>';
        for (const voice of voices) {
          const option = document.createElement('option'); option.value = voice.id;
          const sampleLanguage = voice.languages?.[0] || '未标语言';
          const match = languageBase(sampleLanguage) === languageBase(language);
          option.textContent = `${match ? '✓ ' : '△ '}${voice.label} · 样本 ${sampleLanguage}`;
          voiceboxVoiceSelect.append(option);
        }
        keepSelectedVoice(voiceboxVoiceSelect,getPreset().voiceId);
      } catch (error) {
        if(request!==voiceboxListRequest||language!==currentLanguage()||!card.isConnected)return;
        voiceboxVoiceSelect.innerHTML = '<option value="">Voicebox 未连接</option>';
        keepSelectedVoice(voiceboxVoiceSelect,getPreset().voiceId);
      }
    };

    const syncVoiceControls = async () => {
      const preset = getPreset();
      const effectiveProvider = preset.provider || character.speech.ttsProvider || project.settings.ttsProvider;
      const voicebox = effectiveProvider === VOICEBOX_LOCAL_TTS_ID;
      const external = !!effectiveProvider && effectiveProvider !== REPLAYLAB_FREE_TTS_ID && !voicebox;
      sourceSelect.options[0].textContent=`继承默认：${character.speech.ttsProvider||project.settings.ttsProvider||REPLAYLAB_FREE_TTS_ID}`;
      sourceSelect.value = !preset.provider ? 'inherit' : voicebox ? 'voicebox' : external ? 'external' : 'free';
      providerInput.value = external ? (preset.provider || '') : '';
      externalVoiceInput.value = external ? (preset.voiceId || '') : '';
      providerWrap.style.display = external ? 'grid' : 'none';
      externalVoiceWrap.style.display = external ? 'grid' : 'none';
      freeVoiceWrap.style.display = (!external && !voicebox) ? 'grid' : 'none';
      voiceboxVoiceWrap.style.display = voicebox ? 'grid' : 'none';
      actingWrap.style.display = voicebox ? 'grid' : 'none';
      loadVoicesButton.style.display = (!external && !voicebox) ? 'inline-block' : 'none';
      previewButton.style.display = (!external && !voicebox) ? 'inline-block' : 'none';
      modeSelect.value = preset.mode || 'stable-clone';
      syncStableActingNote();
      instructInput.value = preset.instruct || '';
      emotionSelect.value = preset.actingPreset || '';
      actingStrength.value = preset.actingStrength || 'natural';
      modelSelect.value = preset.modelSize || '0.6B';
      seedInput.value = Number.isInteger(preset.seed) ? String(preset.seed) : '';
      if (voicebox) await populateVoiceboxVoices(); else if (!external) await populateFreeVoices();
    };

    const saveVoiceControls = (event) => {
      const language = currentLanguage();
      character.speech.voices ??= {};
      const inherited=structuredClone(getPreset());
      const preset = character.speech.voices[language] ??= inherited;
      const inherit=sourceSelect.value==='inherit';
      const inheritedProvider=character.speech.ttsProvider||project.settings.ttsProvider||REPLAYLAB_FREE_TTS_ID;
      const source=inherit?(inheritedProvider===VOICEBOX_LOCAL_TTS_ID?'voicebox':inheritedProvider===REPLAYLAB_FREE_TTS_ID?'free':'external'):sourceSelect.value;
      if (source === 'external') {
        preset.provider = providerInput.value.trim() || 'external';
        preset.voiceId = externalVoiceInput.value.trim() || undefined;
      } else if (source === 'voicebox') {
        preset.provider = VOICEBOX_LOCAL_TTS_ID;
        if(voiceboxVoiceSelect.value || event?.target===voiceboxVoiceSelect || event?.target===sourceSelect) preset.voiceId = voiceboxVoiceSelect.value || undefined;
        preset.mode = modeSelect.value;
        preset.actingPreset = emotionSelect.value || undefined;
        preset.actingStrength = actingStrength.value;
        preset.instruct = instructInput.value.trim() || undefined;
        preset.modelSize = modelSelect.value;
        preset.seed = seedInput.value === '' ? undefined : Number(seedInput.value);
      } else {
        preset.provider = REPLAYLAB_FREE_TTS_ID;
        if(freeVoiceSelect.value || event?.target===freeVoiceSelect || event?.target===sourceSelect) preset.voiceId = freeVoiceSelect.value || undefined;
        delete preset.mode; delete preset.actingPreset; delete preset.actingStrength; delete preset.instruct; delete preset.modelSize; delete preset.seed;
      }
      if(inherit)delete preset.provider;
      invalidateCharacterAudio(character.id);
      compile();
      renderLinePreview();
    };

    sourceSelect.addEventListener('change', async (event) => {
      if (sourceSelect.value === 'external') providerInput.focus();
      saveVoiceControls(event);
      await syncVoiceControls();
    });
    providerInput.addEventListener('input', saveVoiceControls);
    externalVoiceInput.addEventListener('input', saveVoiceControls);
    freeVoiceSelect.addEventListener('change', saveVoiceControls);
    voiceboxVoiceSelect.addEventListener('change', saveVoiceControls);
    modeSelect.addEventListener('change', () => {
      if (modeSelect.value === 'experimental-clone-instruct') modelSelect.value = '1.7B';
      saveVoiceControls();
    });
    emotionSelect.addEventListener('change', saveVoiceControls);
    actingStrength.addEventListener('change', saveVoiceControls);
    instructInput.addEventListener('input', saveVoiceControls);
    modelSelect.addEventListener('change', saveVoiceControls);
    seedInput.addEventListener('input', saveVoiceControls);
    loadVoicesButton.addEventListener('click', async () => {
      if (await loadFreeModel()) {
        await populateFreeVoices();
        setStatus(`${character.name}：已列出 ${currentLanguage()} 免费 Voice。`, 'ok');
      }
    });
    previewButton.addEventListener('click', () => previewFreeVoice(character, currentLanguage(), freeVoiceSelect.value, previewAudio, previewButton));
    batchButton.addEventListener('click', () => batchSynthesizeCharacter(character, batchState, batchButton, batchReport));

    const updateDetails = () => {
      const language = currentLanguage();
      selection = currentAccentSelection(character, language);
      const profile = getAccentProfile(selection?.accentId);
      const accentLabel = selection?.query || profile?.shortLabel || profile?.label || '';
      accentSummary.textContent = accentLabel ? `口音 / 地区 · ${accentLabel}` : '口音 / 地区（可选）';
      strength.value = selection?.strength ?? 'natural';
      vocab.checked = !!selection?.useRegionalVocabulary;
      renderAccentDetails(details, character, language, selection);
    };
    const renderMatches = () => {
      const language = currentLanguage();
      const query = accentInput.value.trim();
      const matches = searchAccents(language, query, 8);
      results.innerHTML = matches.map(({ profile }) => `<button type="button" class="accent-result" data-accent-id="${profile.id}"><span><b>${escapeHtml(profile.shortLabel || profile.label)}</b><small>${escapeHtml(profile.label)}</small></span><span class="muted">${escapeHtml(profile.localeFallback)}</span></button>`).join('');
      if (!matches.length && query) results.innerHTML = '<div class="muted">目录里暂时没有精确结果；搜索文字仍可作为自定义 accent intent 保存。</div>';
      results.querySelectorAll('[data-accent-id]').forEach(button => button.addEventListener('click', () => {
        const selected = ensureAccentSelection(character, language);
        const profile = getAccentProfile(button.dataset.accentId);
        selected.accentId = button.dataset.accentId;
        selected.query = query || profile?.shortLabel || profile?.label || '';
        selected.strength ??= 'natural';
        selected.useRegionalVocabulary ??= false;
        selected.enabledRuleIds = undefined;
        accentInput.value = profile?.shortLabel || profile?.label || query;
        results.innerHTML = '';
        invalidateCharacterAudio(character.id);
        updateDetails();
        compile();
      }));
    };

    pauseRange.addEventListener('input', () => { character.speech.pauseScale = Number(pauseRange.value); refreshPause(); invalidateCharacterAudio(character.id); compile(); });
    pauseReset.addEventListener('click', () => { delete character.speech.pauseScale; refreshPause(); invalidateCharacterAudio(character.id); compile(); });

    langInput.addEventListener('input', async () => {
      character.speech.defaultLanguage = langInput.value.trim() || null;
      accentInput.value = currentAccentSelection(character, currentLanguage())?.query || '';
      results.innerHTML = '';
      invalidateCharacterAudio(character.id);
      updateDetails();
      await syncVoiceControls();
      compile();
      renderLinePreview();
    });
    accentInput.addEventListener('input', () => {
      const selected = ensureAccentSelection(character, currentLanguage());
      selected.query = accentInput.value.trim();
      const profile = getAccentProfile(selected.accentId);
      if (selected.accentId && profile && !profile.aliases.concat(profile.label ?? '').some(v => v.toLowerCase().includes(selected.query.toLowerCase()))) selected.accentId = null;
      invalidateCharacterAudio(character.id);
      renderMatches();
      updateDetails();
      compile();
    });
    accentInput.addEventListener('focus', renderMatches);
    strength.addEventListener('change', () => {
      const selected = ensureAccentSelection(character, currentLanguage());
      selected.strength = strength.value;
      invalidateCharacterAudio(character.id);
      compile();
      updateDetails();
    });
    vocab.addEventListener('change', () => {
      const selected = ensureAccentSelection(character, currentLanguage());
      selected.useRegionalVocabulary = vocab.checked;
      invalidateCharacterAudio(character.id);
      compile();
      updateDetails();
    });

    updateDetails();
    syncVoiceControls();
  }
  filterVoiceCharacters();
}

function renderLineSelect() {
  $('#currentLineCard').hidden = !(project?.lines?.length);
  const select = $('#lineSelect');
  select.innerHTML = '';
  (project?.lines ?? []).forEach((line, index) => {
    const character = project.characters.find(c => c.id === line.speakerId);
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${index + 1}. ${character?.name ?? '?'}: ${line.text}`;
    select.append(option);
  });
  syncLineLanguageInput();
  renderLinePreview();
  syncCurrentAudioUi();
}

function currentLine() { return project?.lines[Number($('#lineSelect').value || 0)] ?? null; }
function syncLineLanguageInput() {
  const line = currentLine();
  $('#lineLanguage').value = line?.speech?.languageOverride ?? '';
  const acting = line?.speech?.acting;
  $('#lineActingOverride').checked = !!acting;
  $('#lineInstruct').disabled = !acting;
  $('#lineSeed').disabled = !acting;
  $('#lineActingPreset').disabled = !acting;
  $('#lineActingStrength').disabled = !acting;
  $('#lineActingPreset').value = acting?.actingPreset || '';
  $('#lineActingStrength').value = acting?.actingStrength || 'natural';
  $('#lineInstruct').value = acting?.instruct || '';
  $('#lineSeed').value = Number.isInteger(acting?.seed) ? acting.seed : '';
}
function syncCurrentAudioUi() {
  prosodyEditor?.refresh();
  const line = currentLine();
  const entry = cachedLineAudio(line);
  const audio = $('#lineAudioPreview');
  const download = $('#downloadLineAudio');
  $('#synthLine').disabled=activeVoiceJobs>0 || !line || line.type==='command';
  const previous=line && generatedAudio.get(line.id);
  if (previous && !entry) {
    setLineSpeechState('设置已改变 · 上一版音频仍可下载');
    download.disabled=false;audio.src=previous.url;audio.style.display='block';return;
  }
  if (line?.audioAssetId && entry) {
    const asset = project.assets.find(a => a.id === line.audioAssetId);
    setLineSpeechState(asset?.metadata?.generated ? '已生成 · 已绑定工程' : '已有绑定音频', 'ok');
    download.disabled = false;
    audio.src = entry.url;
    audio.style.display = 'block';
    return;
  }
  if (line?.audioAssetId) {
    const asset = project.assets.find(a => a.id === line.audioAssetId);
    setLineSpeechState(asset?.metadata?.generated ? '已有生成素材' : '已有绑定音频', 'ok');
    download.disabled = !(asset && (linkedHost || (workspace && asset.sourcePath) || (asset.uri && /^(data:|https?:|blob:)/i.test(asset.uri))));
    audio.style.display = 'none';
    return;
  }
  if (!entry) {
    setLineSpeechState('未生成');
    download.disabled = true;
    audio.removeAttribute('src');
    audio.style.display = 'none';
    return;
  }
  setLineSpeechState(entry.prepared.audioSource === 'builtin-tts' ? '已生成 · 免费本地' : '已生成 · 外部 TTS', 'ok');
  download.disabled = false;
  audio.src = entry.url;
  audio.style.display = 'block';
}
function renderLinePreview(extra = '') {
  const line = currentLine();
  if (!line) { $('#linePreview').textContent = ''; return; }
  const policy = resolveSpeechPolicy(project, line);
  const perf = compilePerformance(project).lines[Number($('#lineSelect').value || 0)];
  const accent = policy.accent?.profile?.label || policy.accent?.selection?.query || '未指定';
  const cache = cachedLineAudio(line);
  $('#linePreview').innerHTML = `<div><b>画面文字：</b>${escapeHtml(line.text)}</div>
    <div><b>语音语言：</b>${escapeHtml(policy.targetLanguage)} ${perf.translationPending ? '· 需要翻译' : '· 直接朗读/已有缓存'}</div>
    <div><b>角色口音：</b>${escapeHtml(accent)}${policy.accent ? ` · ${escapeHtml(policy.accent.strength)}` : ''}</div>
    <div><b>TTS：</b>${escapeHtml(policy.ttsProvider || REPLAYLAB_FREE_TTS_ID)}${line.audioAssetId ? ' · 本句绑定音频优先' : cache ? ' · 已有会话缓存' : ''}</div>
    <div><b>表演：</b>${escapeHtml([policy.voice.actingPreset, policy.voice.instruct].filter(Boolean).join(' · ') || '无附加情绪指令')} · ${policy.voice.mode === 'experimental-clone-instruct' ? '实验声纹注入 / 需试听' : '稳定模式：文字情绪未应用'}</div>
    <div><b>朗读文字：</b>${escapeHtml(perf.speechText)}</div>${extra ? `<div><b>结果：</b>${escapeHtml(extra)}</div>` : ''}`;
  syncCurrentAudioUi();
}

function parse() {
  if(linkedHost || activeVoiceJobs)return;
  const input = $('#input').value.trim();
  if (!input) { setStatus('先粘贴一段测试 Log，或直接打开工程目录。'); return; }
  if (project?.lines?.length && !confirm(`解析这份 Log 会替换当前 ${project.lines.length} 行测试工程。继续吗？`)) return;
  clearGeneratedAudio();
  const importer = registry.choose(input, { sourceName: 'log.txt' });
  if (!importer) { setStatus('没有识别出 Log 格式。', 'error'); return; }
  project = importer.parse(input, { title: 'Voice Workbench' });
  project.settings.logLanguage = $('#logLanguage').value.trim() || 'auto';
  project.settings.speechLanguage = $('#speechLanguage').value.trim() || 'auto';
  const template = BUILTIN_TEMPLATES.find(t => t.id === $('#template').value);
  if (template) applyTemplate(project, template);
  renderCharacters(); renderLineSelect();
  setStatus(`${importer.label} · ${project.characters.length} 角色 · ${project.lines.length} 行`, 'ok');
  $('#voiceInputDetails').open = false;
  compile();
}
function compile() {
  if (!project) { $('#output').textContent=''; $('#currentLineCard').hidden=true; return; }
  $('#defaultTtsProvider').value=project.settings.ttsProvider||REPLAYLAB_FREE_TTS_ID;
  $('#output').textContent = JSON.stringify(compilePerformance(project), null, 2);
  renderLinePreview();
}

// Observe authoring changes without making preview compilation mutate or save projects.
function speechSnapshot(){
  const settings=Object.fromEntries(['logLanguage','speechLanguage','ttsProvider','translationProvider','speechPauseScale','punctuationPauses'].map(key=>[key,project?.settings[key]]));
  return JSON.stringify({settings,characters:project?.characters.map(c=>({id:c.id,speech:c.speech,voice:c.voice})),lines:project?.lines.map(l=>({id:l.id,speech:l.speech,audioAssetId:l.audioAssetId,mouthCues:l.mouthCues}))});
}
function notifyHost(){
  if(!linkedHost||!project)return;
  const snapshot=speechSnapshot();if(snapshot===linkedSnapshot)return;
  linkedSnapshot=snapshot;
  const owner=project,host=linkedHost;
  clearTimeout(linkedNotifyTimer);
  linkedNotifyTimer=setTimeout(()=>host.changed(owner).catch(error=>setStatus(error.message,'error')),180);
}
function attachStudioHost(host){
  const state=host.state();if(!state.project)return;
  if(activeVoiceJobs && (project!==state.project||linkedHost!==host)){setStatus('正在生成，完成后请再从 Studio 打开当前工程。','error');return;}
  if(project!==state.project)clearGeneratedAudio();
  linkedHost=host;project=state.project;workspace=null;workspaceConflict=false;
  $('#logLanguage').value=project.settings.logLanguage||'auto';
  $('#speechLanguage').value=project.settings.speechLanguage||'auto';
  $('#studioLinkCard').hidden=false;$('#studioLinkState').textContent=`已接续：${project.title||'当前工程'}`;
  $('#voiceInputDetails').open=false;$('#voiceWorkspaceDetails').open=false;
  $('#reloadVoiceWorkspace').hidden=true;
  renderCharacters();renderLineSelect();
  const index=project.lines.findIndex(line=>line.id===state.selectedLineId);
  if(index>=0)$('#lineSelect').value=String(index);
  syncLineLanguageInput();compile();linkedSnapshot=speechSnapshot();
  void refreshWorkspaceUi();updateJobControls();
}
window.__connectReplayLabHost=attachStudioHost;
for(const event of ['input','change','click'])document.addEventListener(event,()=>queueMicrotask(notifyHost));
window.addEventListener('focus',()=>{
  if(!linkedHost||activeVoiceJobs)return;
  try{
    if(linkedHost.owner.closed)throw new Error('Studio 已关闭。本页保留了工程草稿，可导出 JSON 备份。');
    const state=linkedHost.state();
    if(state.project!==project)attachStudioHost(linkedHost);
    else{
      $('#logLanguage').value=project.settings.logLanguage||'auto';$('#speechLanguage').value=project.settings.speechLanguage||'auto';
      const selected=$('#lineSelect').value;renderCharacters();renderLineSelect();$('#lineSelect').value=selected;syncLineLanguageInput();compile();
    }
  }catch(error){setStatus(error.message,'error');}
});
$('#focusStudio').addEventListener('click',()=>{notifyHost();linkedHost?.owner.focus();});
$('#returnStudio').addEventListener('click',event=>{if(linkedHost&&!linkedHost.owner.closed){event.preventDefault();notifyHost();linkedHost.owner.focus();}});
$('#exportVoiceDraft').addEventListener('click',()=>{
  if(!project)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(project,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='project.replaylab.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  setStatus('已导出工程 JSON；音频文件请另外下载或保留工程目录。','ok');
});

$('#chooseWorkspace').addEventListener('click', chooseWorkspace);
$('#saveWorkspace').addEventListener('click', async () => {
  if(activeVoiceJobs)return;
  if(linkedHost){try{const saved=await linkedHost.changed(project,true);setStatus(saved?'工程已保存。':'已同步至 Studio 草稿，请在主窗口保存工程目录。',saved?'ok':'');}catch(error){setStatus(error.message,'error');}return;}
  if (!workspace || !project) return;
  try { await workspace.saveProject(project); await refreshWorkspaceUi(); setStatus('工程已保存。', 'ok'); }
  catch (error) { if (isWorkspaceConflictError(error)) showVoiceWorkspaceConflict(error); setStatus(`保存工程失败：${error.message || error}`, 'error'); }
});
$('#refreshWorkspace').addEventListener('click', refreshWorkspaceUi);$('#reloadVoiceWorkspace').addEventListener('click', async()=>{if(!workspace||linkedHost||activeVoiceJobs)return;if(project&&project.lines?.length&&!confirm('重新载入会用目录中的最新工程替换声音页当前设置。继续吗？'))return;try{const latest=await workspace.loadProject();if(!latest){setStatus('目录里没有 project.replaylab.json。','error');return}clearGeneratedAudio();project=latest;workspaceConflict=false;$('#reloadVoiceWorkspace').hidden=true;$('#saveWorkspace').disabled=false;$('#logLanguage').value=project.settings?.logLanguage||'auto';$('#speechLanguage').value=project.settings?.speechLanguage||'auto';renderCharacters();renderLineSelect();compile();await refreshWorkspaceUi();setStatus('已重新载入目录中的最新工程。','ok')}catch(error){setStatus(`重新载入失败：${error.message||error}`,'error')}});
$('#loadFreeModel').addEventListener('click', loadFreeModel);$('#cancelFreeModel').addEventListener('click', cancelFreeModelLoad);$('#retryFreeModel').addEventListener('click',()=>retryFreeModelDownload('auto'));$('#retryFreeModelWasm').addEventListener('click', retryFreeModelWithWasm);$('#checkFreeModelNetwork').addEventListener('click', checkFreeModelNetwork);
$('#parse').addEventListener('click', parse);
$('#fillVoiceSample').addEventListener('click',()=>{$('#input').value='Arthur: I want to inspect that door.\nFrancis: I do not think that is a good idea.\nMatthew: Let us check the floor first.';$('#input').focus()});
$('#compile').addEventListener('click', compile);
$('#template').addEventListener('change', () => {
  if (!project || linkedHost || activeVoiceJobs) return;
  const template = BUILTIN_TEMPLATES.find(t => t.id === $('#template').value);
  if (template && confirm('将所选演出模板应用到当前工程？这会改变舞台设置。')) applyTemplate(project, template);
  compile();
});
$('#speechLanguage').addEventListener('change', () => {
  if (!project) return;
  project.settings.speechLanguage = $('#speechLanguage').value.trim() || 'auto';
  renderCharacters(); renderLinePreview(); compile();
});
$('#defaultTtsProvider').addEventListener('change',()=>{
  if(!project)return;
  project.settings.ttsProvider=$('#defaultTtsProvider').value;
  renderCharacters();compile();
});
$('#checkVoicebox').addEventListener('click', async()=>{
  const state=$('#voiceboxState'), detail=$('#voiceboxDetail'); state.className='speech-status busy';state.textContent='检查中';
  try{const provider=resetVoiceboxProvider();const health=await provider.health();const voices=await provider.listVoices(project?.settings?.speechLanguage||project?.settings?.logLanguage||'auto');
    const bridge=await provider.bridgeHealth().then(row=>row.ready?'情绪桥已就绪':'情绪桥已连接，但未就绪（实验模式暂不可用）').catch(()=>'情绪桥未启动（只有实验模式需要）');
    state.className='speech-status ok';state.textContent='已连接';detail.textContent=`${voices.length} 个 Profile · 后端 ${health?.backend_type||'未知'} · 已加载模型 ${health?.model_loaded?(health.model_size||'未知'):'无'} · ${bridge}。同语言样本会优先显示；生成期间请保持 Voicebox 运行。`;if(project)renderCharacters();}
  catch(error){state.className='speech-status error';state.textContent='未连接';detail.textContent=`连接失败：${error.message||error}`;}
});
$('#voiceboxEndpoint').addEventListener('change',()=>{resetVoiceboxProvider();if(project)renderCharacters();});
$('#bridgeEndpoint').addEventListener('change', resetVoiceboxProvider);
$('#translateEndpoint').addEventListener('change', () => {
  try { localStorage.setItem('replaylab.translateEndpoint', $('#translateEndpoint').value.trim()); } catch {}
});
$('#useLibreTranslate').addEventListener('click', () => {
  if (!project) return setStatus('请先打开工程。', 'error');
  project.settings.translationProvider = 'libretranslate';
  compile();
  setStatus('工程翻译服务已设为 LibreTranslate；保存工程后保留。', 'ok');
});
$('#checkBridge').addEventListener('click', async () => {
  const state = $('#bridgeState'); state.textContent = '检查中（不会下载）…';
  try {
    const health = await resetVoiceboxProvider().bridgeHealth();
    state.textContent = health.ready ? '依赖与模型缓存就绪 · 未验证真实声纹/情绪效果' : `桥已连接，尚未就绪：${Object.entries(health.models || {}).filter(([k,v])=>k !== '0.6B-Base' && !v.cached).map(([k])=>k).join(' / ')}${health.runtime_ready ? '' : ' · 运行环境/适配器未就绪，打开状态页查看'}`;
  } catch (error) { state.textContent = `情绪桥未连接：${error.message}`; }
});
$('#openBridgeStatus').addEventListener('click', () => {
  try {
    const url = new URL($('#bridgeEndpoint').value);
    if (url.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('请选择本机地址');
    window.open(url.href, '_blank', 'noopener');
  } catch (error) { $('#bridgeState').textContent = error.message; }
});
function saveLineActing() {
  const line = currentLine(); if (!line) return;
  line.speech ??= {};
  if ($('#lineActingOverride').checked) {
    line.speech.acting = { actingPreset: $('#lineActingPreset').value, actingStrength: $('#lineActingStrength').value, instruct: $('#lineInstruct').value.trim() };
    if ($('#lineSeed').value !== '') line.speech.acting.seed = Number($('#lineSeed').value);
  } else { delete line.speech.acting; }
  invalidateCharacterAudio(line.speakerId);
  compile();
}
$('#lineActingOverride').addEventListener('change', () => { saveLineActing(); syncLineLanguageInput(); });
$('#lineInstruct').addEventListener('input', saveLineActing);
$('#lineSeed').addEventListener('input', saveLineActing);
$('#lineActingPreset').addEventListener('change', saveLineActing);
$('#lineActingStrength').addEventListener('change', saveLineActing);

$('#logLanguage').addEventListener('input', () => {
  if (!project) return;
  project.settings.logLanguage = $('#logLanguage').value.trim() || 'auto';
  renderCharacters();
  compile();
});
$('#lineSelect').addEventListener('change', () => {
  $('#lineAudioPreview').pause();
  syncLineLanguageInput();
  renderLinePreview();
});
$('#lineLanguage').addEventListener('input', () => {
  const line = currentLine();
  if (!line) return;
  line.speech ??= {};
  line.speech.languageOverride = $('#lineLanguage').value.trim() || null;
  compile();
});
$('#translateLine').addEventListener('click', async () => {
  if(activeVoiceJobs)return;
  const line = currentLine();
  if (!line) return;
  const context=captureContext(line);beginVoiceJob();
  try {
    context.assertCurrent();
    const prepared = await prepareLineSpeech(context.owner, line, { translations: buildTranslationRegistry(),assertCurrent:context.assertCurrent });
    renderLinePreview(prepared.speechText);
    compile();
    setStatus(`已准备朗读文本：${prepared.sourceLanguage} → ${prepared.targetLanguage}${prepared.accentId ? ` · ${prepared.accentId}` : ''}`, 'ok');
  } catch (error) {
    setStatus(`翻译失败：${error.message || error}`, 'error');
  } finally {endVoiceJob();}
});
$('#synthLine').addEventListener('click', async () => {
  const line = currentLine();
  if (!line) return;
  const button = $('#synthLine');
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = '生成中…';
  setLineSpeechState('生成中', 'busy');
  try {
    const { prepared, entry } = await synthesizeLine(line, { autoplay: true });
    if (prepared.audioSource === 'imported') {
      setLineSpeechState('已有绑定音频', 'ok');
      setStatus('当前句已有绑定音频，未调用 TTS。', 'ok');
    } else if (entry) {
      setLineSpeechState(prepared.audioSource === 'builtin-tts' ? '已生成 · 免费本地' : '已生成 · 外部 TTS', 'ok');
      setStatus(`当前句已生成：${prepared.targetLanguage} · ${prepared.ttsProvider}`, 'ok');
    }
    renderLinePreview(prepared.speechText);
  } catch (error) {
    if (isWorkspaceConflictError(error)) showVoiceWorkspaceConflict(error);
    const phase=error.voicePhase||'生成';
    setLineSpeechState(phase==='保存'?'保存失败 · 音频可下载':'生成失败', 'error');
    setStatus(`语音${phase}失败：${error.message || error}${phase==='保存'?'；生成结果已保留，可点击下载。':''}`, 'error');
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
});
async function currentLineAudioBlob(line) {
  const cached = cachedLineAudio(line);
  if (cached?.blob) return cached.blob;
  if (!line?.audioAssetId) return null;
  const asset = project.assets.find(item => item.id === line.audioAssetId);
  if (!asset) return null;
  return audioBlobForAsset(asset.id);
}
async function audioBlobForAsset(id) {
  const asset=project?.assets.find(item=>item.id===id);
  if(!asset)return null;
  if(linkedHost){
    const source=await linkedHost.readAudio(asset.id);
    // Blobs from the Studio window belong to another realm, so instanceof cannot recognise them.
    if(source&&typeof source.arrayBuffer==='function')return new Blob([await source.arrayBuffer()],{type:source.type});
    if(typeof source==='string'){const response=await fetch(source);if(response.ok)return await response.blob();}
  }
  if (workspace && asset.sourcePath) {
    try { return await workspace.read(asset.sourcePath); } catch {}
  }
  if (asset.uri && /^(data:|https?:|blob:)/i.test(asset.uri)) {
    try { const response=await fetch(asset.uri); if(response.ok)return await response.blob(); } catch {}
  }
  return null;
}

async function saveAudioBlob(blob, name) {
  const picker = globalThis.showSaveFilePicker;
  if (picker) {
    try {
      const ext=name.split('.').pop()||'wav';
      const handle=await picker({suggestedName:name,types:[{description:'音频文件',accept:{[blob.type||'audio/wav']:[`.${ext}`]}}]});
      const writable=await handle.createWritable();
      await writable.write(blob);await writable.close();return true;
    } catch(error) { if(error?.name==='AbortError')return false; }
  }
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;a.style.display='none';document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);return true;
}

$('#downloadLineAudio').addEventListener('click', async () => {
  const line = currentLine();
  if (!line) return;
  const button=$('#downloadLineAudio'),oldText=button.textContent;button.disabled=true;button.textContent='准备下载…';
  try{
    const blob=await currentLineAudioBlob(line);if(!blob)throw new Error('当前音频只存在引用，但声音页无法读取文件；请重新连接工程目录或重新生成。');
    const character = project.characters.find(c => c.id === line.speakerId);
    const index = project.lines.findIndex(x => x.id === line.id) + 1;
    const ext = audioExtension(blob);
    const saved=await saveAudioBlob(blob,`${String(index).padStart(4, '0')}_${character?.name || 'voice'}.${ext}`);
    if(saved)setStatus('音频下载已交给浏览器保存。','ok');
  }catch(error){setStatus(`音频下载失败：${error.message||error}`,'error')}finally{button.textContent=oldText;syncCurrentAudioUi()}
});

createVoiceReview({root:document,getProject:()=>project,audioBlob:asset=>audioBlobForAsset(asset?.id),isBusy:()=>activeVoiceJobs>0,regenerate:line=>synthesizeLine(line),onChanged(){compile();notifyHost();}});
createTranslationBridge({root:document,getProject:()=>project,fetchImpl:serviceFetch,getEndpoint:()=>$('#voiceboxEndpoint').value.trim()||'http://127.0.0.1:17493',onApplied(speakers){speakers.forEach(invalidateCharacterAudio);$('#speechLanguage').value=project.settings.speechLanguage;renderCharacters();renderLinePreview();compile();}});
prosodyEditor=createProsodyEditor({
  context(){
    const line=currentLine();if(!project||!line||line.type==='command')return null;
    const policy=resolveSpeechPolicy(project,line),asset=project.assets.find(a=>a.id===line.audioAssetId);
    return {project,line,fingerprint:speechInputFingerprint(project,line)+connectionFingerprint(),sourceRevision:asset?.metadata?.contentRevision,
      canReenact:policy.ttsProvider===VOICEBOX_LOCAL_TTS_ID&&policy.voice.mode==='experimental-clone-instruct'&&policy.voice.modelSize==='1.7B',
      spokenText:resolveCachedSpeech(project,line).text};
  },
  audio:currentLineAudioBlob,assetAudio:audioBlobForAsset,
  versions(){const line=currentLine();return project?.assets.filter(a=>a.kind==='voice'&&a.id!==line?.audioAssetId&&(a.metadata?.generatedLineId===line?.id||project.assets.some(b=>b.metadata?.generatedLineId===line?.id&&b.metadata?.audioEdit?.sourceAssetId===a.id))).map(a=>({id:a.id,label:`已保存：${a.name} · ${a.metadata?.updatedAt?.slice(11,19)||'原素材'}`}))||[];},
  isBusy:()=>activeVoiceJobs>0,
  changed:()=>notifyHost(),download:saveAudioBlob,
  async generate(line,curve,assertCurrent,signal){
    if(activeVoiceJobs)throw new Error('已有声音任务在运行。');
    const context=captureContext(line);beginVoiceJob();
    try{return await prepareLineSpeech(context.owner,line,{prosodyReenactment:curve,signal,
      translations:buildTranslationRegistry(),tts:ttsRegistry,translate:true,synthesize:true,
      assertCurrent(){context.assertCurrent();assertCurrent();signal.throwIfAborted();}});
    }finally{endVoiceJob();}
  },
  async adopt(line,take){
    if(!linkedHost&&!workspace)throw new Error('请先连接工程文件夹再采用；当前候选可以先下载保存。');
    const context=captureContext(line);context.assertCurrent();
    const policy=resolveSpeechPolicy(context.owner,line),bound=context.owner.assets.find(a=>a.id===line.audioAssetId);
    const cached=resolveCachedSpeech(context.owner,line);
    const prepared={...take.prepared,inputFingerprint:speechInputFingerprint(context.owner,line),displayText:line.text,
      speechText:take.prepared?.speechText||cached.text,sourceLanguage:policy.sourceLanguage,targetLanguage:policy.targetLanguage,
      ttsProvider:take.prepared?.ttsProvider||'local-pitch-edit',translated:!!take.prepared?.translated,audioSource:'external-tts',
      audioEdit:{kind:take.kind||'restore',curve:take.curve,sourceAssetId:line.audioAssetId??null,sourceRevision:bound?.metadata?.contentRevision,
        resetMouthTiming:take.kind==='pitch-curve' && take.inputAssetId!==(line.audioAssetId??null)},
      ttsResult:{audio:take.blob,mime:take.blob.type||'audio/wav',duration:take.duration}};
    beginVoiceJob();
    try{await persistPreparedLineAudio(line,prepared);storeGeneratedLineAudio(line,prepared);renderLinePreview();notifyHost();}
    finally{endVoiceJob();}
  }
});
renderCharacters();
renderLineSelect();
compile();
window.__replayLabMarkBootReady?.();
try{window.opener?.postMessage({type:'replaylab:voice-ready'},location.origin);}catch{}
