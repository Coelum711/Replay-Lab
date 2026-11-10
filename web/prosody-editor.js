import {normalizeProsodyCurve,prosodyIsFlat,prosodyOffsetAt,prosodyInstruction} from '../dist/speech/prosody.js';
import {decodeRecording,fineTuneRecording} from './prosody-audio.js';

const svgNS='http://www.w3.org/2000/svg';
const flat=()=>Array.from({length:9},(_,i)=>({position:i/8,semitones:0}));
export function createProsodyEditor(api){
  const root=document.querySelector('#prosodyEditor'),$=s=>root.querySelector(s);
  let owner=null,sessions=new Map(),active=null,busy=false,controller=null,selection=4,drag=null,cancellable=true;
  const audio=$('#prosodyAudio');
  const message=(value)=>{$('#prosodyStatus').textContent=value;};
  const pointCurve=()=>{const curve=normalizeProsodyCurve(api.context()?.line.speech?.prosodyCurve);return Array.from({length:9},(_,i)=>({position:i/8,semitones:prosodyOffsetAt(curve,i/8)}));};
  const contextKey=c=>JSON.stringify([c.fingerprint,c.line.audioAssetId??null,c.sourceRevision]);
  const node=(name,attrs={})=>{const el=document.createElementNS(svgNS,name);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,String(v));return el;};
  function cleanup(){controller?.abort();audio.pause();audio.removeAttribute('src');for(const s of sessions.values())for(const t of s.takes)URL.revokeObjectURL(t.url);sessions=new Map();active=null;}
  function getSession(c){if(owner!==c.project){cleanup();owner=c.project;}let s=sessions.get(c.line.id);if(!s){s={takes:[],selected:null,decoded:null,key:''};sessions.set(c.line.id,s);}return s;}
  function curveChanged(curve){const c=api.context();if(!c||busy)return;c.line.speech??={};c.line.speech.prosodyCurve=normalizeProsodyCurve(curve);api.changed();draw();}
  function draw(){
    const c=api.context();if(!c)return;
    const curve=pointCurve(),svg=$('#prosodyCurve');svg.replaceChildren();
    for(const y of [20,100,180])svg.append(node('line',{x1:30,y1:y,x2:670,y2:y,class:y===100?'prosody-zero':'prosody-grid'}));
    const waveform=active?.decoded?.channels?.[0];
    if(waveform){let d='';for(let i=0;i<160;i++){const start=Math.floor(i*waveform.length/160),end=Math.floor((i+1)*waveform.length/160);let peak=0;for(let k=start;k<end;k+=Math.max(1,Math.floor((end-start)/64)))peak=Math.max(peak,Math.abs(waveform[k]));d+=`M${30+i*4} ${100-peak*60}v${peak*120} `;}svg.append(node('path',{d,class:'prosody-wave'}));}
    svg.append(node('polyline',{points:curve.map(p=>`${30+p.position*640},${100-p.semitones*20}`).join(' '),class:'prosody-line'}));
    curve.forEach((p,i)=>{const dot=node('circle',{cx:30+p.position*640,cy:100-p.semitones*20,r:7,'data-point':i,tabindex:busy?-1:0,role:'slider','aria-label':`句子 ${Math.round(p.position*100)}% 位置的音高调整`,'aria-valuemin':-4,'aria-valuemax':4,'aria-valuenow':p.semitones,'aria-valuetext':`${p.semitones.toFixed(1)} 半音`,class:i===selection?'prosody-point selected':'prosody-point'});svg.append(dot);});
    const chosen=curve[Math.min(selection,curve.length-1)];
    $('#prosodyAmount').value=chosen.semitones;$('#prosodyPosition').value=String(Math.min(selection,curve.length-1));
    $('#prosodyValue').textContent=`${chosen.semitones>0?'+':''}${chosen.semitones.toFixed(1)} 半音`;
    $('#prosodyPrompt').textContent=prosodyInstruction(curve,c.spokenText)||'平线：不附加语调提示，保留自然起伏。';
    $('#prosodyWords').textContent=c.spokenText;
    const marker=node('line',{x1:30,y1:12,x2:30,y2:188,class:'prosody-playhead',id:'prosodyPlayhead'});svg.append(marker);
  }
  function selectTake(id){const take=active?.takes.find(t=>t.id===id);if(!take)return;active.selected=id;audio.src=take.url;audio.hidden=false;$('#prosodyTakeInfo').textContent=`${take.label}${take.curve?' · 曲线：'+take.curve.map(p=>p.semitones.toFixed(1)).join(' / '):''}`;refreshControls();}
  function refreshTakes(){const select=$('#prosodyTake');select.replaceChildren();for(const take of active?.takes||[]){const opt=document.createElement('option');opt.value=take.id;opt.textContent=take.label;select.append(opt);}select.value=active?.selected||'';refreshControls();}
  function refreshControls(){const c=api.context(),take=active?.takes.find(t=>t.id===active.selected),locked=busy||api.isBusy();
    for(const id of ['prosodyLoad','prosodySource','prosodyReset','prosodyPosition','prosodyAmount','prosodyTake'])$('#'+id).disabled=locked||!c;
    $('#prosodyFineTune').disabled=locked||!active?.base;
    $('#prosodyReenact').disabled=locked||!c?.canReenact;
    $('#prosodyAdopt').disabled=locked||!take;
    $('#prosodyDownload').disabled=locked||!take;
    $('#prosodyDelete').disabled=locked||!take||take===active?.base;
    $('#prosodyCancel').hidden=!busy;$('#prosodyCancel').disabled=!busy||!cancellable;
    $('#prosodyModeHint').textContent=c?.canReenact?'实验情绪已接通：按曲线重录会近似遵循指令。':'本地微调可用；按曲线重录需要角色开启「实验：克隆 + 情绪」及 1.7B。';
  }
  function refresh(){const c=api.context();root.hidden=!c;if(!c){if(owner)cleanup();owner=null;return;}const session=getSession(c);if(active!==session){audio.pause();audio.removeAttribute('src');audio.hidden=true;active=session;message('载入当前录音后可试听微调；曲线重录也可直接使用。');}
    if(!c.line.speech?.prosodyCurve){selection=4;}
    const points=Array.from({length:9},(_,i)=>({position:i/8,semitones:prosodyOffsetAt(pointCurve(),i/8)}));
    const positions=$('#prosodyPosition');positions.replaceChildren();points.forEach((p,i)=>{const opt=document.createElement('option');opt.value=String(i);opt.textContent=`${Math.round(p.position*100)}%`;positions.append(opt);});
    // UI uses nine evenly spaced handles; imported denser curves remain untouched until edited.
    if(pointCurve().length!==9)selection=Math.min(selection,pointCurve().length-1);
    const source=$('#prosodySource'),previous=source.value;source.replaceChildren();
    for(const item of [{id:'',label:'当前工程录音'},...(api.versions?.()||[])]){const opt=document.createElement('option');opt.value=item.id;opt.textContent=item.label;source.append(opt);}source.value=[...source.options].some(o=>o.value===previous)?previous:'';
    refreshTakes();draw();if(active?.selected&&audio.hidden)selectTake(active.selected);
  }
  function capture(){const c=api.context();if(!c)throw new Error('请先选择一句台词。');const key=contextKey(c),curve=JSON.stringify(c.line.speech?.prosodyCurve);
    return {c,assert(){controller?.signal.throwIfAborted();const now=api.context();if(!now||now.project!==c.project||now.line!==c.line||contextKey(now)!==key||JSON.stringify(now.line.speech?.prosodyCurve)!==curve)throw new Error('当前句、原录音或设置已改变；结果没有替换工程音频。');}};
  }
  function addTake(take){take.id=crypto.randomUUID();take.url=URL.createObjectURL(take.blob);active.takes.push(take);refreshTakes();selectTake(take.id);}
  async function run(action,canCancel=true){if(busy||api.isBusy())return;busy=true;cancellable=canCancel;controller=new AbortController();refreshControls();
    try{await action(controller.signal);}catch(error){message(error.name==='AbortError'?'已取消等待，原录音保留；已发出的模型计算可能仍在后台完成。':error.message||String(error));}finally{busy=false;controller=null;refresh();}}
  async function load(){const guard=capture(),sourceId=$('#prosodySource').value,blob=sourceId?await api.assetAudio(sourceId):await api.audio(guard.c.line);guard.assert();if(!blob)throw new Error('当前句没有可读取的录音，请先生成或导入音频。');const decoded=await (api.decode||decodeRecording)(blob);guard.assert();
    if(active.takes.length>=12)throw new Error('本句已有 12 个试听版本，请先下载并删除不需要的候选。');
    const take={blob,label:`原录音 ${active.takes.filter(t=>t.original).length+1}`,original:true,inputAssetId:sourceId||guard.c.line.audioAssetId||null,fingerprint:guard.c.fingerprint,duration:decoded.duration};
    addTake(take);active.base=take;active.decoded=decoded;active.key=contextKey(guard.c);draw();message(`已载入 ${decoded.duration.toFixed(2)} 秒录音。调整曲线后点击试听微调。`);
  }
  $('#prosodyLoad').addEventListener('click',()=>run(load));
  $('#prosodyReset').addEventListener('click',()=>{curveChanged(flat());message('曲线已归零，原版与试听候选保留。');});
  $('#prosodyPosition').addEventListener('change',e=>{selection=Number(e.target.value);draw();});
  $('#prosodyAmount').addEventListener('input',e=>{const curve=pointCurve();curve[selection].semitones=Number(e.target.value);curveChanged(curve);});
  const svg=$('#prosodyCurve');
  svg.addEventListener('pointerdown',e=>{if(busy)return;const c=pointCurve(),box=svg.getBoundingClientRect(),position=Math.max(0,Math.min(1,((e.clientX-box.left)/box.width*700-30)/640));selection=e.target.hasAttribute('data-point')?Number(e.target.getAttribute('data-point')):c.reduce((best,p,i)=>Math.abs(p.position-position)<Math.abs(c[best].position-position)?i:best,0);drag=e.pointerId;svg.setPointerCapture?.(e.pointerId);move(e);});
  function move(e){if(drag!==e.pointerId||busy)return;const box=svg.getBoundingClientRect();if(!box.height)return;const value=Math.max(-4,Math.min(4,(100-(e.clientY-box.top)/box.height*200)/20)),curve=pointCurve();curve[selection].semitones=Math.round(value*10)/10;curveChanged(curve);}
  svg.addEventListener('pointermove',move);svg.addEventListener('pointerup',()=>{drag=null;});svg.addEventListener('pointercancel',()=>{drag=null;});
  svg.addEventListener('keydown',e=>{if(busy||!e.target.hasAttribute('data-point'))return;selection=Number(e.target.getAttribute('data-point'));const curve=pointCurve();if(['ArrowUp','ArrowDown','Home'].includes(e.key)){e.preventDefault();curve[selection].semitones=e.key==='Home'?0:Math.max(-4,Math.min(4,curve[selection].semitones+(e.key==='ArrowUp'?.1:-.1)));curveChanged(curve);svg.querySelector(`[data-point="${selection}"]`)?.focus();}});
  $('#prosodyFineTune').addEventListener('click',()=>run(async signal=>{const guard=capture();if(active.key!==contextKey(guard.c))throw new Error('原录音或设置已改变，请点击「载入当前录音」刷新。');if(active.takes.length>=12)throw new Error('本句已有 12 个试听版本，请先下载并删除不需要的候选。');const curve=pointCurve();message('正在本地处理音高…');const blob=await (api.fineTune||fineTuneRecording)(active.base.blob,active.decoded,curve,{signal});guard.assert();addTake({blob,label:prosodyIsFlat(curve)?'平线 · 原录音副本':`微调 ${active.takes.length}`,curve,fingerprint:guard.c.fingerprint,duration:active.decoded.duration,inputAssetId:active.base.inputAssetId,kind:'pitch-curve'});message('微调已就绪。试听后点击「采用所选版本」才会更换工程音频。');await audio.play().catch(()=>{});}));
  $('#prosodyReenact').addEventListener('click',()=>run(async signal=>{const guard=capture(),curve=pointCurve();if(active.takes.length>=12)throw new Error('本句已有 12 个试听版本，请先下载并删除不需要的候选。');message('正在请求实验情绪桥重录…');const prepared=await api.generate(guard.c.line,curve,guard.assert,signal);signal.throwIfAborted();guard.assert();const blob=prepared.ttsResult.audio instanceof Blob?prepared.ttsResult.audio:new Blob([prepared.ttsResult.audio],{type:prepared.ttsResult.mime});addTake({blob,label:`曲线重录 ${active.takes.length+1}`,curve,fingerprint:guard.c.fingerprint,prepared,duration:prepared.ttsResult.duration,kind:'curve-instruct'});message('重录候选已就绪；模型近似遵循曲线，请试听比较。');await audio.play().catch(()=>{});}));
  $('#prosodyTake').addEventListener('change',e=>selectTake(e.target.value));
  $('#prosodyAdopt').addEventListener('click',()=>run(async()=>{const guard=capture(),take=active.takes.find(t=>t.id===active.selected);if(!take)return;if(take.fingerprint!==guard.c.fingerprint)throw new Error('声音或台词设置已改变，这个候选仍可试听和下载；请按当前设置重新生成。');await api.adopt(guard.c.line,take);active.key='';message('已采用所选版本。原素材保留在工程中；继续微调请重新载入当前录音。');},false));
  $('#prosodyDownload').addEventListener('click',()=>run(async()=>{const take=active.takes.find(t=>t.id===active.selected);if(take)await api.download(take.blob,`voice-${take.kind||'original'}-${take.id}.${take.blob.type.includes('mpeg')?'mp3':take.blob.type.includes('ogg')?'ogg':take.blob.type.includes('webm')?'webm':take.blob.type.includes('mp4')?'m4a':take.blob.type.includes('flac')?'flac':'wav'}`);}));
  $('#prosodyDelete').addEventListener('click',()=>{const take=active.takes.find(t=>t.id===active.selected);if(!take||take===active.base)return;audio.pause();URL.revokeObjectURL(take.url);active.takes=active.takes.filter(t=>t!==take);active.selected=active.base?.id||active.takes[0]?.id;refreshTakes();if(active.selected)selectTake(active.selected);else{audio.removeAttribute('src');audio.hidden=true;}});
  $('#prosodyCancel').addEventListener('click',()=>controller?.abort());
  audio.addEventListener('timeupdate',()=>{const marker=$('#prosodyPlayhead');if(marker&&audio.duration){const x=30+640*audio.currentTime/audio.duration;marker.setAttribute('x1',x);marker.setAttribute('x2',x);}});
  window.addEventListener('beforeunload',e=>{if(busy||[...sessions.values()].some(s=>s.takes.some(t=>!t.original))){e.preventDefault();e.returnValue='';}});
  return {refresh,isBusy:()=>busy};
}
