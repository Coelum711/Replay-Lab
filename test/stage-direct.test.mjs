import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createLine, moveStageActorToSlot, addStageActorToSlot, removeStageActor, actorsByDirectSlot, setStageActorTransform, effectiveStageTransform, resetStageActorTransform, copyStageComposition, pasteStageComposition, setCameraTransform, effectiveCameraTransform, inheritCameraTransform, resetCameraTransform, compilePerformance, stageRect, projectStageTransform, unprojectStageDragDelta, evaluateRplGenMotion } from '../dist/index.js';

function setup() {
  const project=createProject('stage');
  const a=createLine(project,'Arthur','a');
  createLine(project,'Matthew','m');
  createLine(project,'Francis','f');
  const [arthur,matthew,francis]=project.characters;
  const stage=[{characterId:arthur.id,position:'left'},{characterId:matthew.id,position:'right'}];
  return {project,line:a,arthur,matthew,francis,stage};
}

test('0.36 direct stage move materializes auto roster and swaps an occupied slot',()=>{
  const {line,arthur,matthew,stage}=setup();
  moveStageActorToSlot(line,stage,arthur.id,'right');
  assert.equal(line.stageMode,'custom');
  assert.deepEqual(line.stageIds,[arthur.id,matthew.id]);
  assert.equal(line.stagePositions[arthur.id],'right');
  assert.equal(line.stagePositions[matthew.id],'left');
});

test('0.36 direct stage add/remove operates on visible slots without touching unrelated characters',()=>{
  const {line,arthur,matthew,francis,stage}=setup();
  assert.equal(addStageActorToSlot(line,stage,francis.id,'center'),true);
  assert.deepEqual(actorsByDirectSlot(line,{stage}),{left:[arthur.id],center:[francis.id],right:[matthew.id]});
  removeStageActor(line,stage,matthew.id);
  assert.deepEqual(line.stageIds,[arthur.id,francis.id]);
  assert.equal(line.stagePositions[matthew.id],undefined);
});


test('0.43 visual stage transforms stay structured while the UI can manipulate them directly',()=>{
  const {line,arthur,stage}=setup();
  setStageActorTransform(line,stage,arthur.id,{x:.31,y:.79,scale:1.18});
  assert.equal(line.stageMode,'custom');
  assert.deepEqual(line.stageTransforms[arthur.id],{x:.31,y:.79,scale:1.18});
  assert.deepEqual(effectiveStageTransform(line,stage,arthur.id),{x:.31,y:.79,scale:1.18});
  resetStageActorTransform(line,arthur.id);
  assert.equal(line.stageTransforms[arthur.id],null,'null is an explicit reset so an earlier Scene transform stops carrying');
});

test('0.43 stage compositions copy/paste freeform transforms without exposing coordinate entry as script text',()=>{
  const {line,arthur,matthew,stage}=setup();
  setStageActorTransform(line,stage,arthur.id,{x:.27,y:.86,scale:1.05,facing:'left'});
  const clip=copyStageComposition(line,stage);
  const target=createLine(createProject('target'),'Arthur','next');
  pasteStageComposition(target,clip);
  assert.deepEqual(target.stageIds,[arthur.id,matthew.id]);
  assert.deepEqual(target.stageTransforms[arthur.id],{x:.27,y:.86,scale:1.05,facing:'left'});
});


test('0.44 visual camera framing is structured, inherited inside a Scene, and reset at Scene boundaries',()=>{
  const project=createProject('camera');
  const first=createLine(project,'Arthur','one');
  const second=createLine(project,'Arthur','two');
  const third=createLine(project,'Arthur','three');
  project.lines.push(first,second,third);
  setCameraTransform(first,{x:.62,y:.48,zoom:2});
  third.sceneTitle='Next';
  const perf=compilePerformance(project);
  assert.deepEqual(perf.lines[0].cameraTransform,{x:.62,y:.48,zoom:2});
  assert.equal(perf.lines[0].cameraPlacementSource,'manual');
  assert.deepEqual(perf.lines[1].cameraTransform,{x:.62,y:.48,zoom:2});
  assert.equal(perf.lines[1].cameraPlacementSource,'inherited');
  assert.deepEqual(perf.lines[2].cameraTransform,{x:.5,y:.5,zoom:1});
  assert.equal(perf.lines[2].cameraPlacementSource,'auto');
  inheritCameraTransform(second);
  assert.equal(second.cameraTransform,undefined);
  resetCameraTransform(second);
  assert.equal(second.cameraTransform,null);
  assert.deepEqual(effectiveCameraTransform(second,perf.lines[1]),{x:.62,y:.48,zoom:2},'preview helper can still read compiled framing until recompilation');
});

test('0.44 camera framing clamps panning to the visible crop and never exposes coordinate entry to the script',()=>{
  const {line}=setup();
  setCameraTransform(line,{x:2,y:-1,zoom:2});
  assert.deepEqual(line.cameraTransform,{x:.75,y:.25,zoom:2});
});


test('0.44.2 three-person VN blocking keeps the same actor size budget as two-person shots',()=>{
  const two=stageRect('left',2,1920,1080,0,['left','right']);
  const three=stageRect('left',3,1920,1080,0,['left','center','right']);
  const crowded=stageRect('left',4,1920,1080,0,['left','center','right','auto']);
  assert.equal(three.maxW,two.maxW,'adding a third actor must not make the existing cast suddenly smaller');
  assert.equal(three.maxH,two.maxH,'normal one/two/three-person shots share a stable height budget');
  assert.ok(crowded.maxW<three.maxW,'4+ actor emergency layouts may still compress to fit');
});


test('0.49 2.5D projection makes farther actors smaller and converges them toward the horizon',()=>{
  const near=projectStageTransform({x:.22,y:.88,scale:1,depth:0},'2.5d');
  const far=projectStageTransform({x:.22,y:.88,scale:1,depth:.8},'2.5d');
  assert.equal(near.scale,1);
  assert.ok(far.scale<near.scale);
  assert.ok(far.y<near.y,'farther floor anchors move toward the horizon');
  assert.ok(far.x>.22,'farther actors converge horizontally toward the vanishing region');
  const delta=unprojectStageDragDelta(.1,.1,.8,'2.5d');
  assert.ok(delta.dy>.1,'screen-space drag remains usable after perspective convergence');
});

test('0.49 scene graph painter order puts farther 2.5D actors behind nearer actors',()=>{
  const project=createProject('depth-order');
  project.sceneGraph.projection='2.5d';
  const first=createLine(project,'Near','near');
  createLine(project,'Far','far');
  project.lines.push(first);
  const near=project.characters.find(c=>c.name==='Near');
  const far=project.characters.find(c=>c.name==='Far');
  first.stageMode='custom';
  first.stageIds=[near.id,far.id];
  first.stagePositions={[near.id]:'left',[far.id]:'right'};
  first.stageTransforms={[near.id]:{x:.3,y:.88,scale:1,depth:.1},[far.id]:{x:.7,y:.88,scale:1,depth:.8}};
  const perf=compilePerformance(project);
  const ids=perf.lines[0].sceneGraph.nodes.filter(n=>n.kind==='character').map(n=>n.characterId);
  assert.deepEqual(ids,[far.id,near.id]);
});

test('0.49 existing motion vocabulary can express transient retreat/approach in depth',()=>{
  const retreat=evaluateRplGenMotion({name:'retreat_major',duration:.5},.5,2,{width:1280,height:720});
  const approach=evaluateRplGenMotion({name:'approach_minor',duration:.5},.5,2,{width:1280,height:720});
  assert.ok(retreat.dz>.5);
  assert.ok(approach.dz<0);
  assert.equal(retreat.dx,0);
  assert.equal(retreat.dy,0);
});
