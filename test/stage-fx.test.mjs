import test from 'node:test';
import assert from 'node:assert/strict';
import { StoryScriptImporter, parseTextTags, stripTextTags, parseDirectorCommand, formatDirectorCommand, compilePerformance, createLine, resolveCachedSpeech } from '../dist/index.js';
import { textBlipEvents, synthesizeBlip, buildAudioSchedule } from '../dist/renderers/browser-media.js';
import { screenFilterCss, MASK_TRANSITIONS } from '../dist/renderers/stage-fx.js';

test('text tags give plain text plus styled ranges and never reach speech', () => {
  const parsed = parseTextTags('喂！{抖}撒手{大}啊{/大}{/抖}你{彩}个{/}');
  assert.equal(parsed.plain, '喂！撒手啊你个');
  assert.deepEqual(parsed.ranges.map(r => [r.kind, r.from, r.to]), [['shake', 2, 5], ['big', 4, 5], ['rainbow', 6, 7]]);
  assert.equal(stripTextTags('{未知}保留'), '{未知}保留', 'unknown braces stay literal');
  assert.equal(stripTextTags('{抖}没关'), '没关', 'unclosed tag runs to the end');
  const project = StoryScriptImporter.parse('亚瑟：{抖}撒手{/抖}啊', { title: 't' });
  assert.equal(resolveCachedSpeech(project, project.lines[0]).text, '撒手啊');
  const line = compilePerformance(project).lines[0];
  assert.equal(line.text, '撒手啊');
  assert.equal(line.textTags[0].kind, 'shake');
});

test('emote, filter, card and named transitions parse and round-trip', () => {
  const project = StoryScriptImporter.parse('亚瑟：一\n王耀：二', { title: 't' });
  const parse = text => parseDirectorCommand(project, text);
  assert.equal(parse('/emote 亚瑟 怒').command.value, 'anger');
  assert.equal(parse('/emote 王耀 惊问 2').command.duration, 2);
  assert.match(parse('/emote 亚瑟 跳舞').error, /未知漫符/);
  assert.match(parse('/emote 没这人 怒').error, /找不到角色/);
  assert.equal(parse('/filter 夜晚').command.value, 'night');
  assert.equal(parse('/filter 无').command.value, 'none');
  assert.deepEqual(parse('/card 第一话 "奇妙的小海岛" 3').command, { kind: 'card', value: '第一话', target: '奇妙的小海岛', duration: 3 });
  assert.equal(parse('/transition 圆开').command.value, 'iris-in');
  assert.equal(parse('/transition 百叶窗 1.2').command.duration, 1.2);
  assert.equal(parse('/transition fade').command.value, 'fade');
  for (const text of ['/emote 亚瑟 怒 1.6', '/filter 回忆', '/transition blinds 1.2'])
    assert.deepEqual(parse(formatDirectorCommand(project, parse(text).command)).command, parse(text).command);
  assert.ok(MASK_TRANSITIONS.has('noise'));
  assert.match(screenFilterCss('memory'), /sepia/);
});

test('filters persist until cleared, emotes span lines, cards pause the script', () => {
  const project = StoryScriptImporter.parse('亚瑟：一\n王耀：二\n亚瑟：三\n王耀：四', { title: 't' });
  for (const line of project.lines) line.duration = 1;
  const insert = (at, text) => { const line = createLine(project, 'Director', text, 'command'); line.command = parseDirectorCommand(project, text).command; project.lines.splice(at, 0, line); };
  insert(3, '/filter 无'); insert(2, '/card 第一话 2'); insert(1, '/emote 亚瑟 怒 1.5'); insert(0, '/filter 回忆');
  const lines = compilePerformance(project).lines;
  const dialogue = lines.filter(line => line.type === 'dialogue');
  assert.deepEqual(dialogue.map(line => line.screenFilter), ['memory', 'memory', 'memory', null]);
  const card = lines.find(line => line.card);
  assert.equal(card.duration, 2, 'card holds for its seconds');
  assert.equal(card.card.title, '第一话');
  const marked = lines.filter(line => line.emotes?.length).map(line => line.type);
  assert.ok(marked.includes('dialogue'), 'emote carried onto the following line');
  assert.equal(lines.find(line => line.emoteEvent).duration < 0.1, true, 'emote does not pause');
});

test('unvoiced lines of a character with a typing blip get throttled synthetic blips', () => {
  const project = StoryScriptImporter.parse('熊二郎：你是谁你是谁你是谁\n亚瑟：有配音', { title: 't' });
  project.characters.find(c => c.name === '熊二郎').textBlip = { pitch: 560, wave: 'square' };
  project.characters.find(c => c.name === '亚瑟').textBlip = { pitch: 300, wave: 'triangle' };
  project.assets.push({ id: 'v1', kind: 'voice', name: 'v', metadata: { duration: 1 } });
  project.lines[1].audioAssetId = 'v1';
  const performance = compilePerformance(project);
  const [bear, voiced] = performance.lines;
  assert.ok(bear.textBlip);
  assert.equal(bear.textEffect, 'w2w', 'blips need the text to type out');
  assert.equal(voiced.textBlip, undefined, 'voiced lines stay silent');
  const blips = textBlipEvents(bear, 0.7);
  assert.ok(blips.length >= 5 && blips.length <= 12, `got ${blips.length}`);
  for (let i = 1; i < blips.length; i++) assert.ok(blips[i].start - blips[i - 1].start >= 0.044);
  assert.ok(blips.every(event => event.synthetic && event.assetId.startsWith('blip:560:square:')));
  assert.ok(buildAudioSchedule(performance).some(event => event.synthetic));
  const fake = { sampleRate: 8000, createBuffer: (channels, length, rate) => { const data = new Float32Array(length); return { length, sampleRate: rate, getChannelData: () => data, data }; } };
  const buffer = synthesizeBlip('blip:560:square:1', fake);
  assert.equal(buffer.length, Math.round(8000 * 0.055));
  assert.ok(buffer.data.some(value => Math.abs(value) > 0.1));
  assert.equal(synthesizeBlip('blip:nope', fake), null);
});
