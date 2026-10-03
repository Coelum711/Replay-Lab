import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('desktop home navigation, recent project selection and moved settings retain event bindings',async t=>{
  const dom=new JSDOM(await readFile(new URL('../web/studio.html',import.meta.url),'utf8'),{url:'http://localhost/web/studio.html'}),w=dom.window;
  const keys=['window','document','location','CustomEvent','Event'];const previous=new Map(keys.map(k=>[k,globalThis[k]]));
  for(const key of keys)globalThis[key]=w[key];
  w.replayDesktop={platform:'darwin',confirm:()=>true,recent:async()=>({ok:true,value:[{id:'recent-one',label:'测试工程',updatedAt:0}]}),onCommand(){}};
  t.after(()=>{for(const [key,value] of previous)globalThis[key]=value;w.close();});
  const $=id=>w.document.getElementById(id);let openId,language;
  w.document.addEventListener('replaylab:open-recent',e=>openId=e.detail);
  $('projectSpeechLanguage').addEventListener('change',e=>language=e.target.value);
  await import('../web/desktop-ui.js');await new Promise(r=>setTimeout(r,0));
  assert.equal(w.document.querySelectorAll('.recent-project').length,1);
  w.document.querySelector('.recent-project').click();assert.equal(openId,'recent-one');
  w.document.dispatchEvent(new w.CustomEvent('replaylab:project-state',{detail:{connected:true,title:'测试工程',hasContent:true}}));
  assert.equal($('studioHome').hidden,true);assert.equal(w.document.body.classList.contains('home-visible'),false);
  $('appHome').click();assert.equal($('studioHome').hidden,false);
  assert.equal($('projectSpeechLanguage').closest('dialog').id,'appSettingsDialog');
  $('projectSpeechLanguage').value='fr';$('projectSpeechLanguage').dispatchEvent(new w.Event('change'));assert.equal(language,'fr');
  $('appEditor').click();assert.equal($('studioHome').hidden,true);
});
