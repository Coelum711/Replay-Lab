import {
  archiveActiveTake,
  activateVoiceTake,
  listVoiceTakes,
  persistGeneratedSpeech,
  prepareLineSpeech,
  TtsRegistry,
  VoiceboxLocalTtsProvider
} from '../dist/index.js';
import { serviceFetch } from './desktop-client.js';

const endpoint = (key, fallback) => { try { return localStorage.getItem(`replaylab.${key}`) || fallback; } catch { return fallback; } };
const registry = () => new TtsRegistry().register(new VoiceboxLocalTtsProvider({
  baseUrl: endpoint('voiceboxEndpoint', 'http://127.0.0.1:17493'),
  bridgeUrl: endpoint('bridgeEndpoint', 'http://127.0.0.1:17494'),
  fetchImpl: serviceFetch
}));

let rollingLineId = null;
let lastMessage = null;
let objectUrl = null;

/** Single-line take controls inside the Studio workbench: re-roll, listen, choose, and set this line's BGM. */
const voiceboxUrl = () => endpoint('voiceboxEndpoint', 'http://127.0.0.1:17493');
async function voiceboxJson(path, options) {
  const response = await serviceFetch(`${voiceboxUrl()}${path}`, options);
  if (!response.ok) throw new Error(`Voicebox 返回 HTTP ${response.status}`);
  return response.json();
}

/** Bridge samples must be 3–60 s PCM WAV, and long references made a voice stop early, so keep 30 s at most. */
async function toReferenceWav(file) {
  const context = new AudioContext({ sampleRate: 24000 });
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration < 3) throw new Error('录音太短，至少需要 3 秒。');
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

function renderVoiceChoice(card, { element, line, character, show, onEdit, rerender }) {
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
    line_.append(element('span', { textContent: item.label }), remove);
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
  const show = (text, kind = '') => { lastMessage = { lineId: line.id, text, kind }; state.className = `status ${kind}`; state.textContent = text; };
  if (rollingLineId === line.id) show('重新生成中…', 'warn');
  else if (lastMessage?.lineId === line.id) show(lastMessage.text, lastMessage.kind);

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
  const roll = async () => {
    if (rollingLineId) { show('已有一句正在生成', 'warn'); return; }
    if (!workspace) { show('请先连接工程文件夹', 'error'); return; }
    rollingLineId = line.id;
    onChanged(false);
    const known = new Set(project.assets.map(asset => asset.id));
    const archived = archiveActiveTake(project, line);
    try {
      const prepared = await prepareLineSpeech(project, line, { tts: registry(), translate: false, synthesize: true, regenerateGeneratedAudio: true });
      if (!prepared.ttsResult) throw new Error('这句没有可生成的语音，可能绑定了手工音频。');
      await persistGeneratedSpeech(workspace, project, line, prepared);
      clearAudio(line.audioAssetId);
      lastMessage = { lineId: line.id, text: '已生成新版本，旧版本已存档', kind: 'ok' };
    } catch (error) {
      if (archived && !known.has(archived.id)) project.assets.splice(project.assets.indexOf(archived), 1);
      lastMessage = { lineId: line.id, text: `生成失败：${error?.message || error}`, kind: 'error' };
    } finally {
      rollingLineId = null;
      onChanged(true);
    }
  };
  const choose = async take => {
    if (rollingLineId) { show('有一句正在生成，请稍后', 'warn'); return; }
    const source = await resolveAsset(take.id);
    if (!source) { show('这个版本的音频读取失败', 'error'); return; }
    activateVoiceTake(project, line, take.id);
    clearAudio(line.audioAssetId, typeof source === 'string' ? null : source);
    lastMessage = { lineId: line.id, text: '已切换当前版本', kind: 'ok' };
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
      const use = element('button', { className: 'small', textContent: '设为当前', disabled: !!rollingLineId });
      use.onclick = () => void choose(asset);
      item.append(use);
    }
    return item;
  };

  const card = element('div', { className: 'voice-line-card stack' });
  const head = element('div', { className: 'row' });
  const rollButton = element('button', { className: 'small', textContent: active ? '重 roll' : '生成', disabled: !!rollingLineId });
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

  renderVoiceChoice(card, { element, line, character, show, onEdit, rerender: () => onChanged(false) });

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
