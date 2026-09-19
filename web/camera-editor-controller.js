import {
  effectiveCameraTransform,
  setCameraTransform,
  inheritCameraTransform,
  resetCameraTransform
} from '../dist/index.js';

function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
function cleanForZoom(transform){
  const zoom=clamp(Number(transform.zoom)||1,1,4),half=.5/zoom;
  return {x:clamp(Number(transform.x)||.5,half,1-half),y:clamp(Number(transform.y)||.5,half,1-half),zoom};
}

const SOURCE_LABEL={auto:'全景',manual:'手调',inherited:'继承'};

export class CameraDirectEditorController {
  constructor({host,toggle,hint,inheritButton,resetButton,getLine,getPerformanceLine,onMutation,onStopPlayback,onPreviewRefresh,onActivate}){
    this.host=host;this.toggleButton=toggle;this.hint=hint;this.inheritButton=inheritButton;this.resetButton=resetButton;
    this.getLine=getLine;this.getPerformanceLine=getPerformanceLine;this.onMutation=onMutation;this.onStopPlayback=onStopPlayback;this.onPreviewRefresh=onPreviewRefresh;this.onActivate=onActivate;this.active=false;
    if(toggle)toggle.onclick=()=>this.toggle();
    if(inheritButton)inheritButton.onclick=()=>this.inherit();
    if(resetButton)resetButton.onclick=()=>this.reset();
  }
  current(){return {line:this.getLine?.(),perf:this.getPerformanceLine?.()}}
  toggle(){this.active=!this.active;if(this.active)this.onActivate?.();this.onStopPlayback?.();this.render();this.onPreviewRefresh?.()}
  exit(){if(!this.active)return;this.active=false;this.render()}
  inherit(){const {line}=this.current();if(!line)return;inheritCameraTransform(line);this.onMutation?.('镜头继承上一帧',`camera-inherit:${line.id}`)}
  reset(){const {line}=this.current();if(!line)return;resetCameraTransform(line);this.onMutation?.('镜头恢复全景',`camera-reset:${line.id}`)}
  applyLive(line,perf,next){const clean=cleanForZoom(next);setCameraTransform(line,clean);if(perf){perf.cameraTransform={...clean};perf.cameraPlacementSource='manual'}this.onPreviewRefresh?.();return clean}
  beginPan(event){if(event.button!==0||event.target.closest('button,.camera-zoom-handle'))return;event.preventDefault();event.stopPropagation();
    const {line,perf}=this.current();if(!line||!perf)return;const bounds=this.host.getBoundingClientRect();const start=effectiveCameraTransform(line,perf),sx=event.clientX,sy=event.clientY;this.host.setPointerCapture?.(event.pointerId);this.host.classList.add('dragging');
    const move=e=>{const dx=(e.clientX-sx)/Math.max(1,bounds.width),dy=(e.clientY-sy)/Math.max(1,bounds.height);this.applyLive(line,perf,{...start,x:start.x-dx/start.zoom,y:start.y-dy/start.zoom})};
    const up=()=>{this.host.classList.remove('dragging');this.host.removeEventListener('pointermove',move);this.host.removeEventListener('pointerup',up);this.host.removeEventListener('pointercancel',up);this.onMutation?.('拖动画面重新取景',`camera-transform:${line.id}`)};
    this.host.addEventListener('pointermove',move);this.host.addEventListener('pointerup',up);this.host.addEventListener('pointercancel',up);
  }
  beginZoom(event){if(event.button!==0)return;event.preventDefault();event.stopPropagation();const {line,perf}=this.current();if(!line||!perf)return;const start=effectiveCameraTransform(line,perf),sy=event.clientY;const handle=event.currentTarget;handle.setPointerCapture?.(event.pointerId);this.host.classList.add('zooming');
    const move=e=>{const zoom=clamp(start.zoom*Math.exp((sy-e.clientY)/150),1,4);this.applyLive(line,perf,{...start,zoom})};
    const up=()=>{this.host.classList.remove('zooming');handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);this.onMutation?.('拖动镜头缩放',`camera-transform:${line.id}`)};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',up);
  }
  wheel(event){if(!this.active)return;event.preventDefault();const {line,perf}=this.current();if(!line||!perf)return;const start=effectiveCameraTransform(line,perf),factor=Math.exp(-event.deltaY*.0012);this.applyLive(line,perf,{...start,zoom:clamp(start.zoom*factor,1,4)});clearTimeout(this.wheelTimer);this.wheelTimer=setTimeout(()=>this.onMutation?.('滚轮调整镜头缩放',`camera-transform:${line.id}`),180)}
  render(){const host=this.host,toggle=this.toggleButton,hint=this.hint,{line,perf}=this.current();if(!host||!toggle)return;toggle.classList.toggle('active',this.active);toggle.textContent=this.active?'完成取景':'调整镜头';if(hint)hint.hidden=!this.active;if(this.inheritButton)this.inheritButton.disabled=!line||!perf;if(this.resetButton)this.resetButton.disabled=!line||!perf;host.hidden=!this.active||!line||!perf;if(host.hidden){host.innerHTML='';return}
    const transform=effectiveCameraTransform(line,perf),source=line.cameraTransform!==undefined?'manual':(perf.cameraPlacementSource||'auto');
    host.innerHTML=`<div class="camera-reticle"></div><div class="camera-editor-label"><strong>镜头取景</strong><span>${SOURCE_LABEL[source]||source}</span><span>${transform.zoom>1.02?'已推近':'全景'}</span></div><div class="camera-editor-help">拖动画面平移 · 上下拖 ↕ 或滚轮缩放</div><button type="button" class="camera-zoom-handle" title="上下拖动缩放镜头">↕</button>`;
    host.onpointerdown=e=>this.beginPan(e);host.onwheel=e=>this.wheel(e);host.querySelector('.camera-zoom-handle').onpointerdown=e=>this.beginZoom(e);
  }
}
