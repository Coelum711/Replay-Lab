import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject,
  createCharacter,
  createLine,
  ensureCharacter,
  suggestCharacterDuplicates,
  planCharacterMerge,
  mergeCharacters,
  planFacePackageBindings,
  diagnoseProject,
  reimportScriptPreservingSetup,
  collectScriptCharacterIds
} from '../dist/index.js';

test('0.34 duplicate suggestions catch normalized names and confirmed aliases but not arbitrary translations', () => {
  const project=createProject('identity');
  const a=createCharacter('Arthur');
  const b=createCharacter(' arthur ');
  const c=createCharacter('马修');
  const d=createCharacter('Matthew');
  project.characters.push(a,b,c,d);
  let suggestions=suggestCharacterDuplicates(project);
  assert.ok(suggestions.some(item => new Set([item.keepId,item.mergeId]).has(a.id) && new Set([item.keepId,item.mergeId]).has(b.id)));
  assert.equal(suggestions.some(item => new Set([item.keepId,item.mergeId]).has(c.id) && new Set([item.keepId,item.mergeId]).has(d.id)), false);
  d.aliases=['马修'];
  suggestions=suggestCharacterDuplicates(project);
  assert.ok(suggestions.some(item => new Set([item.keepId,item.mergeId]).has(c.id) && new Set([item.keepId,item.mergeId]).has(d.id)));
});

test('0.34 character merge reassigns dialogue and stage references, preserves old name as alias, and only fills empty art slots', () => {
  const project=createProject('merge');
  const keep=createCharacter('马修');
  const source=createCharacter('Matthew');
  keep.layers.base='keep-base';
  source.layers.base='source-base';
  source.layers.browLeft='source-brow';
  project.characters.push(keep,source);
  const line=createLine(project,'Matthew','hello');
  line.stageMode='custom';
  line.stageIds=[source.id];
  line.stagePositions={ [source.id]:'left' };
  line.scene={ enterIds:[source.id], exitIds:[] };
  project.lines.push(line);
  const result=mergeCharacters(project,keep.id,source.id);
  assert.equal(project.characters.length,1);
  assert.equal(project.lines[0].speakerId,keep.id);
  assert.deepEqual(project.lines[0].stageIds,[keep.id]);
  assert.equal(project.lines[0].stagePositions[keep.id],'left');
  assert.deepEqual(project.lines[0].scene.enterIds,[keep.id]);
  assert.ok(keep.aliases.includes('Matthew'));
  assert.equal(keep.layers.base,'keep-base');
  assert.equal(keep.layers.browLeft,'source-brow');
  assert.ok(result.conflicts.includes('layers.base'));
});

test('0.34 ensureCharacter reuses a confirmed alias instead of creating a duplicate', () => {
  const project=createProject('alias');
  const matthew=createCharacter('马修');
  matthew.aliases=['Matthew'];
  project.characters.push(matthew);
  const found=ensureCharacter(project,'Matthew');
  assert.equal(found.id,matthew.id);
  assert.equal(project.characters.length,1);
});

test('0.34 face-package routing respects aliases and treats shared aliases as ambiguous', () => {
  const chars=[
    {id:'m',name:'马修',aliases:['Matthew']},
    {id:'a',name:'Arthur',aliases:[]}
  ];
  const plan=planFacePackageBindings(['faces/Matthew/base.png'],chars);
  assert.equal(plan.items[0].targetKind,'character');
  assert.equal(plan.items[0].targetId,'m');
  const ambiguous=planFacePackageBindings(['faces/Matthew/base.png'],[
    {id:'m',name:'马修',aliases:['Matthew']},
    {id:'x',name:'Matt',aliases:['Matthew']}
  ]);
  assert.equal(ambiguous.items[0].targetKind,'unresolved');
});

test('0.34 diagnostics warn on alias-driven duplicate identities', () => {
  const project=createProject('diag');
  const a=createCharacter('马修');
  const b=createCharacter('Matthew');
  b.aliases=['马修'];
  project.characters.push(a,b);
  const issues=diagnoseProject(project);
  assert.ok(issues.some(issue => issue.code==='ambiguous-character-alias' && /角色身份可能重复/.test(issue.message)));
});

test('0.38 ambiguous aliases never silently steal a newly imported speaker', () => {
  const project=createProject('ambiguous');
  const a=createCharacter('马修A');a.aliases=['Matthew'];
  const b=createCharacter('马修B');b.aliases=['Matthew'];
  project.characters.push(a,b);
  const created=ensureCharacter(project,'Matthew');
  assert.notEqual(created.id,a.id);
  assert.notEqual(created.id,b.id);
  assert.equal(created.name,'Matthew');
  assert.equal(project.characters.length,3);
});

test('0.38 exact primary name wins over another character alias with the same text', () => {
  const project=createProject('primary-wins');
  const primary=createCharacter('Arthur');
  const other=createCharacter('亚瑟');other.aliases=['Arthur'];
  project.characters.push(other,primary);
  assert.equal(ensureCharacter(project,'Arthur').id,primary.id);
  assert.equal(project.characters.length,2);
});

test('0.38 script reimport preserves art, aliases, speech and templates while replacing lines', () => {
  const current=createProject('current');
  const matthew=createCharacter('马修');
  matthew.aliases=['Matthew'];
  matthew.layers.base='asset-base';
  matthew.speech={defaultLanguage:'en-GB',pauseScale:1.4,voices:{}};
  current.characters.push(matthew);
  current.assets.push({id:'asset-base',kind:'character',name:'matthew.png'});
  current.faceTemplates.push({id:'tpl',name:'common',layers:{mouthClosed:'mouth'}});
  matthew.faceFit.templateId='tpl';
  current.lines.push(createLine(current,'马修','old'));

  const imported=createProject('incoming');
  imported.lines.push(createLine(imported,'Matthew','new line'));
  imported.lines.push(createLine(imported,'Arthur','hello'));

  const {project,report}=reimportScriptPreservingSetup(current,imported);
  const kept=project.characters.find(c=>c.id===matthew.id);
  assert.equal(project.lines.length,2);
  assert.equal(project.lines[0].speakerId,matthew.id);
  assert.equal(project.lines[0].text,'new line');
  assert.equal(kept.layers.base,'asset-base');
  assert.equal(kept.speech.pauseScale,1.4);
  assert.equal(kept.faceFit.templateId,'tpl');
  assert.equal(project.assets.length,1);
  assert.equal(project.faceTemplates.length,1);
  assert.equal(report.reusedCharacters,1);
  assert.equal(report.createdCharacters,1);
  assert.equal(report.unusedRetainedCharacters,0);
});


test('0.39 script reimport reports retained old characters that are absent from the new script', () => {
  const current=createProject('current');
  current.characters.push(createCharacter('Arthur'),createCharacter('Francis'));
  const imported=createProject('incoming');
  imported.lines.push(createLine(imported,'Arthur','new'));
  const {project,report}=reimportScriptPreservingSetup(current,imported);
  assert.equal(project.characters.length,2,'old character setup should be retained');
  assert.equal(report.unusedRetainedCharacters,1);
});

test('0.38 script reimport materializes ambiguous alias as a new visible character instead of misrouting lines', () => {
  const current=createProject('current');
  const a=createCharacter('A');a.aliases=['Matthew'];
  const b=createCharacter('B');b.aliases=['Matthew'];
  current.characters.push(a,b);
  const imported=createProject('incoming');
  imported.lines.push(createLine(imported,'Matthew','ambiguous'));
  const {project,report}=reimportScriptPreservingSetup(current,imported);
  const speaker=project.characters.find(c=>c.id===project.lines[0].speakerId);
  assert.equal(speaker.name,'Matthew');
  assert.deepEqual(report.ambiguousNames,['Matthew']);
});


test('0.39 merge preview is pure and matches the eventual merge impact', () => {
  const project=createProject('plan');
  const keep=createCharacter('马修');
  const source=createCharacter('Matthew');
  source.layers.base='source-base';
  keep.speech={pauseScale:1,voices:{}};source.speech={pauseScale:2,voices:{}};
  project.characters.push(keep,source);
  project.lines.push(createLine(project,'Matthew','hello'));
  const before=structuredClone(project);
  const plan=planCharacterMerge(project,keep.id,source.id);
  assert.deepEqual(project,before,'planning must not mutate the project');
  assert.equal(plan.linesReassigned,1);
  assert.ok(plan.filled.includes('layers.base'));
  assert.ok(plan.conflictGroups.some(group=>group.id==='speech'));
  const result=mergeCharacters(project,keep.id,source.id);
  assert.equal(result.linesReassigned,plan.linesReassigned);
  assert.deepEqual(result.conflicts,plan.conflicts);
  assert.deepEqual(result.filled,plan.filled);
});

test('0.38 character merge preserves source pause scale when target inherits and rewrites generated-voice metadata', () => {
  const project=createProject('merge-speech');
  const keep=createCharacter('马修');
  const source=createCharacter('Matthew');
  keep.speech={defaultLanguage:'en-GB',voices:{}};
  source.speech={defaultLanguage:'en-GB',pauseScale:1.6,voices:{}};
  project.characters.push(keep,source);
  project.assets.push({id:'voice',kind:'voice',name:'old',metadata:{generated:true,characterId:source.id,generatedLineId:'line'}});
  const result=mergeCharacters(project,keep.id,source.id);
  assert.equal(keep.speech.pauseScale,1.6);
  assert.equal(project.assets[0].metadata.characterId,keep.id);
  assert.equal(result.assetMetadataReassigned,1);
});

test('0.38 character merge surfaces meaningful role, pause, default-position and same-line stage conflicts', () => {
  const project=createProject('merge-conflicts');
  const keep=createCharacter('A');
  const source=createCharacter('B');
  keep.kind='normal';source.kind='npc';
  keep.showOnStage=true;source.showOnStage=false;
  keep.defaultPosition='left';source.defaultPosition='right';
  keep.speech={pauseScale:1,voices:{}};source.speech={pauseScale:2,voices:{}};
  project.characters.push(keep,source);
  const line=createLine(project,'A','x');
  line.stageMode='custom';line.stageIds=[keep.id,source.id];line.stagePositions={[keep.id]:'left',[source.id]:'right'};
  project.lines.push(line);
  const result=mergeCharacters(project,keep.id,source.id);
  for(const conflict of ['kind','showOnStage','defaultPosition','speech.pauseScale','stagePositions']) assert.ok(result.conflicts.includes(conflict),conflict);
});


test('0.40 current-script character collection includes speaker and stage references but not retained setup-only characters', () => {
  const project=createProject('used-characters');
  const a=createCharacter('A'), b=createCharacter('B'), retained=createCharacter('Retained');
  project.characters.push(a,b,retained);
  const line=createLine(project,'A','hello');
  line.stageIds=[b.id];
  project.lines.push(line);
  assert.deepEqual([...collectScriptCharacterIds(project)].sort(),[a.id,b.id].sort());
});

test('0.40 script reimport keeps authored performance on unchanged lines across inserted Log lines', () => {
  const current=createProject('current');
  current.lines.push(createLine(current,'Arthur','first'));
  const kept=createLine(current,'Matthew','keep me');
  kept.expression='angry';
  kept.duration=3.2;
  kept.audioAssetId='voice-keep';
  kept.sfxAssetId='door';
  kept.stageMode='custom';
  const matthew=current.characters.find(c=>c.name==='Matthew');
  kept.stageIds=[matthew.id];
  kept.stagePositions={[matthew.id]:'right'};
  kept.scene={background:'room',bgm:'tension',camera:'focus-speaker',transition:'fade'};
  current.lines.push(kept);
  current.lines.push(createLine(current,'Arthur','last'));

  const imported=createProject('incoming');
  imported.lines.push(createLine(imported,'Arthur','inserted'));
  imported.lines.push(createLine(imported,'Arthur','first'));
  imported.lines.push(createLine(imported,'Matthew','keep me'));
  imported.lines.push(createLine(imported,'Arthur','last'));

  const {project,report}=reimportScriptPreservingSetup(current,imported);
  const line=project.lines.find(item=>item.text==='keep me');
  assert.equal(line.id,kept.id,'stable line id should survive unchanged-source reimport');
  assert.equal(line.expression,'angry');
  assert.equal(line.duration,3.2);
  assert.equal(line.audioAssetId,'voice-keep');
  assert.equal(line.sfxAssetId,'door');
  assert.equal(line.stageMode,'custom');
  assert.equal(line.scene.background,'room');
  assert.equal(line.scene.bgm,'tension');
  assert.equal(report.reusedLineAuthoring,3);
});

test('0.40 script reimport does not copy authored performance onto a changed source line', () => {
  const current=createProject('current');
  const line=createLine(current,'Arthur','old wording');
  line.expression='angry';
  line.duration=4;
  current.lines.push(line);
  const imported=createProject('incoming');
  imported.lines.push(createLine(imported,'Arthur','new wording'));

  const {project,report}=reimportScriptPreservingSetup(current,imported);
  assert.notEqual(project.lines[0].id,line.id);
  assert.equal(project.lines[0].expression,'default');
  assert.equal(project.lines[0].duration,null);
  assert.equal(report.reusedLineAuthoring,0);
});

test('0.40 reimport refuses ambiguous performance carry-over when identical duplicate count changes', () => {
  const current=createProject('current');
  const line=createLine(current,'Arthur','same');
  line.expression='angry';
  current.lines.push(line);
  const imported=createProject('incoming');
  imported.lines.push(createLine(imported,'Arthur','same'));
  imported.lines.push(createLine(imported,'Arthur','same'));

  const {project,report}=reimportScriptPreservingSetup(current,imported);
  assert.equal(report.reusedLineAuthoring,0);
  assert.equal(project.lines[0].expression,'default');
  assert.equal(project.lines[1].expression,'default');
});
