import { cleanCameraTransform, effectiveCameraTransform, effectiveStageTransform, projectStageTransform, setCameraTransform } from '../dist/index.js';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const views={front:{yaw:0,pitch:0},right:{yaw:90,pitch:0},left:{yaw:-90,pitch:0},top:{yaw:0,pitch:90},free:{yaw:35,pitch:25}};
const labels={camera:'摄像机画面',front:'正视',right:'右视',left:'左视',top:'俯视',free:'自由查看'};

/** A view-only spatial diagram. Never reads or writes the renderer's camera state. */
export function stageSpaceSvg(project,line,perf,view){
  const yaw=view.yaw*Math.PI/180,pitch=view.pitch*Math.PI/180;
  const projectPoint=p=>{
    const x=(p.x-.5)*1.6,y=.65-p.y,z=(p.depth-.35)*.85;
    const rx=Math.cos(yaw)*x-Math.sin(yaw)*z,rz=Math.sin(yaw)*x+Math.cos(yaw)*z;
    const ry=Math.cos(pitch)*y+Math.sin(pitch)*rz,d=-Math.sin(pitch)*y+Math.cos(pitch)*rz;
    const k=(view.mode==='free'?2.7/Math.max(.8,2.7+d):1)*(view.zoom||1);
    return {x:500+rx*340*k+(view.panX||0),y:300-ry*340*k+(view.panY||0),depth:d};
  };
  const point=p=>{const v=projectPoint(p);return `${v.x.toFixed(2)},${v.y.toFixed(2)}`};
  const segment=(a,b,cls)=>`<line class="${cls}" x1="${projectPoint(a).x}" y1="${projectPoint(a).y}" x2="${projectPoint(b).x}" y2="${projectPoint(b).y}"/>`;
  const ground=(x,depth)=>({x,y:.88,depth});
  let grid='';for(let i=0;i<=10;i++){grid+=segment(ground(i/10,0),ground(i/10,1),'grid');grid+=segment(ground(0,i/10),ground(1,i/10),'grid')}
  const stage=perf?.stage||[];
  const cards=stage.map((actor,index)=>{
    const t=effectiveStageTransform(line,stage,actor.characterId),p=projectStageTransform(t,'2.5d');
    const w=.11*p.scale,h=.48*p.scale;
    const vertices=[{x:p.x-w,y:p.y,depth:p.depth},{x:p.x+w,y:p.y,depth:p.depth},{x:p.x+w,y:p.y-h,depth:p.depth},{x:p.x-w,y:p.y-h,depth:p.depth}];
    const label=projectPoint({x:p.x,y:p.y-h-.04,depth:p.depth});
    const name=project.characters.find(c=>c.id===actor.characterId)?.name||'角色';
    return {depth:projectPoint(p).depth,svg:`<g data-space-actor="${esc(actor.characterId)}"><polygon class="actor actor-${index%3}" points="${vertices.map(point).join(' ')}"/><circle class="anchor" cx="${projectPoint(p).x}" cy="${projectPoint(p).y}" r="5"/><text x="${label.x}" y="${label.y}" text-anchor="middle">${esc(name)}</text></g>`};
  }).sort((a,b)=>b.depth-a.depth).map(x=>x.svg).join('');
  const camera=effectiveCameraTransform(line,perf),a=(camera.yaw||0)*Math.PI/180,b=(camera.pitch||0)*Math.PI/180,dist=.72/Math.sqrt(camera.zoom);
  const target={x:camera.x,y:camera.y,depth:.35};
  const origin={x:target.x-Math.sin(a)*Math.cos(b)*dist/1.6,y:target.y-Math.sin(b)*dist,depth:target.depth-Math.cos(a)*Math.cos(b)*dist/.85};
  const cp=projectPoint(origin),tp=projectPoint(target);
  const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sy])=>({x:target.x+(sx*.2*Math.cos(a)-sy*.11*Math.sin(a)*Math.sin(b))/camera.zoom,y:target.y-sy*.18*Math.cos(b)/camera.zoom,depth:target.depth+(-sx*.32*Math.sin(a)-sy*.18*Math.cos(a)*Math.sin(b))/.85/camera.zoom}));
  const rays=corners.map(p=>segment(origin,p,'frustum')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" role="img" aria-label="${labels[view.mode]}：角色平面与摄像机空间示意"><style>.grid{stroke:#37404e;stroke-width:1}.actor{fill:#ae96d330;stroke:#bfa6e7;stroke-width:2}.actor-1{fill:#77b3c930;stroke:#8ec9d9}.actor-2{fill:#d4ae7130;stroke:#dab878}.anchor{fill:#eee1ff}.frustum{stroke:#f6c16c;stroke-width:1.5;stroke-dasharray:5 4}text{font:18px system-ui,"PingFang SC","Microsoft YaHei",sans-serif;fill:#e5e1ee}.camera{fill:#f6c16c;stroke:#2a2012;stroke-width:2}</style><rect width="1000" height="600" fill="#171b23"/>${grid}${cards}${rays}<polygon fill="none" stroke="#f6c16c" stroke-width="2" points="${corners.map(point).join(' ')}"/><line class="frustum" x1="${cp.x}" y1="${cp.y}" x2="${tp.x}" y2="${tp.y}"/><rect class="camera" x="${cp.x-10}" y="${cp.y-8}" width="20" height="16" rx="3"/><text x="${cp.x}" y="${cp.y>515?cp.y-18:cp.y+30}" text-anchor="middle">本句摄像机</text><text x="24" y="32">${labels[view.mode]} · 空间示意</text><text x="24" y="574" style="font-size:14px;fill:#9da7b8">平面立绘 / 站位与景深 · 黄色线框为镜头方向示意</text></svg>`;
}

export class SceneViewportController{
  constructor({root,host,controls,getProject,getLine,getPerformanceLine,onMutation,onStopPlayback,onActivate,onPreviewRefresh}){
    Object.assign(this,{root,host,controls,getProject,getLine,getPerformanceLine,onMutation,onStopPlayback,onActivate,onPreviewRefresh});
    this.view={mode:'camera',yaw:35,pitch:25,zoom:1,panX:0,panY:0};this.project=null;this.selectedLine=null;this.cancelDrag=null;
    root?.querySelectorAll('[data-stage-view]').forEach(button=>button.addEventListener('click',()=>this.setView(button.dataset.stageView)));
    root?.querySelector('[data-view-frame]')?.addEventListener('click',()=>{this.view.zoom=1;this.view.panX=0;this.view.panY=0;this.render()});
    root?.querySelector('[data-view-apply]')?.addEventListener('click',()=>this.applyAngles());
    host?.addEventListener('pointerdown',e=>this.beginViewDrag(e));
    host?.addEventListener('wheel',e=>{if(this.view.mode==='camera')return;e.preventDefault();this.view.zoom=clamp(this.view.zoom*Math.exp(-e.deltaY*.001),.35,3);this.renderDiagram()},{passive:false});
    host?.addEventListener('keydown',e=>this.key(e));root?.addEventListener('keydown',e=>this.key(e));
    controls?.addEventListener('toggle',()=>{if(controls.open&&this.getLine?.())this.onStopPlayback?.()});
    controls?.querySelectorAll('[data-camera-value]').forEach(input=>{
      input.addEventListener('input',()=>this.editCamera(input.dataset.cameraValue,Number(input.value),false));
      input.addEventListener('change',()=>this.editCamera(input.dataset.cameraValue,Number(input.value),true));
    });
    controls?.querySelectorAll('[data-camera-preset]').forEach(button=>button.addEventListener('click',()=>{
      const preset={front:{yaw:0,pitch:0},left:{yaw:-30,pitch:0},right:{yaw:30,pitch:0},high:{yaw:0,pitch:30},low:{yaw:0,pitch:-20}}[button.dataset.cameraPreset];
      if(preset)this.commitCamera({...this.camera(),...preset},'切换本句摄像机角度');
    }));
  }
  camera(){return effectiveCameraTransform(this.getLine?.()||{},this.getPerformanceLine?.())}
  spatial(){return this.getProject?.()?.sceneGraph?.projection==='2.5d'}
  setView(mode){
    if(mode!=='camera'&&!this.spatial())return;
    this.cancelDrag?.();this.onStopPlayback?.();this.onActivate?.();
    if(mode==='camera')this.view.mode=mode;
    else{const angles=views[mode]||views.free;this.view={...angles,mode,zoom:1,panX:0,panY:0}}
    this.render();
  }
  exit(){if(this.view.mode!=='camera'){this.cancelDrag?.();this.view.mode='camera';this.render()}}
  showCameraControls(){if(this.controls)this.controls.open=true;this.exit();this.controls?.scrollIntoView?.({block:'nearest',behavior:'smooth'})}
  commitCamera(value,label){
    const line=this.getLine?.(),perf=this.getPerformanceLine?.();if(!line||!perf)return;
    this.exit();this.onStopPlayback?.();setCameraTransform(line,value);perf.cameraTransform={...line.cameraTransform};perf.cameraPlacementSource='manual';
    this.onMutation?.(label,`camera-transform:${line.id}`);this.render();this.onPreviewRefresh?.();
  }
  editCamera(key,value,commit){
    const line=this.getLine?.(),perf=this.getPerformanceLine?.();if(!line||!perf)return;
    if((key==='yaw'||key==='pitch')&&!this.spatial())return;
    this.exit();this.onStopPlayback?.();const next=cleanCameraTransform({...this.camera(),[key]:value});setCameraTransform(line,next);perf.cameraTransform={...next};perf.cameraPlacementSource='manual';
    // Capture each input in undo/autosave; changing lines before 'change' cannot lose it.
    this.onMutation?.('调整本句摄像机',`camera-transform:${line.id}`);this.render();this.onPreviewRefresh?.();
  }
  applyAngles(){if(this.view.mode==='camera'||!this.spatial())return;this.commitCamera({...this.camera(),yaw:this.view.yaw,pitch:this.view.pitch},'采用查看角度作为本句镜头');this.setView('camera');if(this.controls)this.controls.open=true}
  beginViewDrag(event){
    if(this.view.mode==='camera'||![0,1].includes(event.button))return;
    event.preventDefault();this.host.focus();const start={...this.view},sx=event.clientX,sy=event.clientY;const pan=event.shiftKey||event.button===1;
    const width=Math.max(1,this.host.getBoundingClientRect().width);this.host.setPointerCapture?.(event.pointerId);
    const move=e=>{if(e.pointerId!==event.pointerId)return;const dx=e.clientX-sx,dy=e.clientY-sy;
      if(pan){this.view.panX=start.panX+dx*1000/width;this.view.panY=start.panY+dy*1000/width}
      else{this.view.mode='free';this.view.yaw=clamp(start.yaw-dx*.4,-180,180);this.view.pitch=clamp(start.pitch+dy*.4,-90,90)}
      this.renderDiagram();this.syncButtons();
    };
    const finish=()=>{this.host.removeEventListener('pointermove',move);this.host.removeEventListener('pointerup',finish);this.host.removeEventListener('pointercancel',finish);this.cancelDrag=null};
    this.cancelDrag?.();this.cancelDrag=finish;
    this.host.addEventListener('pointermove',move);this.host.addEventListener('pointerup',finish);this.host.addEventListener('pointercancel',finish);
  }
  key(e){
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const mode={Numpad0:'camera',Numpad1:'front',Numpad3:'right',Numpad7:'top'}[e.code];
    if(mode){e.preventDefault();this.setView(mode)}
    else if(e.key==='Escape'){e.preventDefault();this.setView('camera')}
    else if(e.key==='Home'){e.preventDefault();this.view.zoom=1;this.view.panX=0;this.view.panY=0;this.renderDiagram()}
  }
  syncButtons(){
    this.root?.querySelectorAll('[data-stage-view]').forEach(button=>{const active=button.dataset.stageView===this.view.mode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));button.disabled=!this.getLine?.()||(button.dataset.stageView!=='camera'&&!this.spatial())});
    for(const name of ['frame','apply']){const button=this.root?.querySelector(`[data-view-${name}]`);if(button)button.hidden=this.view.mode==='camera'}
  }
  renderDiagram(){if(!this.host||this.view.mode==='camera')return;const project=this.getProject?.(),line=this.getLine?.(),perf=this.getPerformanceLine?.();if(project&&line&&perf)this.host.innerHTML=stageSpaceSvg(project,line,perf,this.view)}
  render(){
    const project=this.getProject?.(),line=this.getLine?.(),perf=this.getPerformanceLine?.();
    if(project!==this.project){this.project=project;this.view={mode:'camera',yaw:35,pitch:25,zoom:1,panX:0,panY:0};this.cancelDrag?.()}
    if(line!==this.selectedLine){this.selectedLine=line;this.cancelDrag?.()}
    if(!this.spatial()||!line||!perf)this.view.mode='camera';
    if(this.host){this.host.hidden=this.view.mode==='camera';this.host.tabIndex=this.host.hidden?-1:0;if(this.host.hidden)this.host.innerHTML=''}
    const help=this.host?.ownerDocument.getElementById('sceneViewHelp');if(help)help.hidden=this.view.mode==='camera';
    this.syncButtons();this.renderDiagram();
    const camera=this.camera();
    this.controls?.querySelectorAll('[data-camera-value]').forEach(input=>{
      const key=input.dataset.cameraValue,angle=key==='yaw'||key==='pitch';input.disabled=!line||!perf||(angle&&!this.spatial());
      if(key==='x'||key==='y'){input.min=String(.5/camera.zoom);input.max=String(1-.5/camera.zoom);input.disabled||=camera.zoom===1}
      input.value=String(camera[key]||0);const output=this.controls.querySelector(`[data-camera-readout="${key}"]`);if(output)output.textContent=angle?`${Math.round(camera[key]||0)}°`:key==='zoom'?`${camera.zoom.toFixed(2)}×`:`${Math.round(camera[key]*100)}%`;
    });
    this.controls?.querySelectorAll('[data-camera-preset]').forEach(button=>button.disabled=!line||!perf||!this.spatial());
    const status=this.controls?.querySelector('[data-camera-source]');if(status)status.textContent=!line?'先选择一句台词':`${perf?.cameraPlacementSource==='inherited'?'继承前句':perf?.cameraPlacementSource==='manual'?'本句设置':'默认全景'} · ${this.spatial()?'2.5D':'2D'}`;
  }
}
