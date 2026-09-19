import { WorkerReplayLabFreeTtsProvider } from './worker-tts-provider.js';
import { VoiceboxLocalTtsProvider, VOICEBOX_LOCAL_TTS_ID } from './voicebox-local-provider.js';
import {
  createDefaultImporterRegistry,
  compilePerformance,
  BUILTIN_TEMPLATES,
  applyTemplate,
  resolveSpeechPolicy,
  prepareLineSpeech,
  prepareProjectSpeech,
  TranslationRegistry,
  LibreTranslateProvider,
  searchAccents,
  getAccentProfile,
  resolveCharacterAccent,
  accentSynthesisHint,
  REPLAYLAB_FREE_TTS_ID,
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
let workspaceConflict = false;
let freeModelReady = false;
let freeModelLoading = false;
let freeModelPromise = null;
let activeVoiceJobs = 0;
let lastModelProgress = null;
const freeVoiceCache = new Map();
const generatedAudio = new Map(); // lineId -> { blob, url, fingerprint, prepared }

async function refreshWorkspaceUi() {
  const state = $('#workspaceState');
  const detail = $('#workspaceDetail');
  if (workspaceConflict) return;
  if (!workspace) {
    state.className = 'speech-status'; state.textContent = '未连接';
    $('#saveWorkspace').disabled = true; $('#refreshWorkspace').disabled = true;
    detail.textContent = 'Chrome / Edge 可直接写本地目录；其他浏览器暂时使用导出包。';
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
  const previous = workspace;
  try {
    const next = await BrowserFileSystemWorkspace.choose();
    const existing = await next.loadProject();
    if (existing && project?.lines?.length && !confirm(`所选目录已有工程「${existing.title || '未命名 Replay'}」。打开它会替换当前声音页中的测试工程。继续吗？`)) return;
    workspace = next; workspaceConflict = false; $('#reloadVoiceWorkspace').hidden = true;
    if (existing) {
      project = existing;
      $('#logLanguage').value = project.settings?.logLanguage || 'auto';
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
    if (error?.name === 'AbortError') return;
    setStatus(`工程目录连接失败：${error.message || error}`, 'error');
  }
}
async function persistPreparedLineAudio(line, prepared) {
  if (!workspace || !prepared?.ttsResult) return null;
  const result = await persistGeneratedSpeech(workspace, project, line, prepared);
  await refreshWorkspaceUi();
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
const voiceboxProvider = new VoiceboxLocalTtsProvider();
const ttsRegistry = new TtsRegistry().register(freeProvider).register(voiceboxProvider);
let voiceboxVoices = [];


function freeProviderSupportsLanguage(language) {
  if (!language || language === 'auto') return true;
  const supported = freeProvider?.capabilities?.supportedLanguages || [];
  return supported.some(item => item.toLowerCase() === language.toLowerCase());
}

async function refreshVoicebox({ quiet = false } = {}) {
  const state = $('#voiceboxState');
  const detail = $('#voiceboxDetail');
  try {
    state.className = 'speech-status busy';
    state.textContent = '检测中';
    const [health, voices] = await Promise.all([voiceboxProvider.health(), voiceboxProvider.listVoices()]);
    voiceboxVoices = voices;
    state.className = 'speech-status ok';
    state.textContent = '已连接';
    const backend = health?.backend || health?.device || health?.status || 'ready';
    detail.textContent = `Voicebox 已连接 · ${voices.length} 个 Profile · ${backend}。Replay Lab 通过本地启动器 bridge 访问，不受浏览器 CORS 影响。`;
    return voices;
  } catch (error) {
    voiceboxVoices = [];
    state.className = 'speech-status error';
    state.textContent = '未连接';
    detail.textContent = `无法连接 Voicebox：${error.message || error} 请确认 Voicebox 正在运行，并使用新版 START_REPLAY_LAB 启动器打开 Replay Lab。`;
    if (!quiet) setStatus(`Voicebox Local：${error.message || error}`, 'error');
    return [];
  }
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
  const accents = character.speech?.accents ?? {};
  return accents[language] ?? Object.entries(accents).find(([key]) => languageBase(key) === languageBase(language))?.[1] ?? null;
}
function ensureAccentSelection(character, language) {
  character.speech ??= { voices: {}, accents: {} };
  character.speech.accents ??= {};
  return character.speech.accents[language] ??= { accentId: null, query: '', strength: 'natural', useRegionalVocabulary: false };
}
function escapeHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
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
  for (const entry of generatedAudio.values()) revokeCacheEntry(entry);
  generatedAudio.clear();
  syncCurrentAudioUi();
}
function lineFingerprint(line) {
  if (!project || !line) return '';
  const policy = resolveSpeechPolicy(project, line);
  return JSON.stringify({
    text: line.text,
    audioAssetId: line.audioAssetId || null,
    language: policy.targetLanguage,
    provider: policy.ttsProvider || REPLAYLAB_FREE_TTS_ID,
    voice: policy.voice,
    accentId: policy.accent?.profile?.id || policy.accent?.selection?.query || null,
    accentStrength: policy.accent?.strength || null,
    speechOverride: line.speech?.textOverride || null,
    translation: line.speech?.translationCache?.text || null,
    translationStyle: line.speech?.translationCache?.styleKey || null
  });
}
function cachedLineAudio(line) {
  const entry = line ? generatedAudio.get(line.id) : null;
  if (!entry) return null;
  if (entry.fingerprint !== lineFingerprint(line)) {
    revokeCacheEntry(entry);
    generatedAudio.delete(line.id);
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
  for (const line of project?.lines ?? []) {
    if (line.speakerId !== characterId) continue;
    const entry = generatedAudio.get(line.id);
    if (entry) revokeCacheEntry(entry);
    generatedAudio.delete(line.id);
  }
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
function beginVoiceJob(){ activeVoiceJobs += 1; }
function endVoiceJob(){ activeVoiceJobs = Math.max(0, activeVoiceJobs - 1); }
window.addEventListener('beforeunload', event => {
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
      setStatus(`免费声音加载失败：${error.message || error}。可以改用可选的 Voicebox Local；模型由 Voicebox 自己管理。`, 'error');
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
    translations.register(new LibreTranslateProvider({ endpoint }));
    project.settings.translationProvider = 'libretranslate';
  }
  return translations;
}

async function synthesizeLine(line, { autoplay = false } = {}) {
  if (!line) throw new Error('没有选中的台词。');
  beginVoiceJob();
  try {
  const policy = resolveSpeechPolicy(project, line);
  if ((policy.ttsProvider || REPLAYLAB_FREE_TTS_ID) === REPLAYLAB_FREE_TTS_ID && !freeProviderSupportsLanguage(policy.targetLanguage)) {
    throw new Error(`当前内置免费引擎尚未覆盖 ${policy.targetLanguage}。请为这个语言槽绑定其他本地/外部 TTS。`);
  }
  if ((policy.ttsProvider || REPLAYLAB_FREE_TTS_ID) === REPLAYLAB_FREE_TTS_ID && !freeModelReady) {
    const ok = await loadFreeModel();
    if (!ok) throw new Error('Replay Lab Free 模型未能加载。');
  }
  const prepared = await prepareLineSpeech(project, line, {
    translations: buildTranslationRegistry(),
    tts: ttsRegistry,
    translate: true,
    synthesize: true,
    regenerateGeneratedAudio: true
  });
  if (prepared.audioSource === 'imported') return { prepared, entry: null };
  await persistPreparedLineAudio(line, prepared);
  const entry = storeGeneratedLineAudio(line, prepared);
  if (autoplay && entry) {
    const audio = $('#lineAudioPreview');
    audio.src = entry.url;
    audio.style.display = 'block';
    await audio.play().catch(() => {});
  }
  return { prepared, entry };
  } finally { endVoiceJob(); }
}

async function batchSynthesizeCharacter(character, progressEl, button) {
  const lines = project.lines.filter(line => line.speakerId === character.id);
  if (!lines.length) return;
  const language = character.speech?.defaultLanguage || project.settings.logLanguage || 'auto';
  const preset = character.speech?.voices?.[language] ?? Object.entries(character.speech?.voices ?? {}).find(([key]) => languageBase(key) === languageBase(language))?.[1] ?? {};
  const providerId = preset.provider || character.speech?.ttsProvider || project.settings.ttsProvider || REPLAYLAB_FREE_TTS_ID;
  if (providerId === REPLAYLAB_FREE_TTS_ID && !freeProviderSupportsLanguage(language)) {
    progressEl.className = 'speech-status error';
    progressEl.textContent = `免费引擎未覆盖 ${language}`;
    setStatus(`${character.name}：当前内置免费引擎尚未覆盖 ${language}，请绑定其他本地/外部 TTS。`, 'error');
    return;
  }
  if (providerId === REPLAYLAB_FREE_TTS_ID && !(await loadFreeModel())) return;

  const oldText = button.textContent;
  beginVoiceJob();
  button.disabled = true;
  button.textContent = '生成中…';
  progressEl.className = 'speech-status busy';
  progressEl.textContent = `0 / ${lines.length}`;
  try {
    const results = await prepareProjectSpeech(project, {
      translations: buildTranslationRegistry(),
      tts: ttsRegistry,
      translate: true,
      synthesize: true,
      regenerateGeneratedAudio: true,
      concurrency: providerId === REPLAYLAB_FREE_TTS_ID ? 1 : 2,
      include: line => line.speakerId === character.id,
      onProgress(completed, total, line, result) {
        progressEl.textContent = `${completed} / ${total}`;
      }
    });
    if (workspace) {
      for (let i = 0; i < results.length; i++) {
        if (results[i]?.ttsResult && lines[i]) await persistPreparedLineAudio(lines[i], results[i]);
      }
    }
    results.forEach((result, index) => { if (result.ttsResult && lines[index]) storeGeneratedLineAudio(lines[index], result); });
    const generated = results.filter(result => result.ttsResult).length;
    const imported = results.filter(result => result.audioSource === 'imported').length;
    progressEl.className = 'speech-status ok';
    progressEl.textContent = `完成 ${generated}${imported ? ` · 已有音频 ${imported}` : ''}`;
    setStatus(`${character.name}：已准备 ${results.length} 句语音。`, 'ok');
    syncCurrentAudioUi();
  } catch (error) {
    if (isWorkspaceConflictError(error)) showVoiceWorkspaceConflict(error);
    progressEl.className = 'speech-status error';
    progressEl.textContent = '失败';
    setStatus(`${character.name} 批量生成失败：${error.message || error}`, 'error');
  } finally {
    endVoiceJob();
    button.disabled = false;
    button.textContent = oldText;
  }
}

function renderCharacters() {
  const host = $('#characters');
  host.innerHTML = '';
  if (!(project?.characters?.length)) { host.innerHTML = '<div class="voice-empty">先打开工程目录，或在上方导入一份 Log。</div>'; return; }
  for (const character of project?.characters ?? []) {
    character.speech ??= { defaultLanguage: null, voices: {}, accents: {} };
    character.speech.voices ??= {};
    character.speech.accents ??= {};

    const card = document.createElement('div');
    card.className = 'character-card stack';
    const head = document.createElement('div');
    head.className = 'character-head';
    head.innerHTML = `<strong>${escapeHtml(character.name)}</strong><span class="muted">语言与声音</span>`;

    const langRow = document.createElement('div');
    langRow.className = 'field-grid';
    const langLabel = document.createElement('label');
    langLabel.innerHTML = '<span>默认语言</span><small>留空 = Log 语言</small>';
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
    const currentLanguage = () => langInput.value.trim() || project.settings.logLanguage || 'auto';
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
    voiceTitle.innerHTML = '<strong>声音</strong><div class="voice-note">默认使用 Replay Lab Free。本地免费声音可直接列出和试听；指定角色声线时再切外部 TTS。</div>';
    const voiceControls = document.createElement('div');
    voiceControls.className = 'voice-controls';

    const sourceWrap = document.createElement('label');
    sourceWrap.innerHTML = '<span>声音来源</span><small>免费优先</small>';
    const sourceSelect = document.createElement('select');
    sourceSelect.innerHTML = '<option value="free">Replay Lab Free（浏览器）</option><option value="voicebox">Voicebox Local（可选）</option><option value="external">自定义 / 外部 TTS</option>';
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
    voiceboxVoiceWrap.innerHTML = '<span>Voicebox Profile</span><small>来自已运行的 Voicebox</small>';
    const voiceboxVoiceSelect = document.createElement('select');
    voiceboxVoiceSelect.innerHTML = '<option value="">先检测 Voicebox</option>';
    voiceboxVoiceWrap.append(voiceboxVoiceSelect);

    const externalVoiceWrap = document.createElement('label');
    externalVoiceWrap.innerHTML = '<span>Voice ID</span><small>由用户自己的 Provider 提供</small>';
    const externalVoiceInput = document.createElement('input');
    externalVoiceInput.placeholder = '例如 arthur-v3';
    externalVoiceWrap.append(externalVoiceInput);

    voiceControls.append(sourceWrap, providerWrap, freeVoiceWrap, voiceboxVoiceWrap, externalVoiceWrap);

    const previewRow = document.createElement('div');
    previewRow.className = 'voice-action-row';
    const previewButton = document.createElement('button');
    previewButton.textContent = '试听当前免费 Voice';
    const loadVoicesButton = document.createElement('button');
    loadVoicesButton.textContent = '加载免费 Voice 列表';
    const loadVoiceboxButton = document.createElement('button');
    loadVoiceboxButton.textContent = '刷新 Voicebox Profile';
    const batchButton = document.createElement('button');
    batchButton.className = 'primary';
    batchButton.textContent = '一键生成该角色语音';
    const batchState = document.createElement('span');
    batchState.className = 'speech-status';
    batchState.textContent = '未生成';
    previewRow.append(loadVoicesButton, loadVoiceboxButton, previewButton, batchButton, batchState);
    const previewAudio = document.createElement('audio');
    previewAudio.className = 'audio-player';
    previewAudio.controls = true;
    previewAudio.style.display = 'none';

    const priority = document.createElement('div');
    priority.className = 'voice-note';
    priority.textContent = '优先级：本句导入音频 > 角色绑定的 Voicebox / 外部 TTS > Replay Lab Free。Voicebox 必须单独安装运行；Replay Lab 不内置它的模型。';
    voiceArea.append(voiceTitle, voiceControls, previewRow, previewAudio, priority);
    const accentDisclosure = document.createElement('details');
    const accentSummary = document.createElement('summary');
    accentSummary.textContent = '口音 / 地区（可选）';
    accentDisclosure.append(accentSummary, accentArea);
    card.append(head, langRow, pauseRow, voiceArea, accentDisclosure);
    host.append(card);

    const getPreset = () => {
      const language = currentLanguage();
      return character.speech.voices?.[language]
        ?? Object.entries(character.speech.voices ?? {}).find(([key]) => languageBase(key) === languageBase(language))?.[1]
        ?? {};
    };

    const populateFreeVoices = async () => {
      const language = currentLanguage();
      const preset = getPreset();
      freeVoiceSelect.innerHTML = '<option value="">自动选择</option>';
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
        for (const voice of voices) {
          const option = document.createElement('option');
          option.value = voice.id;
          const suffix = [voice.gender, voice.quality, ...(voice.tags || [])].filter(Boolean).join(' · ');
          option.textContent = `${voice.label}${suffix ? ` · ${suffix}` : ''}`;
          freeVoiceSelect.append(option);
        }
        freeVoiceSelect.value = preset.voiceId || '';
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
      const language = currentLanguage();
      const preset = getPreset();
      const voices = await voiceboxProvider.listVoices(language).catch(async () => { await refreshVoicebox({ quiet: true }); return voiceboxVoices; });
      voiceboxVoices = voices || [];
      voiceboxVoiceSelect.innerHTML = '<option value="">选择 Voicebox Profile</option>';
      for (const voice of voiceboxVoices) {
        const option = document.createElement('option');
        option.value = voice.id;
        option.textContent = `${voice.label}${voice.tags?.length ? ` · ${voice.tags.join(' · ')}` : ''}`;
        voiceboxVoiceSelect.append(option);
      }
      voiceboxVoiceSelect.value = preset.voiceId || '';
      if (!voiceboxVoices.length) voiceboxVoiceSelect.innerHTML = '<option value="">没有读取到 Voicebox Profile</option>';
    };

    const syncVoiceControls = async () => {
      const preset = getPreset();
      const isVoicebox = preset.provider === VOICEBOX_LOCAL_TTS_ID;
      const external = !!preset.provider && preset.provider !== REPLAYLAB_FREE_TTS_ID && !isVoicebox;
      sourceSelect.value = isVoicebox ? 'voicebox' : external ? 'external' : 'free';
      providerInput.value = external ? (preset.provider || '') : '';
      externalVoiceInput.value = external ? (preset.voiceId || '') : '';
      providerWrap.style.display = external ? 'grid' : 'none';
      externalVoiceWrap.style.display = external ? 'grid' : 'none';
      freeVoiceWrap.style.display = (!external && !isVoicebox) ? 'grid' : 'none';
      voiceboxVoiceWrap.style.display = isVoicebox ? 'grid' : 'none';
      loadVoicesButton.style.display = (!external && !isVoicebox) ? 'inline-block' : 'none';
      loadVoiceboxButton.style.display = isVoicebox ? 'inline-block' : 'none';
      previewButton.style.display = (!external && !isVoicebox) ? 'inline-block' : 'none';
      if (isVoicebox) await populateVoiceboxVoices();
      else if (!external) await populateFreeVoices();
    };

    const saveVoiceControls = () => {
      const language = currentLanguage();
      if (!language || language === 'auto') return;
      character.speech.voices ??= {};
      const preset = character.speech.voices[language] ??= {};
      if (sourceSelect.value === 'external') {
        preset.provider = providerInput.value.trim() || 'external';
        preset.voiceId = externalVoiceInput.value.trim() || undefined;
      } else if (sourceSelect.value === 'voicebox') {
        preset.provider = VOICEBOX_LOCAL_TTS_ID;
        preset.voiceId = voiceboxVoiceSelect.value || undefined;
      } else {
        delete preset.provider;
        preset.voiceId = freeVoiceSelect.value || undefined;
      }
      invalidateCharacterAudio(character.id);
      compile();
      renderLinePreview();
    };

    sourceSelect.addEventListener('change', async () => {
      if (sourceSelect.value === 'external') providerInput.focus();
      if (sourceSelect.value === 'voicebox' && !voiceboxVoices.length) await refreshVoicebox({ quiet: true });
      saveVoiceControls();
      await syncVoiceControls();
    });
    providerInput.addEventListener('input', saveVoiceControls);
    externalVoiceInput.addEventListener('input', saveVoiceControls);
    freeVoiceSelect.addEventListener('change', saveVoiceControls);
    voiceboxVoiceSelect.addEventListener('change', saveVoiceControls);
    loadVoicesButton.addEventListener('click', async () => {
      if (await loadFreeModel()) {
        await populateFreeVoices();
        setStatus(`${character.name}：已列出 ${currentLanguage()} 免费 Voice。`, 'ok');
      }
    });
    loadVoiceboxButton.addEventListener('click', async () => {
      await refreshVoicebox({ quiet: true });
      await populateVoiceboxVoices();
      setStatus(`${character.name}：已刷新 Voicebox Profile。`, voiceboxVoices.length ? 'ok' : 'error');
    });
    previewButton.addEventListener('click', () => previewFreeVoice(character, currentLanguage(), freeVoiceSelect.value, previewAudio, previewButton));
    batchButton.addEventListener('click', () => batchSynthesizeCharacter(character, batchState, batchButton));

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
}
function syncCurrentAudioUi() {
  const line = currentLine();
  const entry = cachedLineAudio(line);
  const audio = $('#lineAudioPreview');
  const download = $('#downloadLineAudio');
  if (line?.audioAssetId && entry) {
    const asset = project.assets.find(a => a.id === line.audioAssetId);
    setLineSpeechState(asset?.metadata?.generated ? '已生成 · 已落盘' : '已有绑定音频', 'ok');
    download.disabled = false;
    audio.src = entry.url;
    audio.style.display = 'block';
    return;
  }
  if (line?.audioAssetId) {
    const asset = project.assets.find(a => a.id === line.audioAssetId);
    setLineSpeechState(asset?.metadata?.generated ? '已有生成素材' : '已有绑定音频', 'ok');
    download.disabled = !(asset && ((workspace && asset.sourcePath) || (asset.uri && /^(data:|https?:|blob:)/i.test(asset.uri))));
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
  setLineSpeechState(entry.prepared.audioSource === 'builtin-tts' ? '已生成 · 免费本地' : entry.prepared.ttsProvider === VOICEBOX_LOCAL_TTS_ID ? '已生成 · Voicebox Local' : '已生成 · 外部 TTS', 'ok');
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
    <div><b>朗读文字：</b>${escapeHtml(perf.speechText)}</div>${extra ? `<div><b>结果：</b>${escapeHtml(extra)}</div>` : ''}`;
  syncCurrentAudioUi();
}

function parse() {
  const input = $('#input').value.trim();
  if (!input) { setStatus('先粘贴一段测试 Log，或直接打开工程目录。'); return; }
  if (project?.lines?.length && !confirm(`解析这份 Log 会替换当前 ${project.lines.length} 行测试工程。继续吗？`)) return;
  clearGeneratedAudio();
  const importer = registry.choose(input, { sourceName: 'log.txt' });
  if (!importer) { setStatus('没有识别出 Log 格式。', 'error'); return; }
  project = importer.parse(input, { title: 'Voice Workbench' });
  project.settings.logLanguage = $('#logLanguage').value.trim() || 'auto';
  const template = BUILTIN_TEMPLATES.find(t => t.id === $('#template').value);
  if (template) applyTemplate(project, template);
  renderCharacters(); renderLineSelect();
  setStatus(`${importer.label} · ${project.characters.length} 角色 · ${project.lines.length} 行`, 'ok');
  $('#voiceInputDetails').open = false;
  compile();
}
function compile() {
  if (!project) { $('#output').textContent=''; $('#currentLineCard').hidden=true; return; }
  project.settings.logLanguage = $('#logLanguage').value.trim() || 'auto';
  const template = BUILTIN_TEMPLATES.find(t => t.id === $('#template').value);
  if (template) applyTemplate(project, template);
  $('#output').textContent = JSON.stringify(compilePerformance(project), null, 2);
  renderLinePreview();
}

$('#chooseWorkspace').addEventListener('click', chooseWorkspace);
$('#saveWorkspace').addEventListener('click', async () => {
  if (!workspace || !project) return;
  try { await workspace.saveProject(project); await refreshWorkspaceUi(); setStatus('工程已保存。', 'ok'); }
  catch (error) { if (isWorkspaceConflictError(error)) showVoiceWorkspaceConflict(error); setStatus(`保存工程失败：${error.message || error}`, 'error'); }
});
$('#refreshWorkspace').addEventListener('click', refreshWorkspaceUi);$('#reloadVoiceWorkspace').addEventListener('click', async()=>{if(!workspace)return;if(project&&project.lines?.length&&!confirm('重新载入会用目录中的最新工程替换声音页当前设置。继续吗？'))return;try{const latest=await workspace.loadProject();if(!latest){setStatus('目录里没有 project.replaylab.json。','error');return}project=latest;workspaceConflict=false;$('#reloadVoiceWorkspace').hidden=true;$('#saveWorkspace').disabled=false;$('#logLanguage').value=project.settings?.logLanguage||'auto';renderCharacters();renderLineSelect();compile();await refreshWorkspaceUi();setStatus('已重新载入目录中的最新工程。','ok')}catch(error){setStatus(`重新载入失败：${error.message||error}`,'error')}});
$('#testVoicebox').addEventListener('click', () => refreshVoicebox());
$('#loadFreeModel').addEventListener('click', loadFreeModel);$('#cancelFreeModel').addEventListener('click', cancelFreeModelLoad);$('#retryFreeModel').addEventListener('click',()=>retryFreeModelDownload('auto'));$('#retryFreeModelWasm').addEventListener('click', retryFreeModelWithWasm);$('#checkFreeModelNetwork').addEventListener('click', checkFreeModelNetwork);
$('#parse').addEventListener('click', parse);
$('#fillVoiceSample').addEventListener('click',()=>{$('#input').value='Arthur: I want to inspect that door.\nFrancis: I do not think that is a good idea.\nMatthew: Let us check the floor first.';$('#input').focus()});
$('#compile').addEventListener('click', compile);
$('#template').addEventListener('change', compile);
$('#logLanguage').addEventListener('input', () => {
  if (!project) return;
  project.settings.logLanguage = $('#logLanguage').value.trim() || 'auto';
  clearGeneratedAudio();
  renderCharacters();
  compile();
});
$('#lineSelect').addEventListener('change', () => {
  syncLineLanguageInput();
  renderLinePreview();
});
$('#lineLanguage').addEventListener('input', () => {
  const line = currentLine();
  if (!line) return;
  line.speech ??= {};
  const old = generatedAudio.get(line.id);
  if (old) revokeCacheEntry(old);
  generatedAudio.delete(line.id);
  line.speech.languageOverride = $('#lineLanguage').value.trim() || null;
  compile();
});
$('#translateLine').addEventListener('click', async () => {
  const line = currentLine();
  if (!line) return;
  try {
    const prepared = await prepareLineSpeech(project, line, { translations: buildTranslationRegistry() });
    renderLinePreview(prepared.speechText);
    compile();
    setStatus(`已准备朗读文本：${prepared.sourceLanguage} → ${prepared.targetLanguage}${prepared.accentId ? ` · ${prepared.accentId}` : ''}`, 'ok');
  } catch (error) {
    setStatus(`翻译失败：${error.message || error}`, 'error');
  }
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
      setLineSpeechState(prepared.audioSource === 'builtin-tts' ? '已生成 · 免费本地' : prepared.ttsProvider === VOICEBOX_LOCAL_TTS_ID ? '已生成 · Voicebox Local' : '已生成 · 外部 TTS', 'ok');
      setStatus(`当前句已生成：${prepared.targetLanguage} · ${prepared.ttsProvider}`, 'ok');
    }
    renderLinePreview(prepared.speechText);
  } catch (error) {
    if (isWorkspaceConflictError(error)) showVoiceWorkspaceConflict(error);
    setLineSpeechState('生成失败', 'error');
    setStatus(`语音生成失败：${error.message || error}`, 'error');
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

renderCharacters();
renderLineSelect();
compile();
window.__replayLabMarkBootReady?.();
