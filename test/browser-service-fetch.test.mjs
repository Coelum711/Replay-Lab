import test from 'node:test';
import assert from 'node:assert/strict';

test('browser Voicebox uses launcher proxy and preserves request options', async t => {
  const keys=['window','location','fetch'];
  const previous=new Map(keys.map(k=>[k,globalThis[k]]));
  t.after(()=>{for(const [key,value] of previous) { if(value===undefined)delete globalThis[key];else globalThis[key]=value; }});
  globalThis.window={};
  globalThis.location=new URL('http://127.0.0.1:8765/web/index.html');
  const calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response('{}');};
  const {serviceFetch}=await import('../web/desktop-client.js');
  const options={method:'POST',body:'{"text":"hello"}',signal:new AbortController().signal};
  await serviceFetch('http://localhost:17493/generate',options);
  assert.equal(calls[0].url,'/__voicebox/generate');
  assert.equal(calls[0].options,options);
  await serviceFetch('http://127.0.0.1:17494/health');
  assert.equal(calls[1].url,'http://127.0.0.1:17494/health');
  globalThis.location=new URL('https://example.com/web/index.html');
  await serviceFetch('http://127.0.0.1:17493/health');
  assert.equal(calls[2].url,'http://127.0.0.1:17493/health');
});
