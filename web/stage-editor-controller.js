import {
  addStageActorToSlot,
  removeStageActor,
  effectiveStageTransform,
  defaultStageTransform,
  setStageActorTransform,
  inheritStageActorTransform,
  resetStageActorTransform,
  copyStageComposition,
  pasteStageComposition,
  projectStageTransform,
  unprojectStageDragDelta
} from '../dist/index.js';

function escapeHtml(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
function nearestSnap(value,points,threshold){let best=value,delta=threshold;for(const point of points){const d=Math.abs(value-point);if(d<delta){best=point;delta=d}}return best}

const SOURCE_LABEL={auto:'自动',manual:'手调',inherited:'继承'};
const X_SNAPS=[0.10,0.30,0.50,0.70,0.90];
const Y_SNAPS=[0.62,0.75,0.88];

export class StageDirectEditorController {
  constructor({host,toggle,hint,copyButton,pasteButton,inheritButton,resetButton,projectionControl,onionControls,onionPrev,onionNext,onionScope,onionOpacity,getProject,getLine,getPerformanceLine,getPreviousPerformanceLine,getNextPerformanceLine,resolveAsset,onMutation,onStopPlayback,onPreviewRefresh,onActivate}){
    this.host=host;this.toggleButton=toggle;this.hint=hint;this.copyButton=copyButton;this.pasteButton=pasteButton;this.inheritButton=inheritButton;this.resetButton=resetButton;this.projectionControl=projectionControl;
    this.getProject=getProject;this.getLine=getLine;this.getPerformanceLine=getPerformanceLine;this.getPreviousPerformanceLine=getPreviousPerformanceLine;this.getNextPerformanceLine=getNextPerformanceLine;this.resolveAsset=resolveAsset;this.onionControls=onionControls;this.onionPrev=onionPrev;this.onionNext=onionNext;this.onionScope=onionScope;this.onionOpacity=onionOpacity;this.onMutation=onMutation;this.onStopPlayback=onStopPlayback;this.onPreviewRefresh=onPreviewRefresh;this.onActivate=onActivate;this.active=false;this.clipboard=null;
    if(this.toggleButton)this.toggleButton.onclick=()=>this.toggle();
    if(this.copyButton)this.copyButton.onclick=()=>this.copyComposition();
    if(this.pasteButton)this.pasteButton.onclick=()=>this.pasteComposition();
    if(this.inheritButton)this.inheritButton.onclick=()=>this.inheritPrevious();
    if(this.resetButton)this.resetButton.onclick=()=>this.resetAuto();
    if(this.projectionControl)this.projectionControl.onchange=()=>{const project=this.getProject?.();if(!project)return;project.sceneGraph??={projection:'flat',ambientLight:{enabled:false,color:'#ffffff',intensity:0,layers:['world.background','world.cg','world.characters','world.front-fx']},worldEffects:{filters:[],mask:null},outputEffects:{filters:[],mask:null},layerEffects:{},nodeOverrides:{}};project.sceneGraph.projection=this.projectionControl.value==='2.5d'?'2.5d':'flat';this.onMutation?.(project.sceneGraph.projection==='2.5d'?'启用伪3D舞台':'切换平面舞台','stage-projection')};
    for(const control of [this.onionPrev,this.onionNext,this.onionScope,this.onionOpacity])if(control)control.oninput=()=>this.render();
  }

  toggle(){this.active=!this.active;if(this.active)this.onActivate?.();this.onStopPlayback?.();this.render();this.onPreviewRefresh?.()}
  exit(){if(!this.active)return;this.active=false;this.render()}

  current(){return {project:this.getProject?.(),line:this.getLine?.(),perf:this.getPerformanceLine?.()}}

  copyComposition(){const {line,perf}=this.current();if(!line||!perf)return;this.clipboard=copyStageComposition(line,perf);if(this.pasteButton)this.pasteButton.disabled=false;this.flashHint('已复制当前构图。')}
  pasteComposition(){const {line}=this.current();if(!line||!this.clipboard)return;pasteStageComposition(line,this.clipboard);this.onMutation?.('粘贴舞台构图',`stage-composition:${line.id}`)}
  inheritPrevious(){const {line,perf}=this.current();if(!line||!perf)return;for(const actor of perf.stage||[])inheritStageActorTransform(line,actor.characterId);this.onMutation?.('本句自由位置继承上一帧',`stage-inherit:${line.id}`)}
  resetAuto(){const {line,perf}=this.current();if(!line||!perf)return;const ids=new Set([...(perf.stage||[]).map(actor=>actor.characterId),...(line.stageIds||[])]);line.stageMode='auto';line.stageIds=[];line.stagePositions={};line.stageTransforms??={};for(const id of ids)resetStageActorTransform(line,id);this.onMutation?.('本句恢复自动构图',`stage-auto:${line.id}`)}
  flashHint(text){if(!this.hint)return;const previous=this.hint.textContent;this.hint.textContent=text;setTimeout(()=>{if(this.hint)this.hint.textContent=previous},1300)}

  projection(){return this.getProject?.()?.sceneGraph?.projection==='2.5d'?'2.5d':'flat'}

  styleActorControl(el,transform){
    const projected=projectStageTransform(transform,this.projection());
    el.style.left=`${clamp(projected.x,-.2,1.2)*100}%`;
    el.style.top=`${clamp(projected.y,-.1,1.15)*100}%`;
    const scale=clamp(projected.scale,.22,2.5);
    el.style.width=`${clamp(20*scale,9,42)}%`;
    el.style.height=`${clamp(48*scale,15,76)}%`;
    el.style.zIndex=String(1000-Math.round(clamp(projected.depth,0,1)*700));
    el.dataset.depth=String(projected.depth);
  }

  beginMove(event,actorEl,actor,line,stage){
    if(event.button!==0||event.target.closest('button,.stage-scale-handle'))return;
    event.preventDefault();event.stopPropagation();actorEl.setPointerCapture?.(event.pointerId);
    const bounds=this.host.getBoundingClientRect();const start=effectiveStageTransform(line,stage,actor.characterId);const startX=event.clientX,startY=event.clientY;
    actorEl.classList.add('dragging');
    const move=e=>{const rawDx=(e.clientX-startX)/Math.max(1,bounds.width),rawDy=(e.clientY-startY)/Math.max(1,bounds.height);const delta=unprojectStageDragDelta(rawDx,rawDy,Number(start.depth)||0,this.projection());let x=start.x+delta.dx,y=start.y+delta.dy;x=nearestSnap(clamp(x,-.2,1.2),X_SNAPS,.025);y=nearestSnap(clamp(y,-.1,1.15),Y_SNAPS,.022);const next={...start,x,y};setStageActorTransform(line,stage,actor.characterId,next);actor.transform={...next};actor.placementSource='manual';this.styleActorControl(actorEl,next);this.onPreviewRefresh?.()};
    const up=()=>{actorEl.classList.remove('dragging');actorEl.removeEventListener('pointermove',move);actorEl.removeEventListener('pointerup',up);actorEl.removeEventListener('pointercancel',up);this.onMutation?.('拖动角色位置',`stage-transform:${line.id}:${actor.characterId}`)};
    actorEl.addEventListener('pointermove',move);actorEl.addEventListener('pointerup',up);actorEl.addEventListener('pointercancel',up);
  }

  beginScale(event,actorEl,actor,line,stage){
    if(event.button!==0)return;event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture?.(event.pointerId);
    const bounds=this.host.getBoundingClientRect();const start=effectiveStageTransform(line,stage,actor.characterId);const startY=event.clientY;
    actorEl.classList.add('scaling');
    const handle=event.currentTarget;
    const move=e=>{const delta=(startY-e.clientY)/Math.max(100,bounds.height*.42);const scale=clamp(start.scale*Math.exp(delta),.35,2.5);const next={...start,scale};setStageActorTransform(line,stage,actor.characterId,next);actor.transform={...next};actor.placementSource='manual';this.styleActorControl(actorEl,next);this.onPreviewRefresh?.()};
    const up=()=>{actorEl.classList.remove('scaling');handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);this.onMutation?.('缩放角色',`stage-scale:${line.id}:${actor.characterId}`)};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',up);
  }

  beginDepth(event,actorEl,actor,line,stage){
    if(event.button!==0)return;event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture?.(event.pointerId);
    const bounds=this.host.getBoundingClientRect();const start=effectiveStageTransform(line,stage,actor.characterId);const startY=event.clientY;const handle=event.currentTarget;actorEl.classList.add('depth-moving');
    const move=e=>{const delta=(startY-e.clientY)/Math.max(120,bounds.height*.7);const depth=clamp((Number(start.depth)||0)+delta,0,1);const next={...start,depth};setStageActorTransform(line,stage,actor.characterId,next);actor.transform={...next};actor.placementSource='manual';this.styleActorControl(actorEl,next);const label=actorEl.querySelector('.stage-depth-label');if(label)label.textContent=depth<.18?'近':depth>.72?'远':`${Math.round(depth*100)}%`;this.onPreviewRefresh?.()};
    const up=()=>{actorEl.classList.remove('depth-moving');handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);this.onMutation?.('调整角色远近','stage-depth:'+line.id+':'+actor.characterId)};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',up);
  }

  toggleFacing(actor,line,stage,character){
    const policy=character?.stageFacing?.policy;if(!['flippable','paired'].includes(policy))return;
    const current=effectiveStageTransform(line,stage,actor.characterId);const native=character.stageFacing.nativeFacing||'left';
    const facing=current.facing&&current.facing!=='neutral'?current.facing:(native==='right'?'right':'left');
    const nextFacing=facing==='left'?'right':'left';
    setStageActorTransform(line,stage,actor.characterId,{...current,facing:nextFacing});
    this.onMutation?.(policy==='paired'?'切换左右独立素材':'手动镜像角色',`stage-facing:${line.id}:${actor.characterId}`);
  }


  onionTransform(actor,stage){
    if(actor?.transform)return actor.transform;
    const index=Math.max(0,stage.findIndex(item=>item.characterId===actor.characterId));
    return defaultStageTransform(actor.position||'auto',index,Math.max(1,stage.length));
  }

  async applyGhostArt(el,character){
    const ref=character?.images?.idle||character?.layers?.base||null;if(!ref||!this.resolveAsset)return;
    try{const source=await this.resolveAsset(ref);if(source){const safe=String(source).replace(/\\/g,'\\\\').replace(/"/g,'\\"');el.querySelector('.ghost-art').style.backgroundImage=`url("${safe}")`}}catch{}
  }

  renderOnionGhosts(host,project,currentLine){
    const opacity=clamp(Number(this.onionOpacity?.value)||.22,.05,.65);
    const scope=this.onionScope?.value||'current';
    const currentPerf=this.getPerformanceLine?.();
    const currentId=currentPerf?.stage?.find(actor=>actor.active)?.characterId||currentLine?.speakerId||null;
    const frames=[];
    if(this.onionPrev?.checked!==false){const perf=this.getPreviousPerformanceLine?.();if(perf)frames.push(['prev',perf])}
    if(this.onionNext?.checked!==false){const perf=this.getNextPerformanceLine?.();if(perf)frames.push(['next',perf])}
    for(const [direction,perf] of frames){
      const stage=perf.stage||[];
      for(const actor of stage){
        if(scope==='current'&&currentId&&actor.characterId!==currentId)continue;
        const character=project.characters.find(item=>item.id===actor.characterId);if(!character)continue;
        const transform=this.onionTransform(actor,stage);
        const el=document.createElement('div');el.className=`stage-onion-ghost ${direction}`;el.style.opacity=String(opacity);
        el.innerHTML=`<div class="ghost-art"></div><div class="ghost-label">${direction==='prev'?'←':'→'} ${escapeHtml(character.name)}</div>`;
        this.styleActorControl(el,transform);host.append(el);void this.applyGhostArt(el,character);
      }
    }
  }

  render(){
    const host=this.host,toggle=this.toggleButton,hint=this.hint;if(!host||!toggle)return;
    const {project,line,perf}=this.current();
    const projection=this.projection();if(this.projectionControl)this.projectionControl.value=projection;toggle.classList.toggle('active',this.active);toggle.textContent=this.active?'完成摆放':'可视化摆放';if(hint){hint.hidden=!this.active;hint.textContent=projection==='2.5d'?'直接拖立绘调整平面位置；↗ 上下拖控制远近，↕ 控制单独大小。远处会自动缩小并向地平线收束。':'直接拖立绘上下左右；右上 ↕ 拖动缩放。靠近参考线会轻微吸附，数值只在工程内部保存。'}if(this.onionControls)this.onionControls.hidden=!this.active;
    for(const button of [this.copyButton,this.inheritButton,this.resetButton])if(button)button.disabled=!line||!perf;
    if(this.pasteButton)this.pasteButton.disabled=!line||!this.clipboard;
    host.hidden=!this.active||!line||!perf||!project;if(host.hidden){host.innerHTML='';return}
    const stage=perf.stage||[];const stageIds=new Set(stage.map(actor=>actor.characterId));
    const missing=project.characters.filter(character=>!stageIds.has(character.id)&&character.showOnStage!==false&&character.kind!=='system'&&character.kind!=='kp');
    host.innerHTML=`${projection==='2.5d'?'<div class="stage-depth-plane"><div class="stage-horizon">远</div><div class="stage-depth-line d1"></div><div class="stage-depth-line d2"></div><div class="stage-depth-line d3"></div></div>':''}<div class="stage-guide stage-guide-eye"></div><div class="stage-guide stage-guide-floor"></div>${X_SNAPS.map((x,i)=>`<div class="stage-guide-v" style="left:${x*100}%"><span>${['远左','左','中','右','远右'][i]}</span></div>`).join('')}<div class="stage-add-tray"><select data-stage-add><option value="">＋ 添加在场角色</option>${missing.map(character=>`<option value="${escapeHtml(character.id)}">${escapeHtml(character.name)}</option>`).join('')}</select></div>`;
    this.renderOnionGhosts(host,project,line);
    for(const actor of stage){
      const character=project.characters.find(c=>c.id===actor.characterId);if(!character)continue;const transform=effectiveStageTransform(line,stage,actor.characterId);const el=document.createElement('div');el.className=`stage-actor-control source-${actor.placementSource||'auto'}`;el.dataset.stageCharacter=actor.characterId;el.innerHTML=`<div class="stage-control-label"><strong>${escapeHtml(character.name)}</strong><span>${SOURCE_LABEL[actor.placementSource||'auto']}</span></div><div class="stage-control-body" title="拖动角色上下左右"></div><button type="button" class="stage-scale-handle" title="上下拖动缩放">↕</button>${projection==='2.5d'?`<button type="button" class="stage-depth-handle" title="上下拖动调整远近">↗<span class="stage-depth-label">${(Number(transform.depth)||0)<.18?'近':(Number(transform.depth)||0)>.72?'远':Math.round((Number(transform.depth)||0)*100)+'%'}</span></button>`:''}${['flippable','paired'].includes(character.stageFacing?.policy)?`<button type="button" class="stage-facing-toggle" title="${character.stageFacing?.policy==='paired'?'切换左 / 右独立素材':'手动左右镜像'}">${character.stageFacing?.policy==='paired'?'L/R':'⇆'}</button>`:''}<button type="button" class="stage-remove-visual" title="从本句舞台移除">×</button>`;this.styleActorControl(el,transform);host.append(el);
      el.querySelector('.stage-control-body').onpointerdown=e=>this.beginMove(e,el,actor,line,stage);
      el.querySelector('.stage-scale-handle').onpointerdown=e=>this.beginScale(e,el,actor,line,stage);
      const depthHandle=el.querySelector('.stage-depth-handle');if(depthHandle)depthHandle.onpointerdown=e=>this.beginDepth(e,el,actor,line,stage);
      const facing=el.querySelector('.stage-facing-toggle');if(facing)facing.onclick=e=>{e.stopPropagation();this.toggleFacing(actor,line,stage,character)};
      el.querySelector('.stage-remove-visual').onclick=e=>{e.stopPropagation();removeStageActor(line,stage,actor.characterId);this.onMutation?.('从本句舞台移除角色',`stage-remove:${line.id}:${actor.characterId}`)};
    }
    const add=host.querySelector('[data-stage-add]');if(add)add.onchange=()=>{if(!add.value)return;const free=['left','center','right'].find(slot=>!stage.some(actor=>actor.position===slot))||'center';if(!addStageActorToSlot(line,stage,add.value,free)){add.value='';return}this.onMutation?.('在舞台添加角色',`stage-add:${line.id}`)};
  }
}
