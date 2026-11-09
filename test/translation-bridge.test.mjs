import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { StoryScriptImporter, collectBridgeLines, buildPastePrompt, parsePasteReply, splitBridgeBatches, translationWarnings, VoiceboxLlmTranslationProvider } from '../dist/index.js';
import { localRequest } from '../desktop/policy.mjs';

const script = '【旁白】\n亚瑟：滚吧\n王耀：不卖 ||| 売らないある';
const parse = () => StoryScriptImporter.parse(script, { title: 't' });
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('only dialogue lines are collected and existing spoken text is kept', () => {
  const lines = collectBridgeLines(parse());
  assert.deepEqual(lines.map(l => [l.number, l.speaker, l.existing]), [[2, '亚瑟', ''], [3, '王耀', '売らないある']]);
});

test('paste prompt round-trips through a realistic chatbot reply', () => {
  const lines = collectBridgeLines(parse());
  const prompt = buildPastePrompt(lines, { targetLanguage: 'ja-JP', styleNotes: '亚瑟自称俺' });
  assert.match(prompt, /日语/); assert.match(prompt, /亚瑟自称俺/); assert.match(prompt, /#2｜亚瑟：滚吧/);
  const reply = '好的，以下是译文：\n```\n#2｜失せろ\n# 3 | 売らないある：ね\n#99｜多余\n```';
  const parsed = parsePasteReply(reply, [2, 3, 4]);
  assert.equal(parsed.translations.get(2), '失せろ');
  assert.equal(parsed.translations.get(3), '売らないある：ね');
  assert.deepEqual(parsed.missing, [4]);
  assert.deepEqual(parsed.unexpected, [99]);
});

test('batches keep every line in order', () => {
  assert.deepEqual(splitBridgeBatches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('warnings catch the mistakes the local model made', () => {
  assert.deepEqual(translationWarnings('失せろ', 'ja'), []);
  assert.ok(translationWarnings('それに这种状況では', 'ja').includes('疑似混入中文'));
  assert.ok(translationWarnings('お前！ why are we doing this', 'ja').includes('混入英文句子'));
});

test('local provider requests 4B, strips echoed speaker labels and explains failures', async () => {
  let body;
  const ok = new VoiceboxLlmTranslationProvider({ fetchImpl: async (url, options) => { assert.match(String(url), /\/llm\/generate$/); body = JSON.parse(options.body); return json({ text: 'アーセル：失せろ' }); } });
  const result = await ok.translate({ text: '滚吧', targetLanguage: 'ja', speaker: '亚瑟', styleNotes: '自称俺' });
  assert.equal(result.text, '失せろ');
  assert.equal(body.model_size, '4B');
  assert.match(body.system, /亚瑟/); assert.match(body.system, /自称俺/);
  const broken = new VoiceboxLlmTranslationProvider({ fetchImpl: async () => new Response('x', { status: 500 }) });
  await assert.rejects(broken.translate({ text: 'a', targetLanguage: 'ja' }), /重启 Voicebox/);
  const down = new VoiceboxLlmTranslationProvider({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(down.translate({ text: 'a', targetLanguage: 'ja' }), /连不上 Voicebox/);
});

test('the desktop allowlist permits the local LLM endpoint', () => {
  assert.equal(localRequest('http://127.0.0.1:17493/llm/generate', 'POST'), 'http://127.0.0.1:17493/llm/generate');
});

test('the real voice page drives paste review and only applies adopted rows', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html);
  const { document: doc } = dom.window;
  Object.assign(globalThis, { document: doc, Option: dom.window.Option });
  const { createTranslationBridge } = await import('../web/translation-bridge-controller.js');
  const project = parse();
  let applied;
  createTranslationBridge({ root: doc, getProject: () => project, fetchImpl: fetch, getEndpoint: () => 'http://127.0.0.1:17493', onApplied: s => { applied = s; } });
  const $ = s => doc.querySelector(s);
  $('#tbMode').value = 'paste'; $('#tbMode').dispatchEvent(new dom.window.Event('change'));
  assert.equal($('#tbPasteControls').hidden, false);
  $('#tbLoad').click();
  assert.equal(doc.querySelectorAll('#tbRows tr').length, 2);
  $('#tbReply').value = '#2｜失せろ';
  $('#tbImport').click();
  assert.equal(project.lines[1].speech?.textOverride, undefined, 'import must not apply before review');
  $('#tbApply').click();
  assert.equal(project.lines[1].speech.textOverride, '失せろ');
  assert.equal(project.lines[1].text, '滚吧');
  assert.equal(project.settings.speechLanguage, 'ja');
  assert.equal(applied.length, 1);
});

test('style notes for one character do not leak onto another', async () => {
  const { styleNotesFor } = await import('../dist/index.js');
  const speakers = ['安东尼奥', '王耀'];
  const notes = '安东尼奥说关西腔；王耀句尾用「ある」；语气自然';
  assert.equal(styleNotesFor(notes, '安东尼奥', speakers), '安东尼奥说关西腔；语气自然');
  assert.equal(styleNotesFor(notes, '王耀', speakers), '王耀句尾用「ある」；语气自然');
});

test('voice review filters, marks and regenerates only marked lines', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html);
  const { document: doc } = dom.window;
  Object.assign(globalThis, { document: doc, Option: dom.window.Option });
  const { createVoiceReview } = await import('../web/voice-review-controller.js');
  const project = StoryScriptImporter.parse('亚瑟：第一句 ||| 一\n王耀：第二句 ||| 二', { title: 't' });
  project.assets = project.lines.map((line, i) => ({ id: `a${i}`, kind: 'voice', name: 'x', metadata: { duration: 1 + i } }));
  project.lines.forEach((line, i) => { line.audioAssetId = `a${i}`; });
  const redone = [];
  createVoiceReview({ root: doc, getProject: () => project, audioBlob: async () => new Blob(['x']), isBusy: () => false, regenerate: async line => { redone.push(line.text); }, onChanged() {}, listTakes: () => [], activateTake: async () => {} });
  const $ = s => doc.querySelector(s);
  $('#vrRefresh').click();
  assert.equal(doc.querySelectorAll('#vrRows tr:not([hidden])').length, 2);
  assert.equal($('#vrRegen').disabled, true);
  const box = doc.querySelectorAll('#vrRows input[type=checkbox]')[1];
  box.checked = true; box.dispatchEvent(new dom.window.Event('change'));
  assert.equal(project.lines[1].metadata.voiceReview, 'redo');
  assert.match($('#vrRegen').textContent, /1 句/);
  $('#vrFilter').value = 'redo'; $('#vrFilter').dispatchEvent(new dom.window.Event('change'));
  assert.equal(doc.querySelectorAll('#vrRows tr:not([hidden])').length, 1);
  $('#vrRegen').click();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(redone, ['第二句']);
  assert.equal(project.lines[1].metadata.voiceReview, undefined);
});

test('voice takes archive the replaced version and switch without changing the bound asset', async () => {
  const { archiveActiveTake, activateVoiceTake, listVoiceTakes } = await import('../dist/index.js');
  const project = StoryScriptImporter.parse('亚瑟：一句', { title: 't' });
  const line = project.lines[0];
  const original = { id: 'a1', kind: 'voice', name: 'x', uri: 'project://old.wav', sourcePath: 'old.wav', mime: 'audio/wav', metadata: { generated: true, generatedLineId: line.id, duration: 1 } };
  project.assets.push(original); line.audioAssetId = 'a1';
  const take = archiveActiveTake(project, line);
  assert.equal(archiveActiveTake(project, line), take, 'the same file is archived once');
  assert.equal(take.metadata.generatedLineId, undefined, 'archived takes must not be reused as the regeneration target');
  Object.assign(original, { uri: 'project://new.wav', sourcePath: 'new.wav' }); original.metadata.duration = 2;
  activateVoiceTake(project, line, take.id);
  assert.equal(line.audioAssetId, 'a1');
  assert.equal(original.sourcePath, 'old.wav'); assert.equal(original.metadata.duration, 1); assert.equal(original.metadata.generatedLineId, line.id);
  assert.equal(listVoiceTakes(project, line)[0].sourcePath, 'new.wav');
  assert.equal(listVoiceTakes(project, line).length, 1);
  const imported = { id: 'b', kind: 'voice', name: 'y', sourcePath: 'mine.wav', metadata: {} };
  project.assets.push(imported); line.audioAssetId = 'b';
  assert.equal(archiveActiveTake(project, line), null, 'hand-imported audio is not a generated take');
});

test('/flash parses, round-trips and compiles to a timed full-screen flash', async () => {
  const { parseDirectorCommand, formatDirectorCommand, compilePerformance, createLine } = await import('../dist/index.js');
  const project = StoryScriptImporter.parse('亚瑟：一句', { title: 't' });
  const parse = text => parseDirectorCommand(project, text);
  assert.deepEqual(parse('/flash').command, { kind: 'flash', value: '#000000', duration: 0.5 });
  assert.deepEqual(parse('/flash white 1.2').command, { kind: 'flash', value: '#ffffff', duration: 1.2 });
  assert.equal(parse('/flash #123456 0.3').command.value, '#123456');
  assert.match(parse('/flash purple').error, /颜色/);
  assert.match(parse('/flash black 0').error, /秒数/);
  assert.equal(parse(formatDirectorCommand(project, parse('/flash red 0.4').command)).command.duration, 0.4);
  const line = createLine(project, 'Director', '/flash white 0.8', 'command');
  line.command = parse('/flash white 0.8').command;
  project.lines.push(line);
  const compiled = compilePerformance(project).lines.at(-1);
  assert.deepEqual(compiled.flash, { color: '#ffffff', duration: 0.8 });
  assert.equal(compiled.duration, 0.8);
});

test('a character persona is sent with every expressive generation', async () => {
  const { prepareLineSpeech, TtsRegistry } = await import('../dist/index.js');
  const project = StoryScriptImporter.parse('亚瑟[愤怒大喊]：滚 ||| 失せろ', { title: 't' });
  const arthur = project.characters.find(c => c.name === '亚瑟');
  arthur.speech = { ...arthur.speech, persona: '毒舌的英国绅士', voices: { ja: { provider: 'fake', voiceId: 'v' } } };
  project.settings.speechLanguage = 'ja'; project.settings.logLanguage = 'zh';
  let request;
  const fake = { id: 'fake', label: 'f', capabilities: {}, synthesize: async r => { request = r; return { audio: new ArrayBuffer(1), mime: 'audio/wav', duration: 1 }; } };
  await prepareLineSpeech(project, project.lines[0], { tts: new TtsRegistry().register(fake), translate: false, synthesize: true });
  assert.match(request.instruct, /^毒舌的英国绅士/);
  assert.match(request.instruct, /愤怒大喊/);
});

test('a line can add to or replace the character persona', async () => {
  const { prepareLineSpeech, TtsRegistry } = await import('../dist/index.js');
  const project = StoryScriptImporter.parse('亚瑟：滚 ||| 失せろ\n亚瑟：别走 ||| 行くな', { title: 't' });
  const arthur = project.characters.find(c => c.name === '亚瑟');
  arthur.speech = { ...arthur.speech, persona: '毒舌绅士', voices: { ja: { provider: 'fake', voiceId: 'v' } } };
  project.settings.speechLanguage = 'ja'; project.settings.logLanguage = 'zh';
  const [added, replaced] = project.lines;
  added.speech.persona = '喝醉了';
  replaced.speech.persona = '难得坦率'; replaced.speech.personaReplacesCharacter = true;
  const sent = [];
  const fake = { id: 'fake', label: 'f', capabilities: {}, synthesize: async r => { sent.push(r.instruct); return { audio: new ArrayBuffer(1), mime: 'audio/wav', duration: 1 }; } };
  const tts = new TtsRegistry().register(fake);
  await prepareLineSpeech(project, added, { tts, translate: false, synthesize: true });
  await prepareLineSpeech(project, replaced, { tts, translate: false, synthesize: true });
  assert.equal(sent[0], '毒舌绅士. 喝醉了');
  assert.equal(sent[1], '难得坦率');
});

test('a line can use another voice of its character without losing the voice mode', async () => {
  const { resolveSpeechPolicy } = await import('../dist/index.js');
  const project = StoryScriptImporter.parse('亚瑟：滚', { title: 't' });
  const arthur = project.characters.find(c => c.name === '亚瑟');
  arthur.speech = { ...arthur.speech, voices: { ja: { provider: 'voicebox-local', voiceId: 'normal', mode: 'experimental-clone-instruct', modelSize: '1.7B' } } };
  project.settings.speechLanguage = 'ja'; project.settings.logLanguage = 'zh';
  const line = project.lines[0];
  line.speech = { ...line.speech, voice: { voiceId: 'angry' } };
  const voice = resolveSpeechPolicy(project, line).voice;
  assert.equal(voice.voiceId, 'angry');
  assert.equal(voice.mode, 'experimental-clone-instruct');
  assert.equal(voice.modelSize, '1.7B');
});
test('the desktop allowlist permits transcription', () => {
  assert.equal(localRequest('http://127.0.0.1:17493/transcribe', 'POST'), 'http://127.0.0.1:17493/transcribe');
});

test('one line can leave the emotion bridge while its character stays on it', async () => {
  const { resolveSpeechPolicy } = await import('../dist/index.js');
  const project = StoryScriptImporter.parse('伊万：一\n伊万：二', { title: 't' });
  const ivan = project.characters.find(c => c.name === '伊万');
  ivan.speech = { ...ivan.speech, voices: { ja: { provider: 'voicebox-local', voiceId: 'v', mode: 'experimental-clone-instruct', modelSize: '1.7B' } } };
  project.settings.speechLanguage = 'ja'; project.settings.logLanguage = 'zh';
  project.lines[0].speech = { ...project.lines[0].speech, voice: { mode: 'stable-clone', modelSize: '0.6B' } };
  const [stable, bridged] = project.lines.map(line => resolveSpeechPolicy(project, line).voice);
  assert.equal(stable.mode, 'stable-clone'); assert.equal(stable.modelSize, '0.6B'); assert.equal(stable.voiceId, 'v');
  assert.equal(bridged.mode, 'experimental-clone-instruct'); assert.equal(bridged.modelSize, '1.7B');
});

test('auto mode sends only lines with emotion to the bridge', async () => {
  const { resolveSpeechPolicy } = await import('../dist/index.js');
  const project = StoryScriptImporter.parse('亚瑟：平常\n亚瑟[愤怒大喊]：生气\n亚瑟：状态', { title: 't' });
  const arthur = project.characters.find(c => c.name === '亚瑟');
  arthur.speech = { ...arthur.speech, voices: { ja: { provider: 'voicebox-local', voiceId: 'v', mode: 'auto', modelSize: '0.6B' } } };
  project.settings.speechLanguage = 'ja'; project.settings.logLanguage = 'zh';
  project.lines[2].speech = { ...project.lines[2].speech, persona: '喝醉了' };
  const [plain, angry, state] = project.lines.map(line => resolveSpeechPolicy(project, line).voice);
  assert.equal(plain.mode, 'stable-clone'); assert.equal(plain.modelSize, '0.6B');
  assert.equal(angry.mode, 'experimental-clone-instruct'); assert.equal(angry.modelSize, '1.7B');
  assert.equal(state.mode, 'experimental-clone-instruct');
});

test('the tone menu appends directions to the line instruction and can clear it', async () => {
  const dom = new JSDOM('<div id="h"></div>');
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, localStorage: { getItem: () => null } });
  const { renderLineTakePanel } = await import('../web/line-take-panel.js');
  const project = StoryScriptImporter.parse('亚瑟：滚', { title: 't' });
  const line = project.lines[0];
  const host = dom.window.document.getElementById('h');
  renderLineTakePanel(host, { project, line, workspace: null, resolveAsset: async () => null, onChanged() {}, onEdit() {}, clearAudio() {}, bgmOptions: '', setBgm() {}, importBgm() {}, character: project.characters.find(c => c.name === '亚瑟') });
  const menu = host.querySelector('[data-tone-insert]');
  assert.ok(menu.querySelectorAll('optgroup').length >= 6);
  menu.value = 'mock angry'; menu.dispatchEvent(new dom.window.Event('change'));
  menu.value = 'sulking'; menu.dispatchEvent(new dom.window.Event('change'));
  assert.equal(line.speech.acting.instruct, 'mock angry; sulking');
  assert.equal(menu.value, '');
  [...host.querySelectorAll('button')].find(b => b.textContent === '清空指令').click();
  assert.equal(line.speech.acting.instruct, '');
});
