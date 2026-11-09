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
