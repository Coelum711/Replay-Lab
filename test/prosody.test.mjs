import test from 'node:test';
import assert from 'node:assert/strict';
import {TextImporter,normalizeProsodyCurve,prosodyInstruction,prepareLineSpeech,TtsRegistry,VoiceboxLocalTtsProvider,generatedSpeechAsset,adoptGeneratedSpeechAsset,speechInputFingerprint} from '../dist/index.js';
import {processPitchCurve,encodePcmWav} from '../web/prosody-dsp.js';
import {fineTuneRecording} from '../web/prosody-audio.js';

const fixed=n=>[{position:0,semitones:n},{position:1,semitones:n}];
const tone=(sr,seconds=3,hz=220)=>Float32Array.from({length:sr*seconds},(_,i)=>.3*Math.sin(2*Math.PI*hz*i/sr));
const hz=(x,sr,start,end)=>{let n=0;for(let i=Math.floor(start*sr);i<end*sr;i++)if(x[i]>=0&&x[i-1]<0)n++;return n/(end-start);};
test('zero curve is an exact no-op for PCM and the original encoded Blob',async()=>{
 const x=tone(24000),[y]=processPitchCurve([x],24000,fixed(0));assert.deepEqual(y,x);assert.notEqual(y,x);
 const blob=new Blob(['original encoded bytes'],{type:'audio/mpeg'});assert.equal(await fineTuneRecording(blob,{},fixed(0)),blob);
 assert.equal(prosodyInstruction(fixed(0),'Hello'),'');assert.throws(()=>normalizeProsodyCurve([{position:NaN,semitones:1}]));
});
for(const sr of [24000,44100])for(const shift of [-2,2])test(`local pitch shifts ${shift} semitones at ${sr} Hz, retains length and ends`,()=>{
 const x=tone(sr),[y]=processPitchCurve([x],sr,fixed(shift));assert.equal(y.length,x.length);
 assert.ok(Math.abs(hz(y,sr,1,2)-220*2**(shift/12))<3);assert.ok(y.every(Number.isFinite));
 assert.deepEqual(y.slice(-Math.round(sr*.004)),x.slice(-Math.round(sr*.004)));
 const wav=encodePcmWav([y],sr),view=new DataView(wav);assert.equal(view.getUint32(40,true),x.length*2);assert.equal(view.getUint32(24,true),sr);
});
test('changing pitch crosses zero in both directions without losing stereo isolation',()=>{
 const sr=24000,x=tone(sr,4),curve=[{position:0,semitones:2},{position:.4,semitones:2},{position:.6,semitones:-2},{position:1,semitones:-2}];
 const [left,right]=processPitchCurve([x,new Float32Array(x.length)],sr,curve);
 assert.ok(Math.abs(hz(left,sr,.5,1.3)-247)<4);assert.ok(Math.abs(hz(left,sr,2.7,3.5)-196)<4);
 assert.ok(right.every(v=>v===0));assert.ok(left.every(Number.isFinite));
});
function project(){const p=TextImporter.parse('Arthur: Original subtitles');p.settings.logLanguage='en';p.characters[0].voice={provider:'voicebox-local',voiceId:'arthur',modelSize:'1.7B',mode:'experimental-clone-instruct',instruct:'Calm and tired.'};return p;}
test('curve reenactment uses spoken text, keeps clone/emotion and previews over imported audio without adoption',async()=>{
 const p=project(),l=p.lines[0];l.speech.textOverride='Bonjour mon ami';l.audioAssetId='original';p.assets.push({id:'original',kind:'voice',name:'Original',uri:'data:audio/wav;base64,AAAA'});
 let request;const tts=new TtsRegistry().register({id:'voicebox-local',label:'mock',synthesize:async r=>{request=r;return {audio:new ArrayBuffer(44),mime:'audio/wav',duration:1};}});
 const result=await prepareLineSpeech(p,l,{tts,synthesize:true,prosodyReenactment:fixed(2)});
 assert.equal(l.audioAssetId,'original');assert.equal(p.assets.length,1);assert.equal(request.text,'Bonjour mon ami');assert.match(request.instruct,/Calm and tired/);assert.match(request.instruct,/Bonjour/);assert.doesNotMatch(request.instruct,/Original subtitles/);
 assert.equal(request.voiceId,'arthur');assert.equal(request.experimentalCloneInstruct,true);assert.equal(result.audioEdit.kind,'curve-instruct');
 const asset=generatedSpeechAsset(p,l,result);assert.notEqual(asset.id,'original');adoptGeneratedSpeechAsset(p,l,asset);assert.equal(p.assets.length,2);assert.ok(p.assets.some(a=>a.id==='original'));
 assert.throws(()=>generatedSpeechAsset(p,l,result),/原录音已改变/);
});
test('draft curves do not affect ordinary generation; flat explicit curves add no instruction',async()=>{
 const p=project(),l=p.lines[0];l.speech.prosodyCurve=fixed(3);let request;
 const tts=new TtsRegistry().register({id:'voicebox-local',label:'mock',synthesize:async r=>{request=r;return {audio:new ArrayBuffer(44),mime:'audio/wav'};}});
 await prepareLineSpeech(p,l,{tts,synthesize:true});assert.equal(request.instruct,'Calm and tired.');
 await prepareLineSpeech(p,l,{tts,synthesize:true,prosodyReenactment:fixed(0)});assert.equal(request.instruct,'Calm and tired.');
 p.characters[0].voice.modelSize='0.6B';await assert.rejects(prepareLineSpeech(p,l,{tts,synthesize:true,prosodyReenactment:fixed(1)}),/1.7B/);
});
test('adoption rejects changed recording revisions and preserves each adopted version',()=>{
 const p=project(),l=p.lines[0];l.audioAssetId='orig';p.assets.push({id:'orig',kind:'voice',name:'Original',uri:'x',metadata:{contentRevision:'r1'}});
 const prepared={displayText:l.text,speechText:l.text,sourceLanguage:'en',targetLanguage:'en',audioSource:'external-tts',translated:false,inputFingerprint:speechInputFingerprint(p,l),audioEdit:{kind:'pitch-curve',curve:fixed(-1),sourceAssetId:'orig',sourceRevision:'r1'},ttsResult:{audio:new ArrayBuffer(44),mime:'audio/wav'}};
 p.assets[0].metadata.contentRevision='r2';assert.throws(()=>generatedSpeechAsset(p,l,prepared),/原录音已改变/);p.assets[0].metadata.contentRevision='r1';
 const a=generatedSpeechAsset(p,l,prepared);adoptGeneratedSpeechAsset(p,l,a);prepared.audioEdit.sourceAssetId=a.id;prepared.audioEdit.sourceRevision=a.metadata.contentRevision;
 const b=generatedSpeechAsset(p,l,prepared);adoptGeneratedSpeechAsset(p,l,b);assert.equal(new Set(p.assets.map(a=>a.id)).size,3);
});
test('cancelled experimental request and overlong direction are rejected before network',async()=>{
 let calls=0;const provider=new VoiceboxLocalTtsProvider({fetchImpl:async()=>{calls++;throw Error('network called');}});
 const request={text:'Hello',voiceId:'a',modelSize:'1.7B',experimentalCloneInstruct:true};const controller=new AbortController();controller.abort();
 await assert.rejects(provider.synthesize({...request,signal:controller.signal}),{name:'AbortError'});
 await assert.rejects(provider.synthesize({...request,instruct:'a'.repeat(2001)}),/2000/);assert.equal(calls,0);
});
test('curve request crosses the real Voicebox adapter as instruct with the selected cloned profile',async()=>{
 const p=project(),l=p.lines[0];let payload;
 const wav=encodePcmWav([new Float32Array(100)],24000);
 const provider=new VoiceboxLocalTtsProvider({fetchImpl:async(url,options)=>{
   if(url.endsWith('/health'))return Response.json({service:'replaylab-mlx-clone-bridge',protocol:1,ready:true,voicebox_url:'http://127.0.0.1:17493',capabilities:{clone_instruct:true,model_sizes:['1.7B']}});
   payload=JSON.parse(options.body);assert.ok(options.signal instanceof AbortSignal);
   return new Response(wav,{headers:{'Content-Type':'audio/wav','X-ReplayLab-Profile':'arthur','X-ReplayLab-Injected':'1','X-ReplayLab-Duration':'1'}});
 }});
 await prepareLineSpeech(p,l,{tts:new TtsRegistry().register(provider),synthesize:true,prosodyReenactment:[{position:0,semitones:0},{position:.125,semitones:2},{position:1,semitones:0}]});
 assert.equal(payload.profile_id,'arthur');assert.equal(payload.text,l.text);assert.match(payload.instruct,/13%.*raise 2.0/);assert.equal(payload.model_size,'1.7B');assert.equal(l.audioAssetId??null,null);
});
test('adopting a recording with a new timing reference clears obsolete timed mouths',()=>{
 const p=project(),l=p.lines[0];l.mouth='timed';l.mouthCues=[{start:0,end:1,value:'A'}];
 adoptGeneratedSpeechAsset(p,l,{id:'edited',kind:'voice',name:'edit',uri:'x',metadata:{audioEdit:{kind:'pitch-curve',resetMouthTiming:true}}});
 assert.equal(l.mouth,'auto');assert.equal(l.mouthCues,undefined);
});
