import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProject,
  createLine,
  createCustomObject,
  parseDirectorCommand,
  formatDirectorCommand,
  compilePerformance,
  normalizeReplayProject,
  reimportScriptPreservingSetup,
  diagnoseProject,
  exportYmmScript,
  exportCsvScript,
  VNReplayRuntime,
  CustomObjectInteractionController,
  bakeCustomObjectInteractionTake
} from '../dist/index.js';

function commandLine(project,text){
  const line=createLine(project,'Director',text,'command');
  const parsed=parseDirectorCommand(project,text);
  assert.ok(parsed.command,parsed.error);
  line.command=parsed.command;
  line.mouth='off';
  if(parsed.command.kind==='scene')line.sceneTitle=parsed.command.value;
  if(parsed.command.kind==='chapter')line.chapterTitle=parsed.command.value;
  return line;
}

test('0.42 director command parser resolves quoted character names, assets and formats them back',()=>{
  const project=createProject('director');
  createLine(project,'Arthur Kirkland','hello');
  project.assets.push({id:'bgm-1',kind:'bgm',name:'Quiet Theme.ogg'});
  const expr=parseDirectorCommand(project,'/expression "Arthur Kirkland" angry');
  assert.equal(expr.command?.kind,'expression');
  assert.equal(expr.command?.expression,'angry');
  assert.match(formatDirectorCommand(project,expr.command),/^\/expression "Arthur Kirkland" angry$/);
  const bgm=parseDirectorCommand(project,'/bgm "Quiet Theme.ogg"');
  assert.equal(bgm.command?.assetId,'bgm-1');
});


test('0.51.2 director commands accept Chinese character and expression names',()=>{
  const project=createProject('中文指令');
  createLine(project,'王耀','你好');
  const character=project.characters.find(item=>item.name==='王耀');
  const expr=parseDirectorCommand(project,'/expression 王耀 生气');
  assert.equal(expr.command?.kind,'expression');
  assert.equal(expr.command?.characterId,character.id);
  assert.equal(expr.command?.expression,'生气');
  const dismiss=parseDirectorCommand(project,'/dismiss 王耀');
  assert.equal(dismiss.command?.kind,'dismiss');
  assert.equal(dismiss.command?.characterId,character.id);
});

test('0.53 ambient director command resolves Chinese-named environment audio',()=>{
  const project=createProject('ambient');
  project.assets.push({id:'rain',kind:'ambient',name:'暴雨.ogg'});
  const parsed=parseDirectorCommand(project,'/ambient 暴雨.ogg');
  assert.equal(parsed.command?.kind,'ambient');
  assert.equal(parsed.command?.assetId,'rain');
  const stop=parseDirectorCommand(project,'/ambient stop');
  assert.equal(stop.command?.kind,'ambient');
  assert.equal(stop.command?.assetId,null);
});

test('0.43 /move is a readable timeline marker whose precise transform stays structured on the line',()=>{
  const project=createProject('move');
  const seed=createLine(project,'Arthur','seed');
  const arthur=project.characters.find(c=>c.name==='Arthur');
  const parsed=parseDirectorCommand(project,'/move Arthur');
  assert.equal(parsed.command?.kind,'move');
  assert.equal(parsed.command?.characterId,arthur.id);
  assert.equal(formatDirectorCommand(project,parsed.command),'/move Arthur');
  const line=commandLine(project,'/move Arthur');
  line.stageTransforms={[arthur.id]:{x:.41,y:.84,scale:1.08}};
  project.lines=[seed,line,createLine(project,'Arthur','after')];
  const perf=compilePerformance(project);
  assert.deepEqual(perf.lines[1].stage.find(actor=>actor.characterId===arthur.id)?.transform,{x:.41,y:.84,scale:1.08});
  assert.equal(perf.lines[2].stage.find(actor=>actor.characterId===arthur.id)?.placementSource,'inherited');
});

test('0.42 director commands are non-dialogue state events for expression, stage, BGM and SFX',()=>{
  const project=createProject('director');
  project.settings.maxOnStage=3;
  const first=createLine(project,'Arthur','hello');
  const arthur=project.characters.find(c=>c.name==='Arthur');
  const matthewLine=createLine(project,'Matthew','still here');
  const matthew=project.characters.find(c=>c.name==='Matthew');
  project.assets.push({id:'music',kind:'bgm',name:'theme.ogg'},{id:'door',kind:'sfx',name:'door.wav'});
  const expr=commandLine(project,'/expression Arthur angry');
  const dismiss=commandLine(project,'/dismiss Arthur');
  const bgm=commandLine(project,'/bgm theme.ogg');
  const sfx=commandLine(project,'/sfx door.wav');
  project.lines=[first,expr,dismiss,bgm,sfx,matthewLine];
  const perf=compilePerformance(project);
  assert.equal(perf.lines[1].type,'command');
  assert.equal(perf.lines[1].state.expressions[arthur.id],'angry');
  assert.equal(perf.lines[1].duration,0,'instant commands take no time');
  assert.ok(!perf.lines[2].stage.some(actor=>actor.characterId===arthur.id),'dismiss applies at the command row');
  assert.equal(perf.lines[3].state.bgm,'music');
  assert.equal(perf.lines[4].sfxAssetId,'door');
  assert.ok(perf.lines[5].stage.some(actor=>actor.characterId===matthew.id));
});

test('0.42 /enter can explicitly place an actor without losing VN continuity',()=>{
  const project=createProject('blocking');
  const seed=createLine(project,'Arthur','seed');
  const arthur=project.characters.find(c=>c.name==='Arthur');
  const enter=commandLine(project,'/enter Arthur left');
  project.lines=[enter,createLine(project,'Matthew','hello')];
  const perf=compilePerformance(project);
  assert.equal(perf.lines[0].stage.find(actor=>actor.characterId===arthur.id)?.position,'left');
  assert.equal(perf.lines[1].stage.find(actor=>actor.characterId===arthur.id)?.position,'left');
});

test('0.42 scene/chapter commands become structural boundaries during normalization',()=>{
  const project=createProject('structure');
  const line=createLine(project,'Director','/scene Kitchen','command');
  line.command=null;
  project.lines=[line];
  const normalized=normalizeReplayProject(project);
  assert.equal(normalized.version,'0.53');
  assert.equal(normalized.lines[0].command?.kind,'scene');
  assert.equal(normalized.lines[0].sceneTitle,'Kitchen');
});

test('0.42 source-aware reimport preserves manually inserted director commands around surviving Log lines',()=>{
  const current=createProject('current');
  const a=createLine(current,'Arthur','A');
  const b=createLine(current,'Matthew','B');
  const cmd=commandLine(current,'/expression Arthur angry');
  current.lines=[a,cmd,b];
  const imported=createProject('incoming');
  imported.lines=[createLine(imported,'Arthur','A'),createLine(imported,'Matthew','B')];
  const {project,report}=reimportScriptPreservingSetup(current,imported);
  assert.equal(report.preservedCommands,1);
  assert.deepEqual(project.lines.map(line=>line.type),['dialogue','command','dialogue']);
  assert.equal(project.lines[1].id,cmd.id);
});

test('0.42 diagnostics reports invalid director syntax',()=>{
  const project=createProject('bad command');
  project.lines=[createLine(project,'Director','/expression Nobody angry','command')];
  const issues=diagnoseProject(project);
  assert.ok(issues.some(issue=>issue.code==='invalid-director-command'));
});


test('0.42 dialogue-only script exports do not leak director syntax as spoken lines',()=>{
  const project=createProject('exports');
  const a=createLine(project,'Arthur','hello');
  const cmd=commandLine(project,'/dismiss Arthur');
  project.lines=[a,cmd];
  assert.doesNotMatch(exportYmmScript(project),/dismiss/);
  assert.doesNotMatch(exportCsvScript(project),/dismiss/);
  assert.match(exportYmmScript(project),/Arthur「hello」/);
});

test('0.42 VN runtime executes command rows automatically and lands on the next visible line',async()=>{
  const perf={
    format:'ReplayLabPerformance',version:'0.42',title:'commands',settings:{},characters:[],assets:[],mediaDefinitions:[],faceTemplates:[],duration:1,
    lines:[
      {speakerName:'Arthur',text:'one',type:'dialogue',duration:.2,wheel:null},
      {speakerName:'Director',text:'/wait 0',type:'command',duration:.04,wheel:null},
      {speakerName:'Director',text:'/expression Arthur angry',type:'command',duration:.04,wheel:null},
      {speakerName:'Matthew',text:'two',type:'dialogue',duration:.2,wheel:null}
    ]
  };
  const shown=[];
  const renderer={async renderLine(i,t){shown.push(['render',i,t])}};
  const player={stop(){},stopLine(){}, async playLineUntilEnd(i){shown.push(['play',i])}, async playLine(i){shown.push(['play',i])}};
  const runtime=new VNReplayRuntime(perf,renderer,player);
  await runtime.start(0);
  await runtime.next();
  assert.equal(runtime.index,3);
  assert.ok(shown.some(entry=>entry[0]==='render'&&entry[1]===1));
  assert.ok(shown.some(entry=>entry[0]==='render'&&entry[1]===2));
  assert.deepEqual(runtime.backlog().map(entry=>entry.index),[0,3]);
});


test('0.46 /motion invokes an existing custom action for a chosen character',()=>{
  const project=createProject('motion');
  createLine(project,'Arthur','hello');
  const parsed=parseDirectorCommand(project,'/motion Arthur shake45_minor 0.65');
  assert.equal(parsed.command?.kind,'motion');
  assert.equal(parsed.command?.value,'shake45_minor');
  assert.equal(parsed.command?.duration,0.65);
  assert.equal(formatDirectorCommand(project,parsed.command),'/motion Arthur shake45_minor 0.65');
});

test('0.47 custom objects are reusable stateful presentation events',()=>{
  const project=createProject('objects');
  project.assets.push({id:'letter-closed',kind:'other',name:'letter-closed.png',mime:'image/png'},{id:'letter-open',kind:'other',name:'letter-open.png',mime:'image/png'});
  const object=createCustomObject('旧信件','letter-closed','document');
  object.id='obj-letter'; object.interactionMode='stateful'; object.states[0].id='closed'; object.states[0].name='合上'; object.states.push({id:'open',name:'打开',assetId:'letter-open'}); object.initialStateId='closed';
  project.customObjects.push(object);
  const show=commandLine(project,'/object show 旧信件');
  const state=commandLine(project,'/object state 旧信件 打开');
  const hide=commandLine(project,'/object hide 旧信件');
  project.lines=[show,state,hide];
  assert.equal(show.command.objectId,'obj-letter');
  assert.equal(formatDirectorCommand(project,state.command),'/object state 旧信件 打开');
  const perf=compilePerformance(project);
  assert.equal(perf.lines[0].state.customObjects['obj-letter'].visible,true);
  assert.equal(perf.lines[0].state.customObjects['obj-letter'].stateId,'closed');
  assert.equal(perf.lines[1].state.customObjects['obj-letter'].stateId,'open');
  assert.equal(perf.lines[2].state.customObjects['obj-letter'].visible,false);
  assert.equal(perf.customObjects[0].name,'旧信件');
  const objectNode=perf.lines[0].sceneGraph.nodes.find(node=>node.id==='custom-object:obj-letter');
  assert.equal(objectNode?.space,'screen');
  assert.equal(objectNode?.layerId,'screen.presentation');
});

test('0.47 fullscreen CG carries presentation semantics independently from background and actors',()=>{
  const project=createProject('cg presentation');
  project.assets.push({id:'cg1',kind:'cg',name:'event.png',mime:'image/png'});
  const line=createLine(project,'Arthur','看这里');
  line.scene.cg='cg1';
  line.scene.cgPresentation={fit:'cover',hideCharacters:true,hideTextbox:true,motion:'slow-push',duration:1.2};
  project.lines=[line];
  const perf=compilePerformance(project);
  assert.equal(perf.lines[0].state.cg,'cg1');
  assert.deepEqual(perf.lines[0].state.cgPresentation,{fit:'cover',hideCharacters:true,hideTextbox:true,motion:'slow-push',mask:null,duration:1.2});
});

test('0.51 object transform command is structured and compiler carries the transform forward',()=>{
  const project=createProject('object transform');
  project.assets.push({id:'map-img',kind:'other',name:'map.png',mime:'image/png'});
  const object=createCustomObject('医院地图','map-img','map');object.id='map-object';project.customObjects.push(object);
  const show=commandLine(project,'/object show 医院地图');
  const move=commandLine(project,'/object transform 医院地图 0.42 0.61 0.9 12');
  project.lines=[show,move,createLine(project,'Arthur','这里。')];
  assert.equal(move.command.objectAction,'transform');
  assert.deepEqual(move.command.objectTransform,{x:.42,y:.61,scale:.9,rotation:12});
  assert.match(formatDirectorCommand(project,move.command),/^\/object transform 医院地图 0\.4200 0\.6100 0\.9000 12\.00$/);
  const perf=compilePerformance(project);
  assert.equal(perf.lines[1].state.customObjects['map-object'].transform.x,.42);
  assert.equal(perf.lines[2].state.customObjects['map-object'].transform.scale,.9);
});

test('0.51 diagnostics validates object hotspot state targets and interaction takes',()=>{
  const project=createProject('hotspots');
  const object=createCustomObject('信件');object.id='letter';object.states[0].id='closed';object.hotspots.push({id:'seal',label:'火漆',stateId:'missing-state',x:.2,y:.2,width:.2,height:.2,action:'state',targetStateId:'missing-target'});project.customObjects.push(object);
  project.customObjectTakes=[{id:'take',name:'坏 take',objectId:'missing-object',duration:1,steps:[]}];
  const issues=diagnoseProject(project);
  assert.ok(issues.some(issue=>/热点「火漆」限定了不存在的状态/.test(issue.message)));
  assert.ok(issues.some(issue=>/没有有效的目标状态/.test(issue.message)));
  assert.ok(issues.some(issue=>/交互录制「坏 take」/.test(issue.message)));
});

test('0.51 interactive object controller applies hotspots, pan/zoom and records a take',()=>{
  const project=createProject('interaction');
  const object=createCustomObject('地图');object.id='map';object.interactionMode='hotspots';object.states[0].id='front';object.states.push({id:'detail',name:'细节',assetId:null});object.hotspots.push({id:'room',label:'房间',stateId:'front',x:.1,y:.1,width:.3,height:.3,action:'state',targetStateId:'detail'});project.customObjects.push(object);
  const show=commandLine(project,'/object show 地图');project.lines=[show,createLine(project,'Arthur','查看地图')];
  const perf=compilePerformance(project);const overrides=new Map();
  const fakeRenderer={
    customObjectHitTest(){return {objectId:'map',stateId:'front',hotspotId:'room',localX:.2,localY:.2,region:{objectId:'map',stateId:'front',x:0,y:0,width:100,height:100,rotation:0,hotspots:object.hotspots}}},
    customObjectInteractionOverride(id){return overrides.get(id)||null},
    setCustomObjectInteractionOverride(id,patch){const prev=overrides.get(id)||{};overrides.set(id,{...prev,...patch,transform:patch.transform?{...(prev.transform||{}),...patch.transform}:prev.transform})},
    clearCustomObjectInteractionOverrides(id){if(id)overrides.delete(id);else overrides.clear()}
  };
  const controller=new CustomObjectInteractionController(perf,fakeRenderer);controller.setLine(1);controller.beginRecording('map','查看地图');
  const event=controller.interactAt(20,20);assert.equal(event?.kind,'state');assert.equal(overrides.get('map').stateId,'detail');
  const take=controller.stopRecording();assert.equal(take?.steps.length,1);assert.equal(take?.steps[0].stateId,'detail');
  project.customObjectTakes=[take];const rows=bakeCustomObjectInteractionTake(project,take);assert.ok(rows.some(row=>/\/object state 地图 细节/.test(row.text)));
});
