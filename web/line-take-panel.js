import {
  archiveActiveTake,
  activateVoiceTake,
  listVoiceTakes,
  persistGeneratedSpeech,
  prepareLineSpeech,
  normalizeProsodyCurve,
  prosodyOffsetAt,
  prosodyIsFlat,
  assertProsodyReenactment,
  speechInputFingerprint,
  resolveCachedSpeech,
  resolveSpeechPolicy,
  splitSpeechSegments,
  stripTextTags,
  TtsRegistry,
  VoiceboxLocalTtsProvider
} from '../dist/index.js';
import { serviceFetch } from './desktop-client.js';
import { decodeRecording, fineTuneRecording } from './prosody-audio.js';

const endpoint = (key, fallback) => { try { return localStorage.getItem(`replaylab.${key}`) || fallback; } catch { return fallback; } };
const registry = () => new TtsRegistry().register(new VoiceboxLocalTtsProvider({
  baseUrl: endpoint('voiceboxEndpoint', 'http://127.0.0.1:17493'),
  bridgeUrl: endpoint('bridgeEndpoint', 'http://127.0.0.1:17494'),
  fetchImpl: serviceFetch
}));

// Re-rolls run one at a time (the bridge and Voicebox both serialise work); others wait in line.
const queue = [];
let runningLineId = null;
const messages = new Map();
const notices = new Map();
const listeners = new Set();
const emit = () => { for (const listener of listeners) { try { listener(); } catch {} } };
export function onVoiceQueueChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
/** 'ok' or 'error' once a queued line finishes, until the author opens that line. */
export function voiceNotice(lineId) { return notices.get(lineId); }
export function clearVoiceNotice(lineId) { if (notices.delete(lineId)) emit(); }
const queuedIndex = lineId => queue.findIndex(job => job.line.id === lineId);

async function pump() {
  if (runningLineId) return;
  const job = queue.shift();
  if (!job) return;
  runningLineId = job.line.id;
  emit();
  job.onChanged(false);
  try {
    await job.run();
    messages.set(job.line.id, { text: '已生成新版本，旧版本已存档', kind: 'ok' });
    notices.set(job.line.id, 'ok');
  } catch (error) {
    messages.set(job.line.id, { text: `生成失败：${error?.message || error}`, kind: 'error' });
    notices.set(job.line.id, 'error');
  } finally {
    runningLineId = null;
    job.onChanged(true);
    emit();
    void pump();
  }
}
let objectUrl = null;

/** Single-line take controls inside the Studio workbench: re-roll, listen, choose, and set this line's BGM. */
const voiceboxUrl = () => endpoint('voiceboxEndpoint', 'http://127.0.0.1:17493');
async function voiceboxJson(path, options) {
  const response = await serviceFetch(`${voiceboxUrl()}${path}`, options);
  if (!response.ok) throw new Error(`Voicebox 返回 HTTP ${response.status}`);
  return response.json();
}

/** Bridge samples must be 3–60 s PCM WAV, and long references made a voice stop early, so keep 30 s at most. */
async function toReferenceWav(file, minSeconds = 3) {
  const context = new AudioContext({ sampleRate: 24000 });
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration < minSeconds) throw new Error(`录音太短，至少需要 ${minSeconds} 秒。`);
    const frames = Math.min(decoded.length, 30 * 24000), pcm = new Int16Array(frames);
    for (let i = 0; i < frames; i += 1) {
      let mixed = 0;
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) mixed += decoded.getChannelData(channel)[i];
      pcm[i] = Math.max(-1, Math.min(1, mixed / decoded.numberOfChannels)) * 32767;
    }
    const buffer = new ArrayBuffer(44 + pcm.byteLength), view = new DataView(buffer);
    const text = (at, value) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, 36 + pcm.byteLength, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 24000, true); view.setUint32(28, 48000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, pcm.byteLength, true);
    new Int16Array(buffer, 44).set(pcm);
    return new File([buffer], 'reference.wav', { type: 'audio/wav' });
  } finally { void context.close(); }
}

async function createVoiceFromFile(file, name) {
  const wav = await toReferenceWav(file);
  const speech = new FormData();
  speech.append('file', wav); speech.append('language', 'ja');
  const transcript = await voiceboxJson('/transcribe', { method: 'POST', body: speech }).catch(() => ({ text: '' }));
  const profile = await voiceboxJson('/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, language: 'ja' }) });
  const sample = new FormData();
  sample.append('file', wav); sample.append('reference_text', transcript.text?.trim() || 'こんにちは。');
  await voiceboxJson(`/profiles/${profile.id}/samples`, { method: 'POST', body: sample });
  return profile.id;
}

const makeOption = (text, value) => Object.assign(document.createElement('option'), { textContent: text, value });

function renderVoiceChoice(card, { element, line, character, show, onEdit, rerender, project, resolveAsset, active }) {
  if (!character) return;
  const variants = character.speech?.voiceVariants ?? [];
  const row = element('div', { className: 'row' });
  const label = element('label', { textContent: '这句用哪个声音 ' });
  const select = element('select');
  select.dataset.lineVoice = '1';
  const current = line.speech?.voice?.voiceId || '';
  select.append(makeOption('默认声音', ''), ...variants.map(item => makeOption(item.label, item.voiceId)));
  if (current && !variants.some(item => item.voiceId === current)) select.append(makeOption('已移除的声音', current));
  select.value = current;
  select.onchange = () => {
    line.speech ??= {};
    if (select.value) line.speech.voice = { ...line.speech.voice, voiceId: select.value };
    else if (line.speech.voice) { delete line.speech.voice.voiceId; if (!Object.keys(line.speech.voice).length) delete line.speech.voice; }
    onEdit('修改本句声音');
    show('下次重 roll 时使用这个声音', 'ok');
  };
  label.append(select);
  row.append(label);
  card.append(row);
  // 参考句: this line's current take becomes a voice other lines can copy the delivery of.
  const reference = element('div', { className: 'row' });
  const saveRef = element('button', { className: 'small', textContent: '把这句当前版本存成参考声音', disabled: !active });
  saveRef.dataset.saveReference = '1';
  saveRef.title = '普通克隆会模仿参考录音的语气和语调：把一句念对了的版本存起来，别的句子选它就会照着这个感觉念。';
  saveRef.onclick = async () => {
    saveRef.disabled = true; show('正在存成参考声音…', 'warn');
    try {
      const made = await createReferenceVoice({ project, line, character, resolveAsset, active });
      const list = character.speech?.voiceVariants ?? [];
      character.speech = { ...character.speech, voiceVariants: [...list.filter(item => item.voiceId !== made.voiceId), made] };
      onEdit('添加参考声音');
      show(`已添加「${made.label}」，在上面的「这句用哪个声音」里就能选；也可以在管理里设为默认`, 'ok');
      rerender();
    } catch (error) { show(`存参考声音失败：${error?.message || error}`, 'error'); saveRef.disabled = false; }
  };
  reference.append(saveRef, element('small', { className: 'muted', textContent: '参考声音配「普通克隆」效果最好；情绪桥只借音色，且要求参考录音 3 秒以上。' }));
  card.append(reference);

  const setLineVoiceField = (key, value) => {
    line.speech ??= {};
    if (value) line.speech.voice = { ...line.speech.voice, [key]: value };
    else if (line.speech.voice) { delete line.speech.voice[key]; if (!Object.keys(line.speech.voice).length) delete line.speech.voice; }
    onEdit('修改本句生成方式');
    show('下次重 roll 时生效', 'ok');
  };
  const characterVoices = Object.values(character.speech?.voices ?? {});
  const characterMode = characterVoices[0]?.mode || 'stable-clone';
  const MODES = [['auto', '自动（有情绪标记才用情绪桥）'], ['experimental-clone-instruct', '情绪桥（听提示词）'], ['stable-clone', '普通克隆（贴近参考录音）']];
  const picker = (title, attr, options, value, commit) => {
    const wrap = element('label', { textContent: title });
    const control = element('select');
    control.dataset[attr] = '1';
    control.append(...options.map(([optionValue, text]) => makeOption(text, optionValue)));
    control.value = value;
    control.onchange = () => commit(control.value);
    wrap.append(control);
    return wrap;
  };
  const modes = element('div', { className: 'row' });
  modes.append(
    picker('这句的生成方式 ', 'lineVoiceMode', [['', `跟随角色（${MODES.find(item => item[0] === characterMode)?.[1] ?? characterMode}）`], ...MODES], line.speech?.voice?.mode || '', value => setLineVoiceField('mode', value)),
    picker('模型 ', 'lineVoiceModel', [['', '跟随角色'], ['1.7B', '1.7B'], ['0.6B', '0.6B']], line.speech?.voice?.modelSize || '', value => setLineVoiceField('modelSize', value))
  );
  card.append(modes);
  if (characterVoices.length) card.append(picker(`${character.name} 默认的生成方式 `, 'characterVoiceMode', MODES, characterMode, value => {
    for (const voice of Object.values(character.speech.voices)) voice.mode = value;
    onEdit('修改角色生成方式');
    rerender();
  }));

  const details = element('details');
  details.append(element('summary', { textContent: `管理 ${character.name} 的声音（${variants.length + 1} 个）` }));
  const box = element('div', { className: 'stack' });
  const save = list => { character.speech = { ...character.speech, voiceVariants: list }; onEdit('修改角色声音'); rerender(); };
  for (const item of variants) {
    const line_ = element('div', { className: 'row' });
    const remove = element('button', { className: 'small', textContent: '移除' });
    remove.onclick = () => save(variants.filter(other => other !== item));
    const makeDefault = element('button', { className: 'small', textContent: '设为默认' });
    makeDefault.dataset.variantDefault = item.voiceId;
    makeDefault.title = '这个角色所有没单独选声音的句子都改用它；原来的默认声音会留在列表里。';
    makeDefault.onclick = () => {
      const slots = character.speech?.voices ?? {};
      const previous = Object.values(slots)[0]?.voiceId;
      for (const slot of Object.values(slots)) slot.voiceId = item.voiceId;
      const rest = variants.filter(other => other !== item);
      if (previous && !rest.some(other => other.voiceId === previous)) rest.push({ label: '原默认声音', voiceId: previous });
      save(rest);
      show(`默认声音已改成「${item.label}」，重 roll 后生效`, 'ok');
    };
    line_.append(element('span', { textContent: item.label }), makeDefault, remove);
    box.append(line_);
  }
  const name = element('input', { placeholder: '名字，例如 怒' });
  name.dataset.voiceVariantName = '1';
  const add = (voiceId, text) => { if (variants.some(item => item.voiceId === voiceId)) { show('这个声音已经添加过了', 'warn'); return; } save([...variants, { label: text, voiceId }]); };
  const existing = element('select', { innerHTML: '<option value="">选择 Voicebox 里已有的声音</option>' });
  existing.dataset.voiceVariantExisting = '1';
  details.ontoggle = async () => {
    if (!details.open || existing.options.length > 1) return;
    try { for (const profile of await voiceboxJson('/profiles')) existing.append(makeOption(profile.name, profile.id)); }
    catch { show('连不上 Voicebox，无法读取声音列表', 'error'); }
  };
  const addExisting = element('button', { className: 'small', textContent: '添加' });
  addExisting.onclick = () => { if (existing.value) add(existing.value, name.value.trim() || existing.selectedOptions[0].textContent); };
  const file = element('input', { type: 'file', accept: 'audio/*' });
  file.dataset.voiceVariantFile = '1';
  const upload = element('button', { className: 'small', textContent: '上传并添加' });
  upload.dataset.voiceVariantUpload = '1';
  upload.onclick = async () => {
    const chosen = file.files?.[0], text = name.value.trim();
    if (!chosen || !text) { show('请填写名字并选择录音文件', 'error'); return; }
    upload.disabled = true; show('正在上传并转写…', 'warn');
    try { const voiceId = await createVoiceFromFile(chosen, `${character.name}·${text}`); show('声音已添加', 'ok'); add(voiceId, text); }
    catch (error) { show(`上传失败：${error?.message || error}`, 'error'); upload.disabled = false; }
  };
  const fromExisting = element('div', { className: 'row' }); fromExisting.append(existing, addExisting);
  const fromFile = element('div', { className: 'row' }); fromFile.append(file, upload);
  box.append(name, fromExisting, fromFile, element('small', { className: 'muted', textContent: '上传录音需要 3 秒以上，超过 30 秒只取开头 30 秒。' }));
  details.append(box);
  card.append(details);
}

const QUICK_PROMPTS = [
  ['愤怒', 'furious, raising his voice with real anger'],
  ['活泼', 'lively, bright and energetic, quick rhythm'],
  ['拖长尾音', 'draw out the last syllable'],
  ['半句转调', 'start in one mood, then abruptly switch to a completely different tone halfway through the line']
];
// Natural-language tone words; the bridge reads these as directions, so they stay out of the spoken text.
const TONE_GROUPS = [
  ['开心', [['兴奋', 'excited'], ['轻快', 'cheerful'], ['骄傲', 'proud'], ['松了口气', 'relieved'], ['惊叹', 'amazed']]],
  ['温柔', [['轻柔', 'softly'], ['温和', 'gently'], ['暖', 'warmly'], ['声音软下来', 'voice softening'], ['让人安心', 'reassuring'], ['关心', 'concerned']]],
  ['逗人', [['逗', 'teasing'], ['调皮', 'playful'], ['得意', 'smug'], ['假装生气', 'mock angry'], ['假装被冒犯', 'pretending to be offended'], ['一本正经', 'deadpan, saying something absurd with a straight face'], ['阴阳怪气', 'sarcastic'], ['夸张', 'dramatic, overacting on purpose']]],
  ['心情', [['吃醋', 'jealous'], ['闹别扭', 'sulking'], ['慌了', 'flustered'], ['不好意思', 'embarrassed'], ['烦', 'annoyed'], ['憋屈', 'frustrated'], ['受伤', 'hurt'], ['紧张', 'nervous'], ['犹豫', 'hesitant, the words catching before they come out'], ['严肃', 'serious']]],
  ['生气害怕', [['压着火气', 'restrained anger, low and cold, not shouting'], ['大吼', 'yelling at the top of his lungs'], ['恐惧', 'frightened, voice unsteady'], ['倒吸一口气', 'gasping in shock first']]],
  ['困和小声', [['累', 'tired'], ['困', 'sleepy'], ['半梦半醒', 'half asleep'], ['小声', 'quietly'], ['耳语', 'whispering, close and intimate']]],
  ['笑和哭', [['轻笑', 'with a soft chuckle'], ['憋笑', 'trying not to laugh'], ['笑出声', 'laughing while speaking'], ['声音发哑', 'voice cracking a little'], ['哽住', 'choked up'], ['带着泪', 'teary']]],
  ['节奏', [['慢慢说', 'slowly'], ['着急', 'rushed, words tumbling out'], ['结巴', 'stammering'], ['中间停顿', 'with a short pause in the middle']]]
];

export function renderLineTakePanel(host, { project, line, workspace, resolveAsset, onChanged, onEdit, clearAudio, bgmOptions, setBgm, importBgm, character }) {
  const active = project.assets.find(asset => asset.id === line.audioAssetId) || null;
  const takes = listVoiceTakes(project, line);
  const element = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const state = element('span', { className: 'status' });
  const show = (text, kind = '') => { messages.set(line.id, { text, kind }); state.className = `status ${kind}`; state.textContent = text; };
  const position = queuedIndex(line.id);
  const busy = runningLineId === line.id || position >= 0;
  if (runningLineId === line.id) show('生成中…', 'warn');
  else if (position >= 0) show(`排队中 · 第 ${position + 1} 位`, 'warn');
  else if (messages.has(line.id)) show(messages.get(line.id).text, messages.get(line.id).kind);

  const audio = element('audio', { controls: true, className: 'audio-player' });
  audio.style.width = '100%';
  const play = async asset => {
    const source = await resolveAsset(asset.id);
    if (!source) { show('这个版本的音频读取失败', 'error'); return; }
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
    if (typeof source === 'string') audio.src = source;
    else { objectUrl = URL.createObjectURL(source); audio.src = objectUrl; }
    audio.play().catch(() => {});
  };
  /** Queues a job that makes a new version: the current one is archived first and restored on failure. */
  const enqueue = produce => {
    if (busy) return;
    if (!workspace) { show('请先连接工程文件夹', 'error'); return; }
    queue.push({ line, onChanged, run: async () => {
      const known = new Set(project.assets.map(asset => asset.id));
      const archived = archiveActiveTake(project, line);
      try {
        const prepared = await produce();
        if (!prepared?.ttsResult) throw new Error('这句没有可生成的语音，可能绑定了手工音频。');
        await persistGeneratedSpeech(workspace, project, line, prepared);
        clearAudio(line.audioAssetId);
      } catch (error) {
        if (archived && !known.has(archived.id)) project.assets.splice(project.assets.indexOf(archived), 1);
        throw error;
      }
    } });
    messages.delete(line.id);
    emit();
    onChanged(false);
    void pump();
  };
  const roll = () => enqueue(() => prepareLineSpeech(project, line, { tts: registry(), translate: false, synthesize: true, regenerateGeneratedAudio: true }));
  const choose = async take => {
    if (busy) { show('这句正在生成，请稍后', 'warn'); return; }
    const source = await resolveAsset(take.id);
    if (!source) { show('这个版本的音频读取失败', 'error'); return; }
    activateVoiceTake(project, line, take.id);
    clearAudio(line.audioAssetId, typeof source === 'string' ? null : source);
    messages.set(line.id, { text: '已切换当前版本', kind: 'ok' });
    onChanged(true);
  };
  const row = (label, asset, isActive) => {
    const item = element('div', { className: 'row' });
    const listen = element('button', { className: 'small', textContent: '▶' });
    listen.setAttribute('aria-label', `试听${label}`);
    listen.onclick = () => void play(asset);
    item.append(listen, element('span', { textContent: `${label} · ${(Number(asset.metadata?.duration) || 0).toFixed(1)} 秒` }));
    if (isActive) item.append(element('small', { className: 'muted', textContent: '当前使用' }));
    else {
      const use = element('button', { className: 'small', textContent: '设为当前', disabled: busy });
      use.onclick = () => void choose(asset);
      item.append(use);
    }
    return item;
  };

  const card = element('div', { className: 'voice-line-card stack' });
  const head = element('div', { className: 'row' });
  const rollButton = element('button', { className: 'small', textContent: busy ? '已在队列中' : active ? '重 roll' : '生成', disabled: busy });
  rollButton.dataset.lineRoll = '1';
  rollButton.onclick = () => void roll();
  head.append(element('strong', { textContent: `配音版本 · 共 ${active ? takes.length + 1 : 0} 个` }), rollButton, state);
  card.append(head);
  if (active) card.append(row('当前版本', active, true));
  takes.forEach((take, index) => card.append(row(`历史 ${takes.length - index}`, take, false)));
  if (active) card.append(audio);

  const field = (title, value, placeholder, commit) => {
    const label = element('label', { textContent: title });
    const area = element('textarea', { rows: 2, value: value || '', placeholder });
    area.onchange = () => commit(area.value.trim());
    label.append(area);
    card.append(label);
    return area;
  };
  const setInstruct = text => {
    line.speech ??= {};
    line.speech.acting = { ...line.speech.acting, instruct: text };
    onEdit('修改表演指令');
  };
  const prompt = field('本句表演指令（下次重 roll 时生效）', line.speech?.acting?.instruct, '例如：前半句克制，最后突然爆发', setInstruct);
  const chips = element('div', { className: 'row' });
  const addTone = text => { prompt.value = [prompt.value.trim(), text].filter(Boolean).join('; '); setInstruct(prompt.value); };
  for (const [name, text] of QUICK_PROMPTS) {
    const chip = element('button', { className: 'small', textContent: name });
    chip.onclick = () => addTone(text);
    chips.append(chip);
  }
  const tones = element('select');
  tones.dataset.toneInsert = '1';
  tones.append(makeOption('插入语气…', ''));
  for (const [group, items] of TONE_GROUPS) {
    const block = document.createElement('optgroup');
    block.label = group;
    block.append(...items.map(([name, text]) => makeOption(name, text)));
    tones.append(block);
  }
  tones.onchange = () => { if (tones.value) addTone(tones.value); tones.value = ''; };
  const clear = element('button', { className: 'small', textContent: '清空指令' });
  clear.onclick = () => { prompt.value = ''; setInstruct(''); };
  chips.append(tones, clear);
  card.append(chips);
  card.append(element('small', { className: 'muted', textContent: '语气只对情绪桥生效；普通克隆会忽略它，想要情绪就选情绪桥或“自动”。' }));
  field('朗读文本（可加「ー」「〜」做长音）', line.speech?.textOverride, '留空表示读显示文字', text => {
    line.speech ??= {};
    if (text) line.speech.textOverride = text; else delete line.speech.textOverride;
    onEdit('修改朗读文本');
  });
  if (character) field(`角色设定 · ${character.name}（这个角色的所有句子都生效）`, character.speech?.persona, '例如：说话轻声细语、有点怯生生，但很有礼貌', text => {
    character.speech = { ...character.speech, persona: text || undefined };
    onEdit('修改角色设定');
  });
  field('本句状态（只影响这一句）', line.speech?.persona, '例如：喝醉了，难得坦率；或：强装镇定，其实很慌', text => {
    line.speech ??= {};
    if (text) line.speech.persona = text; else delete line.speech.persona;
    onEdit('修改本句状态');
  });
  const replaceLabel = element('label', { className: 'check-label', textContent: ' 这句替换角色设定（不勾选则叠加）' });
  const replaceBox = element('input', { type: 'checkbox', checked: !!line.speech?.personaReplacesCharacter });
  replaceBox.onchange = () => {
    line.speech ??= {};
    if (replaceBox.checked) line.speech.personaReplacesCharacter = true; else delete line.speech.personaReplacesCharacter;
    onEdit('修改本句状态');
  };
  replaceLabel.prepend(replaceBox);
  card.append(replaceLabel);

  const context = { element, project, line, character, show, onEdit, busy, enqueue, resolveAsset, active, rerender: () => onChanged(false) };
  renderSegmentEditor(card, context);
  renderPitchCurve(card, context);
  renderVoiceChoice(card, { element, line, character, show, onEdit, rerender: () => onChanged(false), project, resolveAsset, active });

  const music = element('div', { className: 'row' });
  const label = element('label', { textContent: '从这句开始的 BGM ' });
  const select = element('select', { innerHTML: bgmOptions });
  select.dataset.lineBgm = '1';
  select.onchange = () => setBgm(select.value);
  label.append(select);
  const add = element('button', { className: 'small', textContent: '导入新 BGM' });
  add.onclick = importBgm;
  music.append(label, add);
  card.append(music);
  host.append(card);
}

const spokenTextOf = line => stripTextTags(line.speech?.textOverride || line.text || '');
const SPEEDS = [['0.7', '慢很多'], ['0.85', '稍慢'], ['1', '原速'], ['1.15', '稍快'], ['1.3', '快']];
const PAUSES = [['0', '不停'], ['0.2', '停 0.2 秒'], ['0.4', '停 0.4 秒'], ['0.8', '停 0.8 秒'], ['1.5', '停 1.5 秒']];
const toneOptions = () => [['', '跟随整句'], ...QUICK_PROMPTS, ...TONE_GROUPS.flatMap(([, items]) => items)];

/** Emotion curve + speed points: the line is voiced part by part, each with its own tone, speed and pause. */
function renderSegmentEditor(card, { element, line, show, onEdit, rerender }) {
  const details = element('details');
  details.dataset.segmentEditor = '1';
  const segments = line.speech?.segments ?? [];
  details.open = segments.length > 0;
  details.append(element('summary', { textContent: segments.length ? `分段表演 · ${segments.length} 段（情绪变化 / 变速 / 停顿）` : '分段表演（一句里换情绪、变速、加停顿）' }));
  const box = element('div', { className: 'stack' });
  const save = list => {
    line.speech ??= {};
    if (list?.length) line.speech.segments = list; else delete line.speech.segments;
    onEdit('修改分段表演');
    rerender();
  };
  const spoken = spokenTextOf(line);
  if (!segments.length) {
    const split = element('button', { className: 'small', textContent: '按标点分段' });
    split.dataset.segmentSplit = '1';
    split.onclick = () => { const list = splitSpeechSegments(spoken); if (list.length < 2) { show('这句只有一段，没法再分；可以在朗读文本里加标点', 'warn'); return; } save(list); };
    box.append(split, element('small', { className: 'muted', textContent: '每段单独生成后拼起来：前半句平静、后半句爆发，或者中间放慢、停一下，都能精确落在你指定的位置。' }));
  } else {
    const squash = value => String(value).replace(/\s+/g, '');
    if (squash(segments.map(item => item.text).join('')) !== squash(spoken))
      box.append(element('div', { className: 'status error', textContent: '分段文字和朗读文本对不上了（改过台词？），生成会失败。请改文字或重新分段。' }));
    segments.forEach((segment, index) => {
      const row = element('div', { className: 'stack' });
      row.style.cssText = 'border-left:3px solid rgba(180,160,230,.5);padding-left:8px';
      const text = element('input', { value: segment.text });
      text.dataset.segmentText = String(index);
      text.onchange = () => { const list = segments.map(item => ({ ...item })); list[index].text = text.value; save(list); };
      const controls = element('div', { className: 'row' });
      const pick = (attr, options, value, commit) => {
        const select = element('select'); select.dataset[attr] = String(index);
        select.append(...options.map(([optionValue, label]) => makeOption(label, optionValue)));
        if (value && ![...select.options].some(option => option.value === value)) select.append(makeOption(`自定义：${value.slice(0, 18)}`, value));
        select.value = value; select.onchange = () => commit(select.value); return select;
      };
      const update = patch => { const list = segments.map(item => ({ ...item })); Object.assign(list[index], patch); for (const key of Object.keys(patch)) if (patch[key] === undefined) delete list[index][key]; save(list); };
      controls.append(
        pick('segmentTone', toneOptions(), segment.instruct || '', value => update({ instruct: value || undefined })),
        pick('segmentSpeed', SPEEDS, String(segment.speed ?? 1), value => update({ speed: Number(value) === 1 ? undefined : Number(value) })),
        ...(index < segments.length - 1 ? [pick('segmentPause', PAUSES, String(segment.pauseAfter ?? 0), value => update({ pauseAfter: Number(value) || undefined }))] : [])
      );
      if (index < segments.length - 1) {
        const merge = element('button', { className: 'small', textContent: '和下一段合并' });
        merge.onclick = () => { const list = segments.map(item => ({ ...item })); list[index].text += list[index + 1].text; list.splice(index + 1, 1); save(list); };
        controls.append(merge);
      }
      row.append(element('small', { className: 'muted', textContent: `第 ${index + 1} 段` }), text, controls);
      box.append(row);
    });
    const reset = element('button', { className: 'small', textContent: '取消分段' });
    reset.dataset.segmentClear = '1';
    reset.onclick = () => save(null);
    const resplit = element('button', { className: 'small', textContent: '重新按标点分段' });
    resplit.onclick = () => save(splitSpeechSegments(spoken));
    const actions = element('div', { className: 'row' }); actions.append(resplit, reset);
    box.append(actions, element('small', { className: 'muted', textContent: '改完点上面的「重 roll」。有段落设了语气时，“自动”模式会走情绪桥；普通克隆只用变速和停顿。' }));
  }
  details.append(box);
  card.append(details);
}

/** Nine-point pitch envelope. Local fine-tune keeps the take and only bends pitch; re-record asks the bridge to follow it. */
function renderPitchCurve(card, { element, project, line, show, onEdit, busy, enqueue, resolveAsset, active, rerender }) {
  const details = element('details');
  details.dataset.pitchCurve = '1';
  const stored = line.speech?.prosodyCurve;
  const curve = normalizeProsodyCurve(stored);
  const points = Array.from({ length: 9 }, (_, i) => ({ position: i / 8, semitones: prosodyOffsetAt(curve, i / 8) }));
  details.open = !!stored && !prosodyIsFlat(curve);
  details.append(element('summary', { textContent: prosodyIsFlat(curve) ? '语调曲线（音高起伏）' : '语调曲线 · 已设置' }));
  const box = element('div', { className: 'stack' });
  box.append(element('small', { className: 'muted', textContent: `从左到右是这句从头到尾：${spokenTextOf(line).slice(0, 40)}` }));
  const sliders = element('div', { className: 'row' });
  sliders.style.cssText = 'gap:2px;align-items:flex-end;flex-wrap:nowrap';
  points.forEach((point, index) => {
    const column = element('label', { className: 'stack' });
    column.style.cssText = 'align-items:center;gap:2px;font-size:10px;min-width:0;flex:1';
    const value = element('span', { textContent: `${point.semitones > 0 ? '+' : ''}${point.semitones.toFixed(1)}` });
    const input = element('input', { type: 'range', min: '-4', max: '4', step: '0.5', value: String(point.semitones) });
    input.dataset.pitchPoint = String(index);
    input.style.cssText = 'writing-mode:vertical-lr;direction:rtl;height:84px;width:18px';
    input.oninput = () => { value.textContent = `${Number(input.value) > 0 ? '+' : ''}${Number(input.value).toFixed(1)}`; };
    input.onchange = () => { points[index].semitones = Number(input.value); line.speech ??= {}; line.speech.prosodyCurve = normalizeProsodyCurve(points); onEdit('修改语调曲线'); };
    column.append(value, input, element('span', { textContent: `${Math.round(point.position * 100)}%` }));
    sliders.append(column);
  });
  box.append(sliders, element('small', { className: 'muted', textContent: '单位是半音：+2 是往上抬两个半音，-2 是往下压。' }));
  const actions = element('div', { className: 'row' });
  const reset = element('button', { className: 'small', textContent: '归零' });
  reset.onclick = () => { if (line.speech) delete line.speech.prosodyCurve; onEdit('清空语调曲线'); rerender(); };
  const fine = element('button', { className: 'small', textContent: '本地微调当前版本', disabled: busy || !active });
  fine.dataset.pitchFineTune = '1';
  fine.title = '不重新生成，直接把当前版本的音高按曲线弯一下；旧版本会存档。';
  fine.onclick = () => {
    const target = normalizeProsodyCurve(line.speech?.prosodyCurve);
    if (prosodyIsFlat(target)) { show('曲线是平的，先拖几个点', 'warn'); return; }
    enqueue(async () => {
      const source = await resolveAsset(line.audioAssetId);
      const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
      if (!blob) throw new Error('当前版本的音频读取失败');
      const decoded = await decodeRecording(blob);
      const tuned = await fineTuneRecording(blob, decoded, target);
      const bound = project.assets.find(asset => asset.id === line.audioAssetId);
      const policy = resolveSpeechPolicy(project, line);
      return { inputFingerprint: speechInputFingerprint(project, line), displayText: line.text, speechText: resolveCachedSpeech(project, line).text,
        sourceLanguage: policy.sourceLanguage, targetLanguage: policy.targetLanguage, translated: false, ttsProvider: 'local-pitch-edit', audioSource: 'external-tts',
        mouthCues: bound?.metadata?.mouthCues ? structuredClone(bound.metadata.mouthCues) : undefined,
        ttsResult: { audio: tuned, mime: 'audio/wav', duration: decoded.duration } };
    });
  };
  const redo = element('button', { className: 'small', textContent: '按曲线重录（情绪桥）', disabled: busy });
  redo.dataset.pitchReenact = '1';
  redo.title = '让情绪桥照着曲线重新念一遍，会近似遵循，不保证精确。';
  redo.onclick = () => {
    const target = normalizeProsodyCurve(line.speech?.prosodyCurve);
    if (prosodyIsFlat(target)) { show('曲线是平的，先拖几个点', 'warn'); return; }
    try { assertProsodyReenactment(project, line); } catch (error) { show(`${error.message}（可以先把这句的生成方式改成情绪桥）`, 'error'); return; }
    enqueue(async () => {
      const prepared = await prepareLineSpeech(project, line, { tts: registry(), translate: false, synthesize: true, regenerateGeneratedAudio: true, prosodyReenactment: target });
      return { ...prepared, audioEdit: undefined };
    });
  };
  actions.append(reset, fine, redo);
  box.append(actions);
  details.append(box);
  card.append(details);
}

/** Saves a line's current take as a hidden Voicebox voice so other lines can copy its delivery. */
async function createReferenceVoice({ project, line, character, resolveAsset, active }) {
  if (!active) throw new Error('这句还没有配音');
  const source = await resolveAsset(active.id);
  const blob = typeof source === 'string' ? await (await fetch(source)).blob() : source;
  if (!blob) throw new Error('当前版本的音频读取失败');
  const wav = await toReferenceWav(blob, 1);
  const number = project.lines.indexOf(line) + 1;
  const profile = await voiceboxJson('/profiles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${character.name}·参考·第${number}行`, language: 'ja', description: 'Replay Lab 参考句' }) });
  const sample = new FormData();
  sample.append('file', wav); sample.append('reference_text', resolveCachedSpeech(project, line).text || spokenTextOf(line));
  await voiceboxJson(`/profiles/${profile.id}/samples`, { method: 'POST', body: sample });
  return { label: `参考·第${number}行`, voiceId: profile.id };
}
