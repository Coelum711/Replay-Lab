import { CanvasStageRenderer, BrowserReplayPlayer, VNReplayRuntime, CustomObjectInteractionController } from './dist/index.js';

const $=s=>document.querySelector(s);
const performanceDoc=await fetch('./performance.json').then(r=>{if(!r.ok)throw new Error(`performance.json ${r.status}`);return r.json()});
$('#title').textContent=performanceDoc.title||'Replay Lab';document.title=`${performanceDoc.title||'Replay Lab'} · Player`;
async function resolveAsset(ref){
  if(!ref)return null;if(/^(data:|blob:|https?:)/i.test(ref))return ref;
  const asset=performanceDoc.assets.find(a=>a.id===ref||a.name===ref||a.sourcePath===ref||a.sourcePath?.endsWith('/'+ref));
  if(!asset)return null;
  if(asset.uri&&!asset.uri.startsWith('project://'))return asset.uri;
  const path=asset.sourcePath||(asset.uri?.startsWith('project://')?asset.uri.slice('project://'.length):null);
  return path?`./${path.replace(/^\/+/, '')}`:null;
}
const renderer=new CanvasStageRenderer({canvas:$('#stage'),performance:performanceDoc,resolveAsset});
const mediaPlayer=new BrowserReplayPlayer(performanceDoc,renderer,resolveAsset);
let runtime;
const objectInteraction=new CustomObjectInteractionController(performanceDoc,renderer,{onInteraction(event){const object=performanceDoc.customObjects?.find(item=>item.id===event.objectId);const name=object?.name||'对象';const text=event.kind==='note'?(event.note||name):event.kind==='state'?`${name} · 状态切换`:event.kind==='hide'?`${name} · 已关闭`:event.kind==='inspect-open'?`${name} · 查看`:event.kind==='inspect-close'?`${name} · 关闭查看`:event.kind==='pan'?`${name} · 拖动`:event.kind==='zoom'?`${name} · 缩放`:`${name} · 交互`;const hud=$('#objectHint');hud.textContent=text;hud.hidden=false;clearTimeout(objectHintTimer);objectHintTimer=setTimeout(()=>hud.hidden=true,1600)}});
let objectHintTimer=null;
let objectDrag=null;
function renderLog(){const host=$('#log');host.innerHTML=runtime.backlog().map(e=>`<div class="entry"><b>${escapeHtml(e.speaker)}</b>${escapeHtml(e.text)}</div>`).join('')||'<div class="muted">还没有已读台词。</div>';host.scrollTop=host.scrollHeight}
function escapeHtml(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
runtime=new VNReplayRuntime(performanceDoc,renderer,mediaPlayer,{onLine(index,line){objectInteraction.setLine(index);$('#position').textContent=`${index+1} / ${performanceDoc.lines.length}`;if(!$('#log').hidden)renderLog()},onMode({auto,skip}){$('#auto').classList.toggle('active',auto);$('#skip').classList.toggle('active',skip);$('#mode').textContent=skip?'SKIP':auto?'AUTO':'手动'},onEnd(){$('#mode').textContent='END'}});
if(performanceDoc.lines.length)await runtime.start(0);else $('#position').textContent='0 / 0';
$('#next').onclick=()=>void runtime.next();$('#prev').onclick=()=>void runtime.previous();$('#auto').onclick=()=>runtime.toggleAuto();$('#skip').onclick=()=>runtime.toggleSkip();$('#restart').onclick=()=>void runtime.restart(0);$('#backlog').onclick=()=>{$('#log').hidden=!$('#log').hidden;if(!$('#log').hidden)renderLog()};
window.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='Enter'||e.key===' '){if(!e.target.matches?.('button')){e.preventDefault();void runtime.next()}}else if(e.key==='ArrowLeft'){e.preventDefault();void runtime.previous()}else if(e.key==='Escape'&&!$('#log').hidden)$('#log').hidden=true});


function canvasPoint(event){const canvas=$('#stage'),rect=canvas.getBoundingClientRect();return {x:(event.clientX-rect.left)*canvas.width/Math.max(1,rect.width),y:(event.clientY-rect.top)*canvas.height/Math.max(1,rect.height),nx:(event.clientX-rect.left)/Math.max(1,rect.width),ny:(event.clientY-rect.top)/Math.max(1,rect.height)}}
async function refreshInteractiveFrame(){const line=performanceDoc.lines[runtime.index];if(line)await renderer.renderLine(runtime.index,line.duration)}
$('#stage').addEventListener('pointerdown',event=>{const point=canvasPoint(event),hit=renderer.customObjectHitTest(point.x,point.y);if(!hit)return;const object=performanceDoc.customObjects?.find(item=>item.id===hit.objectId);if(object?.interactionMode==='pan-zoom'){objectDrag={objectId:hit.objectId,x:event.clientX,y:event.clientY,moved:false};event.currentTarget.setPointerCapture?.(event.pointerId);event.preventDefault()}});
$('#stage').addEventListener('pointermove',event=>{if(!objectDrag)return;const rect=$('#stage').getBoundingClientRect(),dx=(event.clientX-objectDrag.x)/Math.max(1,rect.width),dy=(event.clientY-objectDrag.y)/Math.max(1,rect.height);if(Math.abs(dx)+Math.abs(dy)<.001)return;objectDrag.moved=true;objectDrag.x=event.clientX;objectDrag.y=event.clientY;objectInteraction.panBy(objectDrag.objectId,dx,dy);void refreshInteractiveFrame()});
$('#stage').addEventListener('pointerup',event=>{const point=canvasPoint(event);if(objectDrag){const moved=objectDrag.moved;objectDrag=null;if(moved){void refreshInteractiveFrame();return}}const result=objectInteraction.interactAt(point.x,point.y);if(result){event.preventDefault();void refreshInteractiveFrame()}});
$('#stage').addEventListener('wheel',event=>{const point=canvasPoint(event),hit=renderer.customObjectHitTest(point.x,point.y);if(!hit)return;const object=performanceDoc.customObjects?.find(item=>item.id===hit.objectId);if(object?.interactionMode!=='pan-zoom')return;event.preventDefault();objectInteraction.zoomBy(hit.objectId,event.deltaY<0?1.08:.92);void refreshInteractiveFrame()},{passive:false});
