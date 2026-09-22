import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VoiceboxLocalTtsProvider, VOICEBOX_LOCAL_TTS_ID } from '../dist/index.js';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

test('Voicebox Local provider binds native fetch to its global receiver', async () => {
  const original = globalThis.fetch;
  let receiver = null;
  globalThis.fetch = function (url) {
    receiver = this;
    return Promise.resolve(jsonResponse({ status: 'ok' }));
  };
  try {
    const provider = new VoiceboxLocalTtsProvider({ baseUrl: '/bridge' });
    const health = await provider.health();
    assert.equal(health.status, 'ok');
    assert.equal(receiver, globalThis);
  } finally {
    globalThis.fetch = original;
  }
});

test('Voicebox profiles are ranked by language but never hidden', async () => {
  const profiles = [
    { id: 'fr', name: 'French voice', language: 'fr', voice_type: 'cloned', default_engine: 'chatterbox' },
    { id: 'zh', name: 'Chinese voice', language: 'zh', voice_type: 'preset', preset_engine: 'kokoro' },
    { id: 'en', name: 'English voice', language: 'en', voice_type: 'cloned', default_engine: 'qwen' },
  ];
  const provider = new VoiceboxLocalTtsProvider({
    fetchImpl: async url => {
      assert.match(String(url), /\/profiles$/);
      return jsonResponse(profiles);
    }
  });
  const voices = await provider.listVoices('zh-CN');
  assert.equal(voices.length, 3);
  assert.equal(voices[0].id, 'zh');
  assert.deepEqual(new Set(voices.map(v => v.id)), new Set(['fr', 'zh', 'en']));
});

test('Voicebox synthesis submits, polls and downloads generated audio', async () => {
  const calls = [];
  let polls = 0;
  const provider = new VoiceboxLocalTtsProvider({
    pollIntervalMs: 1,
    timeoutMs: 10_000,
    fetchImpl: async (url, options = {}) => {
      const path = String(url);
      calls.push([path, options.method || 'GET', options.body]);
      if (path.endsWith('/profiles')) return jsonResponse([{ id: 'p1', name: 'Arthur', language: 'en', voice_type: 'preset', preset_engine: 'kokoro' }]);
      if (path.endsWith('/generate')) {
        const body = JSON.parse(options.body);
        assert.equal(body.profile_id, 'p1');
        assert.equal(body.model_size, '0.6B');
        assert.equal(body.language, 'en');
        return jsonResponse({ id: 'g1', status: 'generating' });
      }
      if (path.endsWith('/history/g1')) {
        polls += 1;
        return jsonResponse(polls > 1 ? { id: 'g1', status: 'completed', duration: 1.25 } : { id: 'g1', status: 'generating' });
      }
      if (path.endsWith('/audio/g1')) return new Response(new Uint8Array([82,73,70,70]), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
      throw new Error(`Unexpected URL ${path}`);
    }
  });
  assert.equal(provider.id, VOICEBOX_LOCAL_TTS_ID);
  const result = await provider.synthesize({ text: 'Hello', voiceId: 'p1', language: 'en-GB' });
  assert.equal(result.mime, 'audio/wav');
  assert.equal(result.duration, 1.25);
  assert.ok(result.audio instanceof ArrayBuffer);
  assert.ok(calls.some(([path]) => path.endsWith('/audio/g1')));
});

test('launcher provides a narrow same-origin Voicebox bridge instead of relying on CORS', async () => {
  const launcher = await readFile(new URL('../launch_replay_lab.py', import.meta.url), 'utf8');
  assert.match(launcher, /VOICEBOX_ORIGIN = "http:\/\/127\.0\.0\.1:17493"/);
  assert.match(launcher, /\/__voicebox\/health/);
  assert.match(launcher, /\/__voicebox\/profiles/);
  assert.match(launcher, /\/__voicebox\/history\//);
  assert.match(launcher, /\/__voicebox\/audio\//);
  assert.match(launcher, /\/__voicebox\/generate/);
  assert.match(launcher, /Voicebox endpoint is not exposed by Replay Lab/);
  assert.doesNotMatch(launcher, /\/__voicebox\/shutdown/);
});

