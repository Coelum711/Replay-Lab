import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  textToMouthSyllables, analyzeVoicedRegions, distributeSyllables, alignTextToEnergy, pinyinToMouth, englishWordToArpabet,
  TtsRegistry, prepareLineSpeech, encodeWav, createProject, createLine, ENGLISH_VISEME_FALLBACK,
  selectCharacterLayers, createCharacter
} from '../dist/index.js';

const shape = (text, lang) => textToMouthSyllables(text, lang).map(s => (s.onset ? s.onset + '+' : '') + (s.vowel ?? '·')).join(' ');

/** Bursts of tone separated by silence: [[start, end], …] seconds. */
const bursts = (spans, total, rate = 16000) => {
  const samples = new Float32Array(Math.round(total * rate));
  for (const [a, b] of spans) for (let i = Math.round(a * rate); i < Math.round(b * rate); i++) samples[i] = 0.5 * Math.sin(2 * Math.PI * 220 * i / rate);
  return { samples, sampleRate: rate };
};

test('Chinese syllables come from the offline pinyin table', () => {
  assert.equal(shape('你好，我们出发吧', 'zh-CN'), 'I A O M+SCHWA U F+A M+A');
  assert.equal(shape('今天天气很好', 'zh'), 'I E E I SCHWA A');
  assert.deepEqual(pinyinToMouth('yuan'), { vowel: 'E' });
  assert.deepEqual(pinyinToMouth('xiong'), { vowel: 'U' });
  assert.deepEqual(pinyinToMouth('bo'), { vowel: 'O', onset: 'B' });
  assert.deepEqual(pinyinToMouth('ng'), { vowel: 'X' });
});

test('Japanese kana: ん/っ keep lips idle, small kana join the mora, ー repeats', () => {
  assert.equal(shape('こんにちは', 'ja'), 'O · I I A');
  assert.equal(shape('きょう', 'ja'), 'O U');
  assert.equal(shape('ちょっと', 'ja'), 'O · O');
  assert.equal(shape('ラーメン', 'ja'), 'A A M+E ·');
  // Without a kanji reading dictionary each kanji counts as two open morae.
  assert.equal(shape('待って', 'ja'), 'OPEN OPEN · E');
  // Kana anywhere in an undeclared line marks it as Japanese.
  assert.equal(shape('天気です', ''), 'OPEN OPEN OPEN OPEN E U');
});

test('Korean Hangul uses the medial vowel and English uses spelling → ARPABET', () => {
  assert.equal(shape('안녕하세요', 'ko'), 'A A A E O');
  assert.equal(shape('반갑습니다', 'ko'), 'M+A A U I A');
  assert.deepEqual(englishWordToArpabet('make'), [{ onset: 'M', vowel: 'EY' }]);
  assert.deepEqual(englishWordToArpabet('hello'), [{ vowel: 'EH' }, { vowel: 'OW' }]);
  assert.equal(shape('Hello world, make time for me', 'en-US'), 'E O W+OO M+E A F+OO M+I');
  assert.equal(shape('the thing', 'en'), 'TH+SCHWA TH+I');
});

test('other Latin languages fall back to vowel letters', () => {
  assert.equal(shape('Bonjour tout le monde', 'fr-FR'), 'M+O U U E M+O');
  assert.equal(shape('Hola amigo', 'es'), 'O A A M+I O');
  assert.equal(shape('Grüße', 'de'), 'U E');
});

test('voiced regions follow Lip Studio: 20 ms / 10 ms RMS, median threshold, smoothing', () => {
  const pcm = bursts([[0.2, 0.6], [0.9, 1.5]], 2);
  const voiced = analyzeVoicedRegions(pcm.samples, pcm.sampleRate).filter(r => r.voiced);
  assert.equal(voiced.length, 2);
  assert.ok(Math.abs(voiced[0].start - 0.2) < 0.03 && Math.abs(voiced[0].end - 0.6) < 0.03, JSON.stringify(voiced));
  assert.ok(Math.abs(voiced[1].start - 0.9) < 0.03 && Math.abs(voiced[1].end - 1.5) < 0.03, JSON.stringify(voiced));
});

test('syllables are spread over voiced regions in proportion; the last region takes the rest', () => {
  const regions = [
    { start: 0, end: 0.2, voiced: false }, { start: 0.2, end: 0.6, voiced: true },
    { start: 0.6, end: 0.9, voiced: false }, { start: 0.9, end: 1.7, voiced: true }
  ];
  const syllables = ['A', 'I', 'U', 'E', 'O', 'A'].map(vowel => ({ vowel, text: vowel }));
  const cues = distributeSyllables(syllables, regions);
  assert.deepEqual(cues.map(c => c.viseme), ['A', 'I', 'U', 'E', 'O', 'A']);
  assert.ok(cues.slice(0, 2).every(c => c.start >= 0.2 && c.end <= 0.6), 'first region takes 2 of 6');
  assert.ok(cues.slice(2).every(c => c.start >= 0.9 && c.end <= 1.7), 'last region takes the remaining 4');
  // Idle syllables take a slot but leave a gap.
  const withIdle = distributeSyllables([{ vowel: 'A', text: 'a' }, { vowel: null, text: 'n' }, { vowel: 'O', text: 'o' }], [{ start: 0, end: 0.9, voiced: true }]);
  assert.deepEqual(withIdle.map(c => [c.viseme, c.start, c.end]), [['A', 0, 0.3], ['O', 0.6, 0.9]]);
  // Repeated vowels beat instead of merging into one long open mouth.
  const repeat = distributeSyllables([{ vowel: 'A', text: 'a' }, { vowel: 'A', text: 'a' }], [{ start: 0, end: 0.4, voiced: true }]);
  assert.equal(repeat.length, 2);
  assert.ok(repeat[0].end < repeat[1].start);
  // An early long region never leaves a later region without syllables.
  const starved = distributeSyllables([{ vowel: 'A', text: 'a' }, { vowel: 'I', text: 'i' }, { vowel: 'U', text: 'u' }],
    [{ start: 0, end: 2, voiced: true }, { start: 2.5, end: 2.7, voiced: true }]);
  assert.ok(starved.some(c => c.start >= 2.5), JSON.stringify(starved));
});

test('alignTextToEnergy places Chinese syllables on the audio bursts', () => {
  const pcm = bursts([[0.1, 0.5], [0.8, 1.2]], 1.4);
  const cues = alignTextToEnergy('你好，再见', pcm, { language: 'zh-CN' });
  assert.deepEqual(cues.map(c => c.viseme), ['I', 'A', 'A', 'E']);
  assert.ok(cues[0].start >= 0.08 && cues[1].end <= 0.52);
  assert.ok(cues[2].start >= 0.78 && cues[3].end <= 1.22);
  assert.deepEqual(alignTextToEnergy('……', pcm), []);
  assert.deepEqual(alignTextToEnergy('你好', bursts([], 1)), []);
});

test('TTS without phonemes gets text + energy mouth cues; with phonemes keeps them', async () => {
  const project = createProject('t');
  const line = createLine(project, 'A', '你好，再见');
  project.lines.push(line);
  project.settings.speechLanguage = 'zh-CN';
  let phonemes;
  const tts = new TtsRegistry().register({ id: 'replaylab-free', label: 'fake', async synthesize() {
    return { audio: encodeWav(bursts([[0.1, 0.5], [0.8, 1.2]], 1.4, 24000)), mime: 'audio/wav', phonemes };
  } });
  const prepared = await prepareLineSpeech(project, line, { tts, synthesize: true, translate: false });
  assert.deepEqual(prepared.mouthCues.map(c => c.viseme), ['I', 'A', 'A', 'E']);
  phonemes = [{ start: 0, end: 0.2, phoneme: 'a' }];
  const timed = await prepareLineSpeech(project, line, { tts, synthesize: true, translate: false });
  assert.deepEqual(timed.mouthCues.map(c => c.viseme), ['A']);
  // Non-WAV audio cannot be decoded here: no cues, the renderer keeps its text rhythm.
  const mp3 = new TtsRegistry().register({ id: 'replaylab-free', label: 'fake', async synthesize() { return { audio: new Uint8Array([0xff, 0xfb, 0, 0]), mime: 'audio/mpeg' }; } });
  assert.equal((await prepareLineSpeech(project, line, { tts: mp3, synthesize: true, translate: false })).mouthCues, undefined);
});

test('schwa without its own mouth falls back to E, then A; OPEN falls back to A', () => {
  assert.equal(ENGLISH_VISEME_FALLBACK.SCHWA, 'E');
  const character = createCharacter('A');
  character.layers = { base: 'base', mouthClosed: 'closed', mouthA: 'mouthA', mouthE: 'mouthE' };
  assert.equal(selectCharacterLayers(character, 'default', 'SCHWA', false).mouth, 'mouthE');
  assert.equal(selectCharacterLayers(character, 'default', 'OPEN', false).mouth, 'mouthA');
  delete character.layers.mouthE;
  assert.equal(selectCharacterLayers(character, 'default', 'SCHWA', false).mouth, 'mouthA');
  assert.equal(selectCharacterLayers(character, 'default', 'M', false).mouth, 'closed');
});

test('studio line inspector offers text mouth generation and .lab / Rhubarb import', async () => {
  const html = fs.readFileSync(new URL('../web/studio.html', import.meta.url), 'utf8');
  for (const id of ['mouthFromText', 'mouthImportFile', 'mouthFileInput', 'mouthClear', 'mouthSensitivity']) assert.match(html, new RegExp(`id="${id}"`));
  const { mouthCuesFromTimingFile } = await import('../web/mouth-timing-controller.js');
  const lab = mouthCuesFromTimingFile('a.lab', '0 1000000 sil\n1000000 3000000 a\n3000000 4000000 N\n', 'ja');
  assert.deepEqual(lab.map(c => [c.start, c.end, c.viseme]), [[0, 0.1, 'SILENCE'], [0.1, 0.3, 'A'], [0.3, 0.4, 'CLOSED']]);
  const rhubarb = mouthCuesFromTimingFile('a.json', JSON.stringify({ mouthCues: [{ start: 0.2, end: 0.5, value: 'D' }] }));
  assert.deepEqual(rhubarb.map(c => [c.start, c.end, c.viseme]), [[0.2, 0.5, 'A']]);
});

test('gaze parameters move only the pupil layer; old rigs pick them up', async () => {
  const { normalizePuppetRig, evaluatePuppet, createCharacter: mk } = await import('../dist/index.js');
  const old = { layout: {}, parts: {}, parameters: [], expressionPresets: { 看左: { lookX: -1, lookY: 0.5 } } };
  const rig = normalizePuppetRig(old);
  assert.ok(rig.parameters.some(p => p.id === 'lookX') && rig.parameters.some(p => p.id === 'lookY'));
  const character = mk('A'); character.puppet = rig;
  const state = evaluatePuppet(character, '看左', 'SILENCE', false);
  assert.equal(state.parts.pupils.translateX, -0.03);
  assert.equal(state.parts.pupils.translateY, 0.009);
  assert.equal(state.parts.eyes.translateX, 0);
  assert.equal(evaluatePuppet(character, 'default', 'SILENCE', false).parts.pupils.translateX, 0);
});

test('studio workbench has a 立绘 page; character cards link to it instead of stacking sliders', () => {
  const html = fs.readFileSync(new URL('../web/studio.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../web/studio.js', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../web/portrait-workbench.js', import.meta.url), 'utf8');
  assert.match(html, /data-workbench-tab="portrait">立绘</);
  assert.match(html, /data-workbench-pane="portrait"/);
  assert.match(js, /'animation','portrait'\]/);
  assert.doesNotMatch(js, /data-puppet-param/);
  assert.match(js, /data-open-portrait/);
  for (const id of ['lookX', 'lookY', 'eyeSquash', 'browY', 'browAngle', 'mouthY', 'mouthTilt']) assert.match(page, new RegExp(`'${id}'`));
  assert.match(page, /data-gaze-pad/);
});
