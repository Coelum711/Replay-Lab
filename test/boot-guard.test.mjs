import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const script=await readFile(new URL('../web/boot-guard.js',import.meta.url),'utf8');
function setup(t){
  const dom=new JSDOM('<body><div id="bootGuard"></div></body>',{url:'replaylab://app/web/studio.html',runScripts:'outside-only'}),w=dom.window;
  const timers=[],logs=[];
  w.setTimeout=callback=>{timers.push(callback);return timers.length;};w.clearTimeout=()=>{};
  w.console.error=(...args)=>logs.push(args.join(' '));w.eval(script);t.after(()=>w.close());
  return {w,timers,logs,guard:w.document.getElementById('bootGuard')};
}
test('startup preserves the first actual error when the timeout or another error fires',t=>{
  const {w,timers,logs,guard}=setup(t);
  w.dispatchEvent(new w.ErrorEvent('error',{message:'Missing export <img src=x onerror=alert(1)>',filename:'replaylab://app/web/studio.js',lineno:42,colno:7}));
  timers[0]();w.dispatchEvent(new w.ErrorEvent('error',{message:'Secondary failure'}));
  assert.match(guard.textContent,/Missing export/);assert.match(guard.textContent,/studio.js:42:7/);
  assert.doesNotMatch(guard.textContent,/Secondary failure|仍未完成/);assert.equal(guard.querySelector('img'),null);
  assert.equal(logs.length,1);
});
test('desktop slow startup has relevant help and a later real error replaces the timeout',t=>{
  const {w,timers,guard}=setup(t);timers[0]();
  assert.match(guard.textContent,/视图 → 启动诊断/);assert.doesNotMatch(guard.textContent,/根目录启动器/);
  const event=new w.Event('unhandledrejection');Object.defineProperty(event,'reason',{value:new Error('Module unavailable')});w.dispatchEvent(event);
  assert.match(guard.textContent,/Module unavailable/);
});
test('successful startup remains usable even if the timeout was already queued',t=>{
  const {w,timers,guard}=setup(t);timers[0]();w.__replayLabMarkBootReady();timers[0]();
  assert.equal(guard.hidden,true);assert.equal(w.document.body.classList.contains('boot-blocked'),false);
});
