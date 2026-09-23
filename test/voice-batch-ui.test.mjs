import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {TextImporter} from '../dist/index.js';
import {ProjectLinkHost} from '../web/project-link.js';

test('character batch displays the failing line/provider beside its button, retains earlier audio, and distinguishes a save failure',async t=>{
  const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'http://localhost/web/index.html'}),w=dom.window;
  const keys=['window','document','location','CustomEvent','Event','localStorage'],previous=new Map(keys.map(k=>[k,globalThis[k]]));for(const k of keys)globalThis[k]=w[k];
  const json=(status,value)=>({ok:true,value:{status,headers:[['content-type','application/json']],data:new TextEncoder().encode(JSON.stringify(value))}});
  let calls=0,failGeneration=true;
  w.replayDesktop={platform:'darwin',confirm:()=>true,onCommand(){},cancelFetch(){},async localFetch(request){
    const path=new URL(request.url).pathname;
    if(path==='/profiles')return json(200,[{id:'arthur',name:'Arthur',language:'en'}]);
    if(path==='/generate'){calls++;if(calls===2&&failGeneration)return json(500,{detail:'test backend failure'});return json(200,{id:`take-${calls}`,status:'completed',duration:1})}
    if(path.startsWith('/audio/'))return {ok:true,value:{status:200,headers:[['content-type','audio/wav']],data:new Uint8Array(100)}};
    throw Error('Unexpected request '+path);
  }};
  t.after(async()=>{await new Promise(r=>setTimeout(r,220));w.close();for(const [k,v] of previous)globalThis[k]=v});
  await import('../web/app.js');
  const p=TextImporter.parse('Arthur: First\nArthur: Second\nArthur: Third');p.settings.logLanguage='en';p.settings.speechLanguage='en';p.settings.ttsProvider='voicebox-local';p.characters[0].speech.voices.en={provider:'voicebox-local',voiceId:'arthur',modelSize:'0.6B'};
  const blobs=new Map(),host=new ProjectLinkHost({owner:{closed:false,focus(){}},getProject:()=>p,getWorkspace:()=>null,getSelectedLineId:()=>p.lines[0].id,putAudio:(id,blob)=>blobs.set(id,blob),readAudio:()=>null,onChanged:async()=>true});
  w.__connectReplayLabHost(host);
  const button=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='一键生成该角色语音');
  const settle=async()=>{for(let i=0;i<100&&button.disabled;i++)await new Promise(r=>setTimeout(r,5));assert.equal(button.disabled,false)};
  button.click();await settle();
  const report=w.document.querySelector('.voice-batch-report');assert.match(report.textContent,/第 2 句/);assert.match(report.textContent,/voicebox-local/);assert.match(report.textContent,/0.6B/);assert.match(report.textContent,/test backend failure/);
  assert.equal(calls,2);assert.equal(blobs.size,1);assert.ok(p.lines[0].audioAssetId);assert.equal(p.lines[1].audioAssetId,null);
  failGeneration=false;host.adopt=async()=>{throw Error('test disk full')};button.click();await settle();
  assert.match(report.textContent,/第 1 句 · 保存失败/);assert.match(report.textContent,/test disk full/);assert.equal(w.document.getElementById('downloadLineAudio').disabled,false,'generated audio remains downloadable after failed disk adoption');
  const next=structuredClone(p);next.id='new-project';next.lines.forEach(line=>{line.audioAssetId=null;});next.assets=[];
  host.getProject=()=>next;w.__connectReplayLabHost(host);
  assert.equal(w.document.getElementById('downloadLineAudio').disabled,true);
  const single=w.document.getElementById('synthLine');single.click();
  for(let i=0;i<100&&single.disabled;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(single.disabled,false);
  assert.match(w.document.getElementById('status').textContent,/test disk full/);
  assert.equal(w.document.getElementById('downloadLineAudio').disabled,false,'single-line result also survives failed disk adoption');
});
