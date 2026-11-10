import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createProsodyEditor} from '../web/prosody-editor.js';

test('curve editor keeps generation and adoption explicit; late results cannot land on a different line',async t=>{
 const dom=new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'),{url:'http://localhost/web/index.html'}),w=dom.window;
 const previous={window:globalThis.window,document:globalThis.document};globalThis.window=w;globalThis.document=w.document;
 w.HTMLMediaElement.prototype.play=async()=>{};w.HTMLMediaElement.prototype.pause=()=>{};
 t.after(()=>{globalThis.window=previous.window;globalThis.document=previous.document;w.close();});
 const a={id:'a',text:'Hello',speech:{}},b={id:'b',text:'Goodbye',speech:{}},project={lines:[a,b]};let line=a,calls=0,adoptions=0,resolveGeneration;
 const blob=new Blob(['wav'],{type:'audio/wav'});
 const api={context:()=>({project,line,fingerprint:line.text,canReenact:true,spokenText:line.text}),isBusy:()=>false,changed(){},audio:async()=>blob,
   decode:async()=>({channels:[new Float32Array(100)],sampleRate:24000,duration:1}),fineTune:async()=>blob,
   generate:async()=>{calls++;return new Promise(r=>{resolveGeneration=r;});},adopt:async()=>{adoptions++;},download:async()=>{}};
 const editor=createProsodyEditor(api);editor.refresh();const $=id=>w.document.getElementById(id),click=id=>$(id).click();
 const tick=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
 assert.equal($('prosodyCurve').querySelectorAll('circle').length,9);assert.equal(a.speech.prosodyCurve,undefined);
 $('prosodyPosition').value='1';$('prosodyPosition').dispatchEvent(new w.Event('change'));
 $('prosodyAmount').value='2';$('prosodyAmount').dispatchEvent(new w.Event('input'));
 assert.equal(a.speech.prosodyCurve[1].semitones,2);assert.equal(calls,0);assert.match($('prosodyPrompt').textContent,/13%.*raise 2.0/);
 click('prosodyLoad');await tick();assert.equal($('prosodyTake').options.length,1);
 click('prosodyFineTune');await tick();assert.equal($('prosodyTake').options.length,2);assert.equal(adoptions,0);assert.equal(calls,0);
 click('prosodyAdopt');await tick();assert.equal(adoptions,1);
 click('prosodyReenact');await tick();assert.equal(calls,1);assert.equal(adoptions,1);
 line=b;editor.refresh();resolveGeneration({ttsResult:{audio:blob,mime:'audio/wav'}});await tick();
 assert.equal($('prosodyTake').options.length,0);assert.match($('prosodyStatus').textContent,/已改变/);assert.equal(adoptions,1);
 line=a;editor.refresh();assert.equal($('prosodyTake').options.length,2);assert.equal($('prosodyAudio').hidden,false);
 click('prosodyReset');assert.ok(a.speech.prosodyCurve.every(p=>p.semitones===0));assert.equal(calls,1);
});
