import test from 'node:test';
import assert from 'node:assert/strict';
import { StoryScriptImporter, TtsRegistry, prepareLineSpeech, resolveSpeechPolicy, splitSpeechSegments, activeSegments,
  decodeWav, encodeWav, timeStretch, trimSilence, joinSegments, speechInputFingerprint } from '../dist/index.js';

const tone = (seconds, hz = 220, rate = 24000, lead = 0.1) => {
  const total = Math.round(rate * (seconds + lead * 2)), samples = new Float32Array(total);
  for (let i = Math.round(rate * lead); i < total - Math.round(rate * lead); i++) samples[i] = 0.5 * Math.sin(2 * Math.PI * hz * i / rate);
  return { sampleRate: rate, samples };
};
const crossings = samples => { let n = 0; for (let i = 1; i < samples.length; i++) if ((samples[i - 1] < 0) !== (samples[i] < 0)) n++; return n; };

test('spoken text splits after punctuation and short pieces merge', () => {
  assert.deepEqual(splitSpeechSegments('おい！！お兄さんのヒゲを引っ張らないでよ！放せって眉毛野郎！').map(s => s.text),
    ['おい！！', 'お兄さんのヒゲを引っ張らないでよ！', '放せって眉毛野郎！']);
  assert.deepEqual(splitSpeechSegments('あ、そう。').map(s => s.text), ['あ、そう。']);
  const line = { text: 'x', speech: { segments: [{ text: 'おい！' }, { text: 'やめろ' }] } };
  assert.equal(activeSegments(line, 'おい！ やめろ').length, 2);
  assert.throws(() => activeSegments(line, '別の文'), /重新分段/);
  assert.equal(activeSegments({ text: 'x' }, 'abc'), null);
});

test('wav round trip, silence trim, pitch-keeping stretch and join', () => {
  const pcm = tone(1);
  const back = decodeWav(encodeWav(pcm));
  assert.equal(back.sampleRate, 24000);
  assert.equal(back.samples.length, pcm.samples.length);
  const trimmed = trimSilence(back);
  assert.ok(trimmed.samples.length < back.samples.length && trimmed.samples.length > 24000 * 0.95);
  const slow = timeStretch(trimmed, 0.7), fast = timeStretch(trimmed, 1.3);
  assert.ok(Math.abs(slow.samples.length / trimmed.samples.length - 1 / 0.7) < 0.05, 'slower is longer');
  assert.ok(Math.abs(fast.samples.length / trimmed.samples.length - 1 / 1.3) < 0.05, 'faster is shorter');
  const pitch = p => crossings(p.samples) / (p.samples.length / p.sampleRate);
  assert.ok(Math.abs(pitch(slow) / pitch(trimmed) - 1) < 0.08, 'pitch unchanged when slowed');
  assert.ok(Math.abs(pitch(fast) / pitch(trimmed) - 1) < 0.08, 'pitch unchanged when sped up');
  const joined = joinSegments([{ pcm: tone(0.5), pauseAfter: 0.4 }, { pcm: tone(0.5) }]);
  assert.equal(joined.samples.length, tone(0.5).samples.length * 2 + Math.round(24000 * 0.4));
});

test('a segmented line is voiced part by part with its own tone, speed and pause', async () => {
  const project = StoryScriptImporter.parse('弗朗西斯：喂！！不要揪我的胡子啊！', { title: 't' });
  const francis = project.characters.find(c => c.name === '弗朗西斯');
  francis.speech = { ...francis.speech, ttsProvider: 'voicebox-local', voices: { ja: { provider: 'voicebox-local', voiceId: 'v', mode: 'auto' } }, defaultLanguage: 'ja' };
  const line = project.lines[0];
  line.speech = { ...line.speech, textOverride: 'おい！！ヒゲを引っ張らないでよ！', segments: [{ text: 'おい！！', instruct: 'yelling', pauseAfter: 0.3 }, { text: 'ヒゲを引っ張らないでよ！', speed: 0.85 }] };
  assert.equal(resolveSpeechPolicy(project, line).voice.mode, 'experimental-clone-instruct', 'a toned segment sends auto to the bridge');
  const requests = [];
  const tts = new TtsRegistry().register({ id: 'voicebox-local', label: 'fake', async synthesize(req) {
    requests.push(req);
    return { audio: encodeWav(tone(Array.from(req.text).length * 0.1)), mime: 'audio/wav' };
  } });
  const before = speechInputFingerprint(project, line);
  const prepared = await prepareLineSpeech(project, line, { tts, synthesize: true, translate: false });
  assert.deepEqual(requests.map(r => r.text.replace(/\s/g, '')), ['おい！！', 'ヒゲを引っ張らないでよ！']);
  assert.match(requests[0].instruct, /yelling/);
  assert.doesNotMatch(requests[1].instruct || '', /yelling/, 'tone stays on its own segment');
  const expected = 0.4 + 0.08 + 0.3 + (1.2 + 0.08) / 0.85; // trimmed parts keep 40 ms margins
  assert.ok(Math.abs(prepared.ttsResult.duration - expected) < 0.12, `duration ${prepared.ttsResult.duration} vs ${expected}`);
  assert.equal(prepared.ttsResult.mime, 'audio/wav');
  line.speech.segments[1].speed = 1.15;
  assert.notEqual(speechInputFingerprint(project, line), before, 'editing segments invalidates the old take');
});
