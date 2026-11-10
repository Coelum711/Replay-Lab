import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,TextImporter,normalizeReplayProject,createCustomObject,compilePerformance,
  buildAudioSchedule,accentSynthesisHint,resolveCharacterAccent,resolveSpeechPolicy,prepareLineSpeech,
  prepareProjectSpeech,TranslationRegistry,TtsRegistry,MemoryProjectWorkspace,persistGeneratedSpeech,
  PROJECT_MANIFEST_PATH,applyTemplate,BUILTIN_TEMPLATES,audioEnvelopePoints,BrowserReplayPlayer,VoiceboxLocalTtsProvider} from '../dist/index.js';
import {ProjectLinkHost} from '../web/project-link.js';
import {createExportSession} from '../web/export-session.js';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function english(){const p=TextImporter.parse('Arthur: Hello');p.settings.logLanguage='en-GB';return p;}

test('new project audio defaults are isolated, including nested ducking',()=>{
  const a=createProject(),b=createProject();a.settings.audioMix.ducking.bgmGain=.01;
  a.settings.audioMix.voiceVolume=0;
  assert.notEqual(b.settings.audioMix.ducking.bgmGain,.01);
  assert.equal(b.settings.audioMix.voiceVolume,1);
  assert.equal(createProject().settings.audioMix.voiceVolume,1);
});
test('zero volume and zero object position survive scheduling and normalization',()=>{
  const p=english(),l=p.lines[0];l.audioAssetId='v';l.sfxAssetId='s';l.audioMix={voiceGain:0,sfxGain:0};
  p.customObjects=[createCustomObject()];p.customObjects[0].transform.x=0;p.customObjects[0].transform.y=0;
  normalizeReplayProject(p);
  assert.equal(p.customObjects[0].transform.x,0);assert.equal(p.customObjects[0].transform.y,0);
  assert.ok(buildAudioSchedule(compilePerformance(p)).every(event=>event.volume===0));
});
test('an older project inherits later changes to Log language',()=>{
  const p=english();delete p.settings.speechLanguage;normalizeReplayProject(p);
  p.settings.logLanguage='fr';assert.equal(resolveSpeechPolicy(p,p.lines[0]).targetLanguage,'fr');
});
test('explicitly disabling all accent rules does not restore defaults',()=>{
  const p=english();p.characters[0].speech.accents={auto:{accentId:'en-gb-rp',query:'London',enabledRuleIds:[]}};
  const resolved=resolveCharacterAccent(p.characters[0],'en-GB');assert.ok(resolved);
  assert.deepEqual(accentSynthesisHint(resolved).pronunciationHints,[]);
  assert.deepEqual(accentSynthesisHint(resolved).prosodyHints,[]);
});
test('line voice ID override retains inherited provider/model/mode',()=>{
  const p=english();p.characters[0].speech.voices={'en-GB':{provider:'voicebox-local',modelSize:'1.7B',mode:'experimental-clone-instruct',voiceId:'a'}};
  p.lines[0].speech.voice={voiceId:'b'};const r=resolveSpeechPolicy(p,p.lines[0]);
  assert.equal(r.ttsProvider,'voicebox-local');assert.equal(r.voice.modelSize,'1.7B');assert.equal(r.voice.voiceId,'b');
});
test('imported audio requires neither a translator nor TTS; command lines are skipped',async()=>{
  const p=english();p.settings.speechLanguage='fr';p.lines[0].audioAssetId='v';
  p.assets.push({id:'v',kind:'voice',name:'manual'});
  assert.equal((await prepareLineSpeech(p,p.lines[0],{synthesize:true})).audioSource,'imported');
  p.lines[0].type='command';p.lines[0].audioAssetId=null;
  assert.deepEqual(await prepareProjectSpeech(p,{synthesize:true}),[]);
});
test('late translation cannot cache an old sentence under edited text',async()=>{
  const p=english();p.settings.speechLanguage='fr';p.settings.translationProvider='mock';
  const d=deferred();const translations=new TranslationRegistry().register({id:'mock',label:'m',translate:()=>d.promise});
  const pending=prepareLineSpeech(p,p.lines[0],{translations});
  p.lines[0].text='Changed';d.resolve({text:'Bonjour'});
  await assert.rejects(pending,{code:'stale-speech'});assert.equal(p.lines[0].speech.translationCache,undefined);
});
test('detected language does not freeze an authored source override; changing provider invalidates cache',async()=>{
  const p=english();p.settings.logLanguage='auto';p.settings.speechLanguage='fr';p.settings.translationProvider='a';
  let count=0;const translations=new TranslationRegistry();
  for(const id of ['a','b'])translations.register({id,label:id,async translate(){count++;return {text:id,detectedSourceLanguage:'en'};}});
  await prepareLineSpeech(p,p.lines[0],{translations});await prepareLineSpeech(p,p.lines[0],{translations});
  assert.equal(count,1);assert.equal(p.lines[0].speech.sourceLanguage,null);
  p.settings.translationProvider='b';await prepareLineSpeech(p,p.lines[0],{translations});
  assert.equal(count,2);assert.equal(p.lines[0].speech.translationCache.text,'b');
});
test('late TTS cannot overwrite settings or phoneme cues after a character change',async()=>{
  const p=english();p.settings.ttsProvider='mock';const d=deferred();
  const tts=new TtsRegistry().register({id:'mock',label:'m',synthesize:()=>d.promise});
  const pending=prepareLineSpeech(p,p.lines[0],{tts,synthesize:true});
  p.characters[0].speech.voices={'en-GB':{voiceId:'different'}};
  d.resolve({audio:new Uint8Array([1]),mime:'audio/wav',phonemes:[{start:0,end:.2,phoneme:'A'}]});
  await assert.rejects(pending,{code:'stale-speech'});assert.equal(p.lines[0].mouth,'auto');
});
test('batch errors wait for running workers and stop launching more lines',async()=>{
  const p=TextImporter.parse('Arthur: first\nArthur: second\nArthur: third');p.settings.logLanguage='en-GB';p.settings.ttsProvider='m';
  const d=deferred(),started=[],done=[];
  const tts=new TtsRegistry().register({id:'m',label:'m',async synthesize(r){started.push(r.text);if(r.text==='first')throw Error('fail');return d.promise;}});
  let settled=false;const task=prepareProjectSpeech(p,{tts,synthesize:true,concurrency:2,onProgress:(_c,_t,l)=>done.push(l.text)});
  const rejection=assert.rejects(task,/fail/).then(()=>{settled=true});
  await new Promise(r=>setTimeout(r,5));assert.equal(settled,false);
  d.resolve({audio:new Uint8Array([1]),mime:'audio/wav'});await rejection;
  assert.deepEqual(started,['first','second']);assert.deepEqual(done,['second']);
});
test('overlapping saves serialize captured snapshots instead of racing writes',async()=>{
  const p=english(),ws=new MemoryProjectWorkspace(),write=ws.write.bind(ws);let active=0,peak=0;
  ws.write=async(...args)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,3));await write(...args);active--;};
  p.title='first';const first=ws.saveProject(p);p.title='second';const second=ws.saveProject(p);
  await Promise.all([first,second]);assert.equal(peak,1);assert.equal((await ws.loadProject()).title,'second');
});
test('failed audio regeneration preserves previous file, asset and line binding',async()=>{
  const p=english(),l=p.lines[0],ws=new MemoryProjectWorkspace();
  const prepared={displayText:'Hello',speechText:'Hello',sourceLanguage:'en-GB',targetLanguage:'en-GB',translated:false,audioSource:'external-tts',ttsResult:{audio:new Uint8Array([1]),mime:'audio/wav'}};
  await persistGeneratedSpeech(ws,p,l,prepared);const asset=structuredClone(p.assets[0]),id=l.audioAssetId;
  ws.saveProject=async()=>{throw Error('disk failure')};
  await assert.rejects(()=>persistGeneratedSpeech(ws,p,l,{...prepared,ttsResult:{audio:new Uint8Array([2]),mime:'audio/wav'}}),/disk failure/);
  assert.deepEqual(p.assets[0],asset);assert.equal(l.audioAssetId,id);
  assert.deepEqual(new Uint8Array(await(await ws.read(asset.sourcePath)).arrayBuffer()),new Uint8Array([1]));
  const disk=JSON.parse(await(await ws.read(PROJECT_MANIFEST_PATH)).text());assert.equal(disk.assets[0].sourcePath,asset.sourcePath);
});
test('template BGM change reaches the audio mixer used by playback',()=>{
  const p=english();applyTemplate(p,BUILTIN_TEMPLATES.find(t=>t.id==='horror-investigation'));
  assert.equal(p.settings.audioMix.bgmVolume,.18);
});

test('linked voice edits and audio adoption preserve live Studio stage changes',async()=>{
  const p=english(),ws=new MemoryProjectWorkspace(),files=new Map();
  const host=new ProjectLinkHost({owner:{closed:false},getProject:()=>p,getWorkspace:()=>ws,getSelectedLineId:()=>p.lines[0].id,
    putAudio:(id,blob)=>files.set(id,blob),onChanged:async()=>{await ws.saveProject(p);return true;}});
  assert.equal(host.state().project,p);
  p.settings.maxVisibleCharacters=7;p.characters[0].speech.defaultLanguage='fr';
  const prepared={displayText:'Hello',speechText:'Bonjour',sourceLanguage:'en',targetLanguage:'fr',ttsResult:{audio:new Uint8Array([1]),mime:'audio/wav'}};
  const result=await host.adopt(p,p.lines[0],prepared);
  assert.equal(result.saved,true);assert.equal(p.settings.maxVisibleCharacters,7);assert.ok(files.has(p.lines[0].audioAssetId));
  const saved=await ws.loadProject();assert.equal(saved.settings.maxVisibleCharacters,7);assert.equal(saved.characters[0].speech.defaultLanguage,'fr');
});
test('linked host rejects a switched project while retaining the old draft on save failure',async()=>{
  const p=english();let current=p;
  const host=new ProjectLinkHost({owner:{closed:false},getProject:()=>current,getWorkspace:()=>null,getSelectedLineId:()=>p.lines[0].id,putAudio(){},onChanged:()=>true});
  current=english();await assert.rejects(()=>host.changed(p),{code:'stale-speech'});
  current=p;const ws=new MemoryProjectWorkspace();host.getWorkspace=()=>ws;host.onChanged=()=>false;
  const result=await host.adopt(p,p.lines[0],{displayText:'Hello',speechText:'Hello',ttsResult:{audio:new Uint8Array([1]),mime:'audio/wav'}});
  assert.equal(result.saved,false);assert.ok(p.lines[0].audioAssetId);
});
test('linked host reports a project switch during asynchronous save',async()=>{
  const p=english();let current=p;
  const host=new ProjectLinkHost({owner:{closed:false},getProject:()=>current,getWorkspace:()=>null,
    getSelectedLineId:()=>p.lines[0].id,putAudio(){},onChanged:async()=>{current=english();return true;}});
  await assert.rejects(()=>host.changed(p,true),{code:'stale-speech'});
});
test('export captures stage settings and asset revisions independently of later edits',async()=>{
  const p=english();p.assets.push({id:'v',kind:'voice',sourcePath:'old.wav'});p.lines[0].audioAssetId='v';
  const files=new Map([['v',new Blob(['old'])]]),perf=compilePerformance(p);
  const session=createExportSession({project:p,performance:perf,workspace:null,files,width:1920,height:1080,createCanvas:()=>({}),createRenderer:o=>o,createPlayer:(perf,renderer,resolve)=>({perf,renderer,resolve})});
  p.assets[0].sourcePath='new.wav';p.settings.audioMix.voiceVolume=0;perf.lines[0].text='Changed';files.set('v',new Blob(['new']));
  assert.equal(session.performance.settings.audioMix.voiceVolume,1);assert.notEqual(session.performance.lines[0].text,'Changed');
  assert.equal(await(await session.player.resolve('v')).text(),'old');assert.equal(session.player.renderer.canvas.width,1920);
});
test('ducking multiplies crossfades and does not react to muted dialogue',()=>{
  const p=english();p.lines[0].audioAssetId='v';const perf=compilePerformance(p);
  perf.duration=4;perf.lines[0].start=0;perf.lines[0].end=2;
  const event={assetId:'bgm',kind:'bgm',start:0,end:4,volume:1,fadeIn:2,fadeOut:2,loop:true,pan:0};
  const points=audioEnvelopePoints(event,0,perf);
  assert.equal(points[0].value,0);assert.equal(points.at(-1).value,0);
  assert.ok(points.find(point=>point.time===2).value<1);
  const resumed=audioEnvelopePoints(event,1,perf);assert.ok(resumed[0].value<.5);
  perf.lines[0].audioMix={voiceGain:0};assert.equal(audioEnvelopePoints(event,1,perf)[0].value,.5);
});
test('stop during audio loading prevents sources from being started afterwards',async()=>{
  const p=english();p.lines[0].audioAssetId='v';const d=deferred();
  const player=new BrowserReplayPlayer(compilePerformance(p),{},()=>d.promise);
  const context={currentTime:0,destination:{},decodeAudioData:async()=>({duration:1}),createGain(){assert.fail('stale audio was scheduled');}};
  player.context=async()=>context;
  const task=player.playAll();await new Promise(r=>setTimeout(r,0));player.stop();d.resolve(new Uint8Array([1]));await task;
});
test('Voicebox sends the same 0.6B default displayed by the voice controls',async()=>{
  let body;
  const provider=new VoiceboxLocalTtsProvider({baseUrl:'http://localhost:17493',fetchImpl:async(url,options)=>{
    if(String(url).endsWith('/generate')){body=JSON.parse(options.body);return new Response(JSON.stringify({id:'job',status:'completed',audio_path:'/audio.wav'}));}
    return new Response(new Uint8Array([1]),{headers:{'content-type':'audio/wav'}});
  }});
  await provider.synthesize({text:'Hello',language:'en',voiceId:'profile'});
  assert.equal(body.model_size,'0.6B');
});
