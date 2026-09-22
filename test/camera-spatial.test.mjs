import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {createProject,createLine,compilePerformance,normalizeReplayProject,cleanCameraTransform,setCameraTransform,projectStageTransform,unprojectStageDragDelta} from '../dist/index.js';
import {SceneViewportController,stageSpaceSvg} from '../web/scene-viewport-controller.js';
import {CameraDirectEditorController} from '../web/camera-editor-controller.js';
import {StageDirectEditorController} from '../web/stage-editor-controller.js';

function fixture(){
  const p=createProject('空间试验'),line=createLine(p,'Arthur','One'),next=createLine(p,'Arthur','Two'),end=createLine(p,'Arthur','Three');
  p.lines.push(line,next,end);p.sceneGraph.projection='2.5d';end.sceneTitle='New scene';
  return {p,line,next,end};
}
test('camera angles survive project JSON normalization and compilation, inherit and reset at scene boundaries',()=>{
  const {p,line}=fixture();setCameraTransform(line,{x:.5,y:.5,zoom:1,yaw:35,pitch:20});
  const roundtrip=normalizeReplayProject(JSON.parse(JSON.stringify(p))),perf=compilePerformance(roundtrip);
  assert.deepEqual(perf.lines[0].cameraTransform,{x:.5,y:.5,zoom:1,yaw:35,pitch:20});
  assert.deepEqual(perf.lines[1].cameraTransform,perf.lines[0].cameraTransform);
  assert.equal(perf.lines[1].cameraPlacementSource,'inherited');
  assert.deepEqual(perf.lines[2].cameraTransform,{x:.5,y:.5,zoom:1});
  roundtrip.lines[1].cameraTransform=null;assert.deepEqual(compilePerformance(roundtrip).lines[1].cameraTransform,{x:.5,y:.5,zoom:1});
});
test('camera normalizer has finite limits and preserves legacy shape without extra zero fields',()=>{
  assert.deepEqual(cleanCameraTransform({x:2,y:-1,zoom:2}),{x:.75,y:.25,zoom:2});
  assert.deepEqual(cleanCameraTransform({x:NaN,y:Infinity,zoom:NaN,yaw:Infinity,pitch:-900}),{x:.5,y:.5,zoom:1,pitch:-90});
});
test('zero-angle projection preserves old framing; orbit changes parallax and camera-relative ordering',()=>{
  const t={x:.3,y:.88,scale:1,depth:.7};
  const base=projectStageTransform(t,'2.5d',{x:.5,y:.5,zoom:1});
  assert.ok(Math.abs(base.x-(.5+(.3-.5)*(1-.7*.18)))<1e-12);
  assert.ok(Math.abs(base.y-(.4+(.88-.4)*(1-.7*.88)))<1e-12);
  assert.equal(base.scale,1-.7*.52);
  assert.deepEqual(projectStageTransform({...t,depth:0},'2.5d'),{...t,depth:0});
  assert.deepEqual(projectStageTransform(t,'flat',{yaw:90,pitch:90}),t);
  assert.notEqual(projectStageTransform(t,'2.5d',{yaw:35,pitch:20}).x,base.x);
  const near={x:.3,y:.88,scale:1,depth:.1},far={...near,depth:.8};
  const back={yaw:180,pitch:0};
  assert.ok(projectStageTransform(near,'2.5d',back).viewDepth>projectStageTransform(far,'2.5d',back).viewDepth);
  for(const yaw of [-180,-90,0,90,180])for(const pitch of [-90,0,90])assert.ok(Object.values(projectStageTransform(t,'2.5d',{yaw,pitch})).every(Number.isFinite));
});
test('stage drag inverse follows zoom and angled projection without exploding edge-on',()=>{
  const t={x:.42,y:.8,scale:1,depth:.45},camera={x:.5,y:.5,zoom:2,yaw:25,pitch:15},dx=.0001,dy=-.00015;
  const p=projectStageTransform(t,'2.5d',camera),q=projectStageTransform({...t,x:t.x+dx,y:t.y+dy},'2.5d',camera);
  const inverse=unprojectStageDragDelta((q.x-p.x)*2,(q.y-p.y)*2,t.depth,'2.5d',camera,t);
  assert.ok(Math.abs(inverse.dx-dx)<1e-7);assert.ok(Math.abs(inverse.dy-dy)<1e-7);
  assert.deepEqual(unprojectStageDragDelta(.1,.2,0,'flat',{zoom:2}),{dx:.05,dy:.1});
  const edge=unprojectStageDragDelta(.1,.2,.5,'2.5d',{yaw:90,pitch:90},t);assert.ok(Object.values(edge).every(Number.isFinite));
});
async function setup(t){
  const f=fixture(),dom=new JSDOM(await readFile(new URL('../web/studio.html',import.meta.url),'utf8')),w=dom.window,d=w.document;
  let project=f.p,line=f.line,perf=compilePerformance(project).lines[0],mutations=0;
  const controller=new SceneViewportController({root:d.getElementById('sceneViewToolbar'),host:d.getElementById('stageSpatialViewport'),controls:d.getElementById('cameraControls'),getProject:()=>project,getLine:()=>line,getPerformanceLine:()=>perf,onMutation:()=>mutations++});
  controller.render();t.after(()=>{controller.cancelDrag?.();w.close()});
  return {...f,controller,w,d,get perf(){return perf},get mutations(){return mutations},switchLine(){line=f.next;perf=compilePerformance(project).lines[1];controller.render()},switchProject(){project=createProject('other');line=createLine(project,'Other','Other');project.lines.push(line);perf=compilePerformance(project).lines[0];controller.render()}};
}
test('view switches and navigation never mutate a project; only explicit angle adoption changes a shot',async t=>{
  const x=await setup(t),before=JSON.stringify(x.p),c=x.controller;
  for(const view of ['front','right','left','top','free'])c.setView(view);
  c.view.zoom=1.8;c.view.panX=50;c.renderDiagram();assert.equal(JSON.stringify(x.p),before);assert.equal(x.mutations,0);
  c.view.yaw=40;c.view.pitch=20;c.applyAngles();assert.equal(x.line.cameraTransform.yaw,40);assert.equal(x.line.cameraTransform.pitch,20);
  assert.equal(x.line.cameraTransform.zoom,1,'inspection zoom must not leak into the final shot');
  assert.equal(c.view.mode,'camera');assert.equal(x.mutations,1);
});
test('camera controls update the current line; project changes discard view-only navigation',async t=>{
  const x=await setup(t),input=x.d.querySelector('[data-camera-value="yaw"]');
  input.value='25';input.dispatchEvent(new x.w.Event('input'));assert.equal(x.line.cameraTransform.yaw,25);
  x.switchLine();input.value='-15';input.dispatchEvent(new x.w.Event('input'));assert.equal(x.line.cameraTransform.yaw,25);assert.equal(x.next.cameraTransform.yaw,-15);
  x.controller.setView('top');x.switchProject();assert.equal(x.controller.view.mode,'camera');assert.equal(x.d.getElementById('stageSpatialViewport').hidden,true);
  assert.equal(x.d.querySelector('[data-stage-view="top"]').disabled,true);
});
test('space view escapes names and shows camera markers with valid geometry; keyboard shortcuts stay local',async t=>{
  const x=await setup(t);x.p.characters[0].name='<script>bad()</script>';
  const svg=stageSpaceSvg(x.p,x.line,x.perf,{mode:'top',yaw:0,pitch:90,zoom:1,panX:0,panY:0});
  assert.ok(svg.includes('&lt;script&gt;'));assert.ok(!svg.includes('<script>'));assert.ok(!/NaN|Infinity/.test(svg));assert.match(svg,/本句摄像机/);
  x.controller.setView('front');x.d.getElementById('stageSpatialViewport').dispatchEvent(new x.w.KeyboardEvent('keydown',{code:'Numpad7',key:'7',bubbles:true}));assert.equal(x.controller.view.mode,'top');
  x.d.getElementById('stageSpatialViewport').dispatchEvent(new x.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(x.controller.view.mode,'camera');
});
test('direct camera pan/zoom retains orbit, and actor handles align with camera crop and parallax',async t=>{
  const x=await setup(t);setCameraTransform(x.line,{x:.55,y:.52,zoom:2,yaw:30,pitch:15});x.perf.cameraTransform=x.line.cameraTransform;
  const cam=new CameraDirectEditorController({getLine:()=>x.line,getPerformanceLine:()=>x.perf});
  cam.applyLive(x.line,x.perf,{...x.line.cameraTransform,zoom:3});assert.equal(x.line.cameraTransform.yaw,30);
  const stage=new StageDirectEditorController({getProject:()=>x.p,getPerformanceLine:()=>x.perf});
  const el=x.d.createElement('div'),transform={x:.4,y:.8,scale:1,depth:.4};stage.styleActorControl(el,transform);
  const projected=projectStageTransform(transform,'2.5d',x.line.cameraTransform);
  assert.ok(Math.abs(parseFloat(el.style.left)-(.5+(projected.x-.55)*3)*100)<1e-8);
});

test('shared renderer applies shot angles, reverses painter order from behind, and keeps dialogue outside camera transform',async()=>{
  const {CanvasStageRenderer}=await import('../dist/index.js');
  const {p,line}=fixture();createLine(p,'Francis','Other');const [near,far]=p.characters;
  line.stageMode='custom';line.stageIds=[near.id,far.id];line.stagePositions={[near.id]:'left',[far.id]:'right'};
  line.stageTransforms={[near.id]:{x:.3,y:.88,scale:1,depth:.1},[far.id]:{x:.7,y:.88,scale:1,depth:.8}};
  setCameraTransform(line,{x:.6,y:.5,zoom:2,yaw:180,pitch:0});p.settings.showNameTags=false;
  const perf=compilePerformance(p),drawn=[],stack=[];let matrix={x:0,y:0,z:1},dialogueMatrix;
  const ctx=new Proxy({
    save(){stack.push({...matrix})},restore(){matrix=stack.pop()},translate(x,y){matrix.x+=x*matrix.z;matrix.y+=y*matrix.z},scale(x){matrix.z*=x},
    createLinearGradient:()=>({addColorStop(){}}),measureText:()=>({width:10})
  },{get:(o,k)=>k in o?o[k]:()=>{}});
  const renderer=new CanvasStageRenderer({canvas:{width:1280,height:720,getContext:()=>ctx},performance:perf,resolveAsset:async()=>null});
  renderer.image=async()=>null;renderer.drawPlaceholderActor=(character,rect)=>drawn.push({id:character.id,rect});renderer.drawDialogue=()=>{dialogueMatrix={...matrix}};
  await renderer.renderLine(0,0);
  assert.deepEqual(drawn.map(x=>x.id),[near.id,far.id]);
  assert.deepEqual(perf.lines[0].sceneGraph.nodes.filter(x=>x.kind==='character').map(x=>x.characterId),[near.id,far.id]);
  assert.notEqual(drawn[0].rect.cx,1280*.3);
  assert.deepEqual(dialogueMatrix,{x:0,y:0,z:1});
});
