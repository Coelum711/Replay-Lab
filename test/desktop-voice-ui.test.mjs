import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {TextImporter} from '../dist/index.js';

test('full voice page boots without downloading models and connects live project/settings controls',async t=>{
  const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'http://localhost/web/index.html'}),w=dom.window;
  const keys=['window','document','location','CustomEvent','Event','localStorage'];const previous=new Map(keys.map(k=>[k,globalThis[k]]));
  for(const key of keys)globalThis[key]=w[key];
  w.replayDesktop={platform:'darwin',confirm:()=>true,onCommand(){},cancelFetch(){},localFetch:async()=>({ok:true,value:{status:200,headers:[['content-type','application/json']],data:new TextEncoder().encode('[]')}})};
  t.after(()=>{for(const [key,value] of previous)globalThis[key]=value;w.close();});
  await import('../web/app.js');await import('../web/desktop-ui.js');
  assert.equal(w.document.querySelectorAll('.character-card').length,0);
  const project=TextImporter.parse('Arthur: Hello');project.settings.logLanguage='en-GB';
  w.__connectReplayLabHost({owner:{closed:false,focus(){}},state:()=>({project,selectedLineId:project.lines[0].id}),assert(){},async changed(){return true;}});
  assert.equal(w.document.querySelectorAll('.character-card').length,1);
  assert.equal(w.document.getElementById('studioLinkCard').hidden,false);
  assert.equal(w.document.getElementById('speechLanguage').closest('dialog').id,'appSettingsDialog');
  const input=w.document.getElementById('speechLanguage');input.value='fr';input.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(project.settings.speechLanguage,'fr');
  assert.equal(w.document.getElementById('linePreview').textContent.includes('fr'),true);
  const search=w.document.getElementById('voiceCharacterSearch'),card=w.document.querySelector('.character-card');
  search.value='nobody';search.dispatchEvent(new w.Event('input'));
  assert.equal(card.hidden,true);assert.match(w.document.getElementById('voiceCharacterCount').textContent,/没有匹配角色/);
  w.document.getElementById('clearVoiceCharacterSearch').click();assert.equal(card.hidden,false);
  search.value='arthur';search.dispatchEvent(new w.Event('input'));assert.equal(card.hidden,false);
  assert.equal(w.document.querySelector('.character-card'),card,'search keeps the same settings controls and job feedback');
});
