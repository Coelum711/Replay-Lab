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


function voiceboxMock({ profiles=[{ id:'p1', name:'A', language:'ja', voice_type:'cloned' }], generate, history }={}) {
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    const path=String(url);calls.push({path,method:options.method||'GET',body:options.body&&JSON.parse(options.body)});
    if(path.endsWith('/profiles'))return jsonResponse(profiles);
    if(path.endsWith('/cancel'))return jsonResponse({ok:true});
    if(path.endsWith('/generate'))return generate?generate(options):jsonResponse({id:'g1',status:'completed',duration:1});
    if(path.endsWith('/history/g1'))return history?history(options):jsonResponse({id:'g1',status:'completed',duration:1});
    if(path.endsWith('/audio/g1'))return new Response(new Uint8Array([1]),{headers:{'Content-Type':'audio/wav'}});
    throw new Error(`Unexpected URL ${path}`);
  };
  return {calls,fetchImpl,generated:()=>calls.find(c=>c.path.endsWith('/generate'))?.body};
}

test('Voicebox auto language follows the profile instead of defaulting to English', async()=>{
  const m=voiceboxMock();
  await new VoiceboxLocalTtsProvider({fetchImpl:m.fetchImpl}).synthesize({text:'x',voiceId:'p1'});
  assert.equal(m.generated().language,'ja');
});

test('Voicebox rejects unsupported languages before submitting and maps aliases', async()=>{
  const m=voiceboxMock();const provider=new VoiceboxLocalTtsProvider({fetchImpl:m.fetchImpl});
  await assert.rejects(provider.synthesize({text:'x',voiceId:'p1',language:'vi-VN'}),/不支持朗读语言/);
  assert.equal(m.generated(),undefined);
  await provider.synthesize({text:'x',voiceId:'p1',language:'nb-NO'});
  assert.equal(m.generated().language,'no');
});

test('Voicebox sends the engine a preset voice needs but leaves cloned voices alone', async()=>{
  const preset=voiceboxMock({profiles:[{id:'p1',language:'en',voice_type:'preset',preset_engine:'kokoro'}]});
  await new VoiceboxLocalTtsProvider({fetchImpl:preset.fetchImpl}).synthesize({text:'x',voiceId:'p1'});
  assert.equal(preset.generated().engine,'kokoro');
  const cloned=voiceboxMock();
  await new VoiceboxLocalTtsProvider({fetchImpl:cloned.fetchImpl}).synthesize({text:'x',voiceId:'p1'});
  assert.equal('engine' in cloned.generated(),false);
});

test('Voicebox explains deleted profiles, closed apps and mid-generation shutdowns', async()=>{
  const m=voiceboxMock({profiles:[]});
  await assert.rejects(new VoiceboxLocalTtsProvider({fetchImpl:m.fetchImpl}).synthesize({text:'x',voiceId:'p1'}),/Profile 已不存在/);
  const down=new VoiceboxLocalTtsProvider({fetchImpl:async()=>{throw new TypeError('fetch failed');}});
  await assert.rejects(down.synthesize({text:'x',voiceId:'p1'}),/连不上 Voicebox/);
  await assert.rejects(down.bridgeHealth(),/情绪桥没有启动/);
  const stopped=voiceboxMock({generate:()=>jsonResponse({id:'g1',status:'generating'}),history:()=>jsonResponse({id:'g1',status:'failed',error:'Server was shut down during generation'})});
  await assert.rejects(new VoiceboxLocalTtsProvider({fetchImpl:stopped.fetchImpl,pollIntervalMs:1}).synthesize({text:'x',voiceId:'p1'}),/生成途中被关闭/);
});

test('Voicebox surfaces validation detail instead of raw JSON', async()=>{
  const m=voiceboxMock({generate:()=>jsonResponse({detail:[{msg:'bad value'}]},422)});
  await assert.rejects(new VoiceboxLocalTtsProvider({fetchImpl:m.fetchImpl}).synthesize({text:'x',voiceId:'p1'}),/HTTP 422）：bad value$/);
});

test('aborting cancels the running Voicebox job so it stops occupying the queue', async()=>{
  const controller=new AbortController();
  const m=voiceboxMock({generate:()=>jsonResponse({id:'g1',status:'generating'}),history:()=>{controller.abort();return jsonResponse({id:'g1',status:'generating'});}});
  await assert.rejects(new VoiceboxLocalTtsProvider({fetchImpl:m.fetchImpl,pollIntervalMs:1}).synthesize({text:'x',voiceId:'p1',signal:controller.signal}));
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(m.calls.some(c=>c.path.endsWith('/generate/g1/cancel')&&c.method==='POST'));
});

test('a Voicebox timeout reports what to check and cancels the job', async()=>{
  const m=voiceboxMock({generate:()=>jsonResponse({id:'g1',status:'generating'}),history:()=>jsonResponse({id:'g1',status:'generating'})});
  await assert.rejects(new VoiceboxLocalTtsProvider({fetchImpl:m.fetchImpl,pollIntervalMs:1,timeoutMs:30}).synthesize({text:'x',voiceId:'p1'}),/仍未完成这句/);
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(m.calls.some(c=>c.path.endsWith('/generate/g1/cancel')));
});

const LONG_LINE='ふたりが別れたとき、言葉もなく、涙に濡れた。胸は半ば砕けたまま、幾年も、離ればなれに。';
function cutOffMock(durations,profile={id:'p1',language:'ja',voice_type:'cloned',sample_count:1}){
  let n=0;
  const m=voiceboxMock({profiles:[profile],generate:()=>jsonResponse({id:'g1',status:'completed',duration:durations[Math.min(n++,durations.length-1)]})});
  return {...m,count:()=>m.calls.filter(c=>c.path.endsWith('/generate')).length};
}

test('a cut-off Voicebox line is retried and the complete take is used', async()=>{
  const m=cutOffMock([1.1,1.5,6.5]);
  const result=await new VoiceboxLocalTtsProvider({fetchImpl:m.fetchImpl}).synthesize({text:LONG_LINE,voiceId:'p1',language:'ja'});
  assert.equal(result.duration,6.5);assert.equal(m.count(),3);
});

test('persistently cut-off lines are rejected and blame long multi-sample references', async()=>{
  const m=cutOffMock([1.1],{id:'p1',language:'ja',sample_count:3});
  await assert.rejects(new VoiceboxLocalTtsProvider({fetchImpl:m.fetchImpl}).synthesize({text:LONG_LINE,voiceId:'p1',language:'ja'}),/很可能没读完.*3 段参考样本/);
  assert.equal(m.count(),3);assert.equal(m.calls.some(c=>c.path.endsWith('/audio/g1')),false);
});

test('a fixed seed is not retried because it would repeat the same take', async()=>{
  const m=cutOffMock([1.1]);
  await assert.rejects(new VoiceboxLocalTtsProvider({fetchImpl:m.fetchImpl}).synthesize({text:LONG_LINE,voiceId:'p1',language:'ja',seed:4}),/固定了 Seed/);
  assert.equal(m.count(),1);
});

test('short interjections and normal lines are never treated as cut off', async()=>{
  for(const [text,duration] of [['えっ！',0.3],['Hello there my friend, how are you today?',2.2],[LONG_LINE,4.2]]){
    const m=cutOffMock([duration]);
    await new VoiceboxLocalTtsProvider({fetchImpl:m.fetchImpl}).synthesize({text,voiceId:'p1'});
    assert.equal(m.count(),1,text);
  }
});
