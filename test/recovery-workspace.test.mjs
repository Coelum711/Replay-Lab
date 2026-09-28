import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryProjectWorkspace,TextImporter,WorkspaceConflictError} from '../dist/index.js';
import {backupBeforeRecovery} from '../web/recovery-workspace.js';

test('recovery retains an exact disk backup and refuses concurrent changes',async()=>{
  const ws=new MemoryProjectWorkspace(),draft=TextImporter.parse('Arthur: Recovered dialogue.');
  const older=structuredClone(draft);older.lines[0].text='Old dialogue.';
  await ws.saveProject(older);
  const raw=await (await ws.read('project.replaylab.json')).text(),loaded=await ws.loadProject();
  const path=await backupBeforeRecovery(ws,draft,loaded);
  assert.equal(await (await ws.read(path)).text(),raw);
  const write=ws.write.bind(ws);
  ws.write=async(path,...args)=>{await write(path,...args);if(path.startsWith('backups/'))await write('project.replaylab.json',JSON.stringify({...older,title:'Saved in another window'}));};
  await assert.rejects(backupBeforeRecovery(ws,draft,loaded),WorkspaceConflictError);
  assert.match(await (await ws.read('project.replaylab.json')).text(),/Saved in another window/);
  await assert.rejects(ws.saveProject(draft),WorkspaceConflictError);
});

test('reconnecting another project does not write a backup or modify either project',async()=>{
  const ws=new MemoryProjectWorkspace(),draft=TextImporter.parse('Arthur: Draft.'),other=TextImporter.parse('Other: Keep me.');
  await ws.saveProject(other);
  await assert.rejects(backupBeforeRecovery(ws,draft,await ws.loadProject()),/另一个工程/);
  assert.equal((await ws.list()).length,1);assert.equal((await ws.loadProject()).lines[0].text,'Keep me.');
  const empty=new MemoryProjectWorkspace();assert.equal(await backupBeforeRecovery(empty,draft,null),null);assert.equal((await empty.list()).length,0);
});
