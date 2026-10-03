import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {TextImporter, compilePerformance, TranslationRegistry, LibreTranslateProvider} from '../dist/index.js';

const source=await readFile(new URL('../web/app.js',import.meta.url),'utf8');
function section(start,end){return source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));}

test('voice preview compilation leaves authored stage and language settings untouched',()=>{
  const project=TextImporter.parse('Arthur: Stay back.');
  project.settings.logLanguage='en-GB';project.settings.speechLanguage='fr';
  project.settings.maxVisibleCharacters=7;
  const before=JSON.stringify(project), elements={};
  vm.runInNewContext(section('function compile()','\n// Observe authoring')+';compile();',{
    project, compilePerformance, REPLAYLAB_FREE_TTS_ID:'replaylab-free', renderLinePreview(){},
    $:id=>elements[id]??={}, applyTemplate:()=>assert.fail('no template side effect'),
  });
  assert.equal(JSON.stringify(project),before);
  assert.ok(elements['#output'].textContent.length>0);
});

test('building a translation registry preserves a custom project provider',()=>{
  const project={settings:{translationProvider:'my-provider'}}, before=JSON.stringify(project);
  const registry=vm.runInNewContext(section('function buildTranslationRegistry()','async function synthesizeLine')+';buildTranslationRegistry();',{
    project,TranslationRegistry,LibreTranslateProvider,serviceFetch:()=>{},$:()=>({value:'http://localhost:5000'})
  });
  assert.equal(JSON.stringify(project),before);
  assert.ok(registry.get('libretranslate'));
});
