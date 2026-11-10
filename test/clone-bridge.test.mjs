import test from 'node:test';
import assert from 'node:assert/strict';
import {mockWav} from './helpers/wav.mjs';
import {VoiceboxLocalTtsProvider, TextImporter, resolveSpeechPolicy, prepareLineSpeech, TtsRegistry} from '../dist/index.js';

const health = {service:'replaylab-mlx-clone-bridge',protocol:1,ready:true,voicebox_url:'http://127.0.0.1:17493',capabilities:{clone_instruct:true,model_sizes:['1.7B']}};
const request = {voiceId:'clone-1',text:'Keep still.',modelSize:'1.7B',experimentalCloneInstruct:true,instruct:'Quietly.'};

test('experimental bridge URL cannot send script text outside loopback',async()=>{
  for (const bridgeUrl of ['http://example.com','http://u:p@127.0.0.1:17494','http://127.0.0.1:17494/path']) {
    const provider=new VoiceboxLocalTtsProvider({bridgeUrl,fetchImpl:async()=>assert.fail('no request expected')});
    await assert.rejects(()=>provider.synthesize(request),/本机/);
  }
});

test('WAV duration is required and passed through for accurate timeline timing',async()=>{
  let duration='1.25', bytes=mockWav();
  const provider=new VoiceboxLocalTtsProvider({fetchImpl:async(url)=>url.endsWith('/health')
    ?new Response(JSON.stringify(health)):new Response(bytes,{headers:{'content-type':'audio/wav','X-ReplayLab-Profile':'clone-1','X-ReplayLab-Injected':'1','X-ReplayLab-Duration':duration}})});
  assert.equal((await provider.synthesize(request)).duration,1.25);
  for (const invalid of ['', 'NaN', '0', '-1']) {duration=invalid;await assert.rejects(()=>provider.synthesize(request),/时长/);}
  duration='1.25';bytes=new Uint8Array(48);await assert.rejects(()=>provider.synthesize(request),/WAV/);
});

for (const [label,status] of [['stock',{}],['not ready',{...health,ready:false}],['wrong version',{...health,protocol:2}],['wrong Voicebox',{...health,voicebox_url:'http://127.0.0.1:9000'}]]) {
  test(`bridge rejects ${label} without any generation or fallback`, async()=>{
    const calls=[];
    const p = new VoiceboxLocalTtsProvider({fetchImpl:async (url,init)=>{calls.push(init?.method||'GET');return new Response(JSON.stringify(status));}});
    await assert.rejects(()=>p.synthesize(request));
    assert.deepEqual(calls,['GET']);
  });
}
test('0.6B instruction requests are rejected before network/download',async()=>{
  const p=new VoiceboxLocalTtsProvider({fetchImpl:async()=>assert.fail('no network expected')});
  await assert.rejects(()=>p.synthesize({...request,modelSize:'0.6B'}),/1.7B/);
});
test('bridge failure never falls back to a Voicebox preset',async()=>{
  const calls=[];
  const p=new VoiceboxLocalTtsProvider({fetchImpl:async(url)=>{calls.push(url);return url.endsWith('/health')?new Response(JSON.stringify(health)):new Response('busy',{status:409});}});
  await assert.rejects(()=>p.synthesize(request),/busy/);
  assert.equal(calls.length,2); assert.ok(calls.every(x=>x.includes(':17494/')));
});
test('wrong returned profile / missing injection confirmation rejects the audio',async()=>{
  const p=new VoiceboxLocalTtsProvider({fetchImpl:async(url)=>url.endsWith('/health')?new Response(JSON.stringify(health)):new Response(new Uint8Array(48),{headers:{'content-type':'audio/wav','X-ReplayLab-Profile':'preset-ryan'}})});
  await assert.rejects(()=>p.synthesize(request),/注入/);
});
test('accent is a separate instruction, never added to spoken text; off really disables it',async()=>{
  let body;
  const p=new VoiceboxLocalTtsProvider({fetchImpl:async(url,init)=>{
    if(url.endsWith('/health'))return new Response(JSON.stringify(health));
    body=JSON.parse(init.body);
    return new Response(mockWav(),{headers:{'content-type':'audio/wav','X-ReplayLab-Profile':'clone-1','X-ReplayLab-Injected':'1','X-ReplayLab-Duration':String(2/24000)}});
  }});
  await p.synthesize({...request,accent:{query:'London',strength:'natural',pronunciationHints:['non-rhotic'],prosodyHints:['gentle cadence']}});
  assert.equal(body.text,request.text); assert.match(body.instruct,/London.*non-rhotic.*gentle cadence/);
  await p.synthesize({...request,accent:{query:'London',strength:'off'}});
  assert.equal(body.instruct,'Quietly.');
});
test('line acting overrides remain separate from live character profile inheritance',async()=>{
  const p=TextImporter.parse('Arthur: hello');p.settings.logLanguage='en';
  const c=p.characters[0],l=p.lines[0];
  c.speech.voices={en:{provider:'mock',voiceId:'one',mode:'experimental-clone-instruct',modelSize:'1.7B',instruct:'Happy',seed:42}};
  l.speech.acting={instruct:'Sad',actingPreset:''};
  let received;
  await prepareLineSpeech(p,l,{synthesize:true,tts:new TtsRegistry().register({id:'mock',label:'mock',async synthesize(r){received=r;return {audio:new Uint8Array(48),mime:'audio/wav'};}})});
  assert.equal(received.instruct,'Sad');assert.equal(received.seed,42);assert.equal(received.experimentalCloneInstruct,true);
  c.speech.voices.en.voiceId='two';assert.equal(resolveSpeechPolicy(p,l).voice.voiceId,'two');
  delete l.speech.acting;assert.equal(resolveSpeechPolicy(p,l).voice.instruct,'Happy');
});
test('auto is inheritance across all language levels; auto voice slot remains reusable',()=>{
  const p=TextImporter.parse('Arthur: hello');p.settings.logLanguage='en-GB';p.settings.speechLanguage='auto';
  const c=p.characters[0],l=p.lines[0];c.speech.defaultLanguage='auto';l.speech.languageOverride='auto';
  c.speech.voices={auto:{provider:'voicebox-local',voiceId:'one'}};
  assert.equal(resolveSpeechPolicy(p,l).targetLanguage,'en-GB');assert.equal(resolveSpeechPolicy(p,l).voice.voiceId,'one');
});
