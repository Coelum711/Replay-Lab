import test from 'node:test';
import assert from 'node:assert/strict';
import {TextImporter,TtsRegistry,TranslationRegistry,LibreTranslateProvider,VoiceboxLocalTtsProvider,
  prepareLineSpeech,prepareProjectSpeech,MemoryProjectWorkspace,BrowserFileSystemWorkspace,
  generatedSpeechAsset,adoptGeneratedSpeechAsset,persistAssetFile} from '../dist/index.js';

const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const project=()=>{const p=TextImporter.parse('Arthur: Hello');p.settings.logLanguage='en';p.settings.ttsProvider='mock';return p;};

test('candidate phonemes leave the adopted recording alone until adoption',async()=>{
  const p=project(),line=p.lines[0];
  p.assets.push({id:'old',kind:'voice',name:'old',metadata:{generated:true,generatedLineId:line.id}});
  line.audioAssetId='old';line.mouth='timed';line.mouthCues=[{start:0,end:2,viseme:'M'}];
  const before=structuredClone(line.mouthCues);
  const tts=new TtsRegistry().register({id:'mock',label:'mock',synthesize:async()=>({audio:new Uint8Array([1]),mime:'audio/wav',phonemes:[{start:0,end:.1,phoneme:'AE1'}]})});
  const prepared=await prepareLineSpeech(p,line,{tts,synthesize:true,regenerateGeneratedAudio:true});
  assert.deepEqual(line.mouthCues,before);
  adoptGeneratedSpeechAsset(p,line,generatedSpeechAsset(p,line,prepared));
  assert.deepEqual(line.mouthCues.map(c=>c.viseme),['AE']);
  const next={...prepared,mouthCues:undefined,ttsResult:{audio:new Uint8Array([2]),mime:'audio/wav'}};
  adoptGeneratedSpeechAsset(p,line,generatedSpeechAsset(p,line,next));
  assert.equal(line.mouthCues,undefined);assert.equal(line.mouth,'auto');
});

test('cancelled Voicebox job does not start any request',async()=>{
  const c=new AbortController();c.abort();let calls=0;
  const provider=new VoiceboxLocalTtsProvider({fetchImpl:async()=>{calls++;throw Error('network request');}});
  await assert.rejects(provider.synthesize({text:'Hello',voiceId:'p',signal:c.signal}),{name:'AbortError'});
  assert.equal(calls,0);
});
test('Voicebox cancellation stops polling and prevents audio adoption',async()=>{
  const c=new AbortController(),calls=[];
  const provider=new VoiceboxLocalTtsProvider({pollIntervalMs:0,fetchImpl:async url=>{
    calls.push(url);if(url.endsWith('/generate'))return json({id:'g',status:'generating'});
    if(url.includes('/history/')){c.abort();return json({status:'completed'});}
    return new Response(new Uint8Array([1]));
  }});
  await assert.rejects(provider.synthesize({text:'Hello',voiceId:'p',signal:c.signal}),{name:'AbortError'});
  assert.equal(calls.some(url=>url.includes('/audio/')),false);
});
test('Voicebox rejects a history record without a status',async()=>{
  const provider=new VoiceboxLocalTtsProvider({pollIntervalMs:0,fetchImpl:async url=>url.endsWith('/generate')?json({id:'g'}):json({})});
  await assert.rejects(provider.synthesize({text:'Hello',voiceId:'p'}),/status|状态/i);
});

test('translation and batch cancellation stop before caching or starting TTS',async()=>{
  const p=project();p.settings.speechLanguage='fr';p.settings.translationProvider='mock';const line=p.lines[0],c=new AbortController();let speechCalls=0;
  const translations=new TranslationRegistry().register({id:'mock',label:'m',translate:async request=>{assert.equal(request.signal,c.signal);c.abort();return {text:'Bonjour'};}});
  const tts=new TtsRegistry().register({id:'mock',label:'m',synthesize:async()=>{speechCalls++;return {audio:new Uint8Array([1]),mime:'audio/wav'};}});
  await assert.rejects(prepareLineSpeech(p,line,{signal:c.signal,translations,tts,synthesize:true}),{name:'AbortError'});
  assert.equal(line.speech.translationCache,undefined);assert.equal(speechCalls,0);
  await assert.rejects(prepareProjectSpeech(p,{signal:c.signal,tts,synthesize:true}),{name:'AbortError'});
});
test('invalid batch concurrency still processes every selected line',async()=>{
  const p=project();let completed=0;
  const results=await prepareProjectSpeech(p,{concurrency:NaN,onProgress:()=>completed++});
  assert.equal(completed,1);assert.equal(results[0].displayText,'Hello');
});
test('LibreTranslate binds native fetch to its receiver and forwards cancellation',async t=>{
  const previous=globalThis.fetch,c=new AbortController();t.after(()=>{globalThis.fetch=previous;});
  globalThis.fetch=async function(url,options){assert.equal(this,globalThis);assert.ok(options.signal);return json({translatedText:'Bonjour'});};
  assert.equal((await new LibreTranslateProvider().translate({text:'Hello',targetLanguage:'fr',signal:c.signal})).text,'Bonjour');
});

test('failed asset replacement preserves previous file and manifest binding',async()=>{
  const p=project(),ws=new MemoryProjectWorkspace();
  const asset={id:'a',kind:'background',name:'room',sourcePath:'assets/room.png',uri:'project://assets/room.png'};p.assets.push(asset);
  await ws.write(asset.sourcePath,'old');await ws.saveProject(p);const before=structuredClone(asset);
  ws.saveProject=async()=>{throw Error('disk full');};
  await assert.rejects(persistAssetFile(ws,p,asset,'new',asset.sourcePath),/disk full/);
  assert.deepEqual(asset,before);assert.equal(await(await ws.read(before.sourcePath)).text(),'old');
});
test('browser file write aborts its stream on failure',async()=>{
  let aborted=0,closed=0;
  const root={name:'test',getFileHandle:async()=>({createWritable:async()=>({write:async()=>{throw Error('disk full');},close:async()=>closed++,abort:async()=>aborted++})})};
  await assert.rejects(new BrowserFileSystemWorkspace(root).write('a.txt','text'),/disk full/);
  assert.equal(aborted,1);assert.equal(closed,0);
});
test('browser permission errors propagate instead of appearing as missing files',async()=>{
  const root={name:'test',getFileHandle:async()=>{throw new DOMException('denied','NotAllowedError');}};
  await assert.rejects(new BrowserFileSystemWorkspace(root).loadProject(),{name:'NotAllowedError'});
});
