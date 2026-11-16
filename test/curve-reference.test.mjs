import test from 'node:test';
import assert from 'node:assert/strict';
import {TextImporter,prepareLineSpeech,TtsRegistry} from '../dist/index.js';
import {profileLanguage,referenceAudio,withTemporaryReference} from '../web/reference-take.js';

function project(){
  const p=TextImporter.parse('Arthur: Original subtitles');p.settings.logLanguage='en';
  p.characters[0].voice={provider:'voicebox-local',voiceId:'arthur',modelSize:'1.7B',mode:'experimental-clone-instruct',instruct:'Calm and tired.'};
  return p;
}
const recorder=()=>{const calls=[];return {calls,tts:new TtsRegistry().register({id:'voicebox-local',label:'mock',synthesize:async r=>{calls.push(r);return {audio:new ArrayBuffer(44),mime:'audio/wav',duration:1};}})};};

test('reference re-record clones the reference profile in one piece, over the bound take',async()=>{
  const p=project(),l=p.lines[0];l.audioAssetId='take';p.assets.push({id:'take',kind:'voice',name:'Take',uri:'x'});
  l.speech={segments:[{text:'Original '},{text:'subtitles',speed:1.3}]};
  const {calls,tts}=recorder();
  const result=await prepareLineSpeech(p,l,{tts,synthesize:true,referenceVoiceId:'temp-ref'});
  assert.equal(calls.length,1,'segments are not split for a reference re-record');
  assert.equal(calls[0].voiceId,'temp-ref');assert.equal(calls[0].experimentalCloneInstruct,false);assert.equal(calls[0].text,'Original subtitles');
  assert.equal(result.audioSource,'external-tts');assert.ok(result.ttsResult);assert.equal(result.audioEdit,undefined);
  assert.equal(l.audioAssetId,'take');assert.equal(p.characters[0].voice.voiceId,'arthur','the character keeps its own voice');
});
test('reference re-record needs Voicebox and is not combined with the bridge curve path',async()=>{
  const p=project(),l=p.lines[0],{tts}=recorder();
  await assert.rejects(prepareLineSpeech(p,l,{tts,synthesize:true,referenceVoiceId:'r',prosodyReenactment:[{position:0,semitones:1},{position:1,semitones:1}]}),/不能同时/);
  p.characters[0].voice.provider='replaylab-free';
  await assert.rejects(prepareLineSpeech(p,l,{tts,synthesize:true,referenceVoiceId:'r'}),/Voicebox/);
});
test('the reference carries the curve: bent locally unless flat or already bent',async()=>{
  const blob=new Blob(['take']),curve=[{position:0,semitones:2},{position:1,semitones:2}],seen=[];
  const fineTune=async(b,decoded,c)=>{seen.push([b,decoded,c]);return new Blob(['bent']);};
  const decode=async()=>({duration:2});
  assert.equal(await referenceAudio(blob,curve,{flat:true,decode,fineTune}),blob);
  assert.equal(await referenceAudio(blob,curve,{flat:false,curveApplied:true,decode,fineTune}),blob);
  assert.equal(seen.length,0);
  const bent=await referenceAudio(blob,curve,{flat:false,decode,fineTune});
  assert.equal(await bent.text(),'bent');assert.deepEqual(seen[0][2],curve);
  await assert.rejects(referenceAudio(null,curve,{}),/读取失败/);
});
test('temporary profile is created, used, and deleted even when generation fails',async()=>{
  const log=[];let fail=false;
  const fetchImpl=async(url,options={})=>{
    const method=options.method||'GET';log.push(`${method} ${url.replace('http://vb','')}`);
    if(method==='POST'&&url.endsWith('/profiles'))return Response.json({id:'tmp 1'});
    if(method==='DELETE')return new Response(null,{status:fail?500:200});
    return Response.json({});
  };
  const base={audio:new Blob(['a']),text:'Hello',name:'Arthur·临时参考·第1行',language:'en-GB',baseUrl:'http://vb',fetchImpl,toWav:async()=>new File(['w'],'reference.wav')};
  assert.equal(await withTemporaryReference(base,async id=>{log.push(`use ${id}`);return 'take';}),'take');
  assert.deepEqual(log,['POST /profiles','POST /profiles/tmp%201/samples','use tmp 1','DELETE /profiles/tmp%201']);
  log.length=0;fail=true;let leftover=null;
  await assert.rejects(withTemporaryReference({...base,onLeftover:n=>{leftover=n;}},async()=>{throw new Error('generation broke');}),/generation broke/);
  assert.equal(log.at(-1),'DELETE /profiles/tmp%201');assert.equal(leftover,'Arthur·临时参考·第1行');
});
test('profile language is a bare code Voicebox knows',()=>{
  assert.equal(profileLanguage('en-GB'),'en');assert.equal(profileLanguage('zh_CN'),'zh');assert.equal(profileLanguage('auto'),'ja');assert.equal(profileLanguage(''),'ja');
});
