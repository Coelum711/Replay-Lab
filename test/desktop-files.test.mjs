import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {WorkspaceFiles} from '../desktop/files.mjs';
import {appResource,localRequest,safeExternal} from '../desktop/policy.mjs';
import {DesktopProjectWorkspace,TextImporter} from '../dist/index.js';

async function setup(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'replay-desktop-'));const broker=new WorkspaceFiles();const grant=await broker.grant(root);t.after(async()=>{await broker.dispose();await fs.rm(root,{recursive:true,force:true});});return {root,broker,id:grant.id};}
test('native workspace rejects paths and symlinks outside its selected directory',async t=>{
  const {root,broker,id}=await setup(t);
  for(const relative of ['../outside','/tmp/outside','C:\\temp\\x','a/../../outside'])await assert.rejects(()=>broker.write(id,relative,'bad'));
  await fs.symlink(os.tmpdir(),path.join(root,'escape'));await assert.rejects(()=>broker.write(id,'escape/unsafe','bad'),/目录外/);
  await assert.rejects(()=>broker.remove(id,''));
});
test('native binary replacement is committed atomically and abort preserves previous bytes',async t=>{
  const {broker,id}=await setup(t);await broker.write(id,'assets/voice/test.wav',new Uint8Array([1,2]));
  const token=await broker.openWrite(id,'assets/voice/test.wav');await broker.chunk(token,new Uint8Array([3,4]));
  assert.deepEqual([...await broker.read(id,'assets/voice/test.wav')],[1,2]);await broker.abort(token);
  assert.deepEqual([...await broker.read(id,'assets/voice/test.wav')],[1,2]);
});
test('streamed export supports seek/overwrite and retains unmodified bytes',async t=>{
  const {broker,id}=await setup(t);const token=await broker.openWrite(id,'exports/movie.mp4');
  await broker.chunk(token,new Uint8Array([0,1,2,3]));await broker.chunk(token,{type:'write',position:1,data:new Uint8Array([9])});await broker.close(token);
  assert.deepEqual([...await broker.read(id,'exports/movie.mp4')],[0,9,2,3]);
});
test('native truncate moves a cursor beyond EOF back to the new end',async t=>{
  const {broker,id}=await setup(t),token=await broker.openWrite(id,'exports/truncated.mp4');
  await broker.chunk(token,new Uint8Array([1,2,3,4]));
  await broker.chunk(token,{type:'truncate',size:2});
  await broker.chunk(token,new Uint8Array([9]));await broker.close(token);
  assert.deepEqual([...await broker.read(id,'exports/truncated.mp4')],[1,2,9]);
});
test('parallel first writes can create the same character directory',async t=>{
  const {broker,id}=await setup(t);
  await Promise.all(Array.from({length:8},(_,i)=>broker.write(id,`assets/voice/new-character/${i}.wav`,String(i))));
  assert.equal((await broker.list(id,'assets/voice/new-character')).length,8);
});
test('native manifests reject stale writers including other grants of the same root',async t=>{
  const {root,broker,id}=await setup(t);const other=await broker.grant(root);
  const first=await broker.save(id,'{"title":"first"}',null);
  const results=await Promise.allSettled([broker.save(id,'{"title":"second"}',first),broker.save(other.id,'{"title":"stale"}',first)]);
  assert.equal(results[0].status,'fulfilled');assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.code,'workspace-project-conflict');
  assert.equal(JSON.parse(new TextDecoder().decode(await broker.read(id,'project.replaylab.json'))).title,'second');
});
test('workspace adapter saves and reloads through the native broker',async t=>{
  const {broker,id}=await setup(t);const previous=globalThis.replayDesktop;
  globalThis.replayDesktop={workspace:async({action,relative,data,expected})=>{try{return {ok:true,value:await ({exists:()=>broker.exists(id,relative),read:()=>broker.read(id,relative),save:()=>broker.save(id,data,expected),check:()=>broker.check(id,expected),write:()=>broker.write(id,relative,data)})[action]()};}catch(error){return {ok:false,error:{code:error.code,name:error.name,message:error.message}};}}};
  t.after(()=>{globalThis.replayDesktop=previous;});
  const workspace=new DesktopProjectWorkspace(id,'test');assert.equal(await workspace.loadProject(),null);
  const project=TextImporter.parse('Arthur: Hello');await workspace.saveProject(project);
  assert.equal((await workspace.loadProject()).lines[0].text,'Hello');
  await broker.write(id,'project.replaylab.json','{}');await assert.rejects(()=>workspace.saveProject(project),{code:'workspace-project-conflict'});
});
test('custom app protocol only exposes distribution resources',()=>{
  assert.equal(appResource('replaylab://app/web/studio.html','/app'),'/app/web/studio.html');
  for(const url of ['replaylab://other/web/studio.html','replaylab://app/desktop/main.cjs','replaylab://app/package.json','replaylab://app/web/%2e%2e%2f../secret'])assert.throws(()=>appResource(url,'/app'));
});
test('native local API relay rejects external hosts, credentials, redirects and arbitrary paths',()=>{
  assert.equal(localRequest('http://127.0.0.1:17493/profiles'),'http://127.0.0.1:17493/profiles');
  for(const url of ['https://example.com/generate','http://user:password@127.0.0.1/generate','file:///etc/passwd','http://127.0.0.1/admin','http://169.254.169.254/health'])assert.throws(()=>localRequest(url));
  assert.equal(safeExternal('javascript:alert(1)'),false);assert.equal(safeExternal('https://github.com'),true);
});
