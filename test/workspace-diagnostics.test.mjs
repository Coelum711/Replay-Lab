import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseWorkspaceAssets} from '../web/workspace-diagnostics.js';

test('project diagnostics distinguish missing media from unreadable media',async()=>{
  const assets=[{id:'gone',name:'背景',sourcePath:'assets/gone.png'},
    {id:'denied',name:'配音',sourcePath:'assets/voice.wav'},
    {id:'ok',name:'人物',sourcePath:'assets/person.png'},
    {id:'remote',name:'外链',sourcePath:'https://example.org/image.png'}];
  const paths=[];
  const issues=await diagnoseWorkspaceAssets(assets,{async exists(path){paths.push(path);
    if(path==='assets/voice.wav')throw new DOMException('permission denied','NotAllowedError');
    return path==='assets/person.png';
  }});
  assert.deepEqual(paths,['assets/gone.png','assets/voice.wav','assets/person.png']);
  assert.deepEqual(issues.map(issue=>[issue.assetId,issue.code]),[
    ['gone','missing-workspace-file'],['denied','unreadable-workspace-file']]);
  assert.match(issues[1].message,/配音.*permission denied/);
});
