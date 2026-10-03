function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0))}
function fmtTime(seconds){const s=Math.max(0,Number(seconds)||0),m=Math.floor(s/60),r=s-m*60;return `${m}:${r.toFixed(1).padStart(4,'0')}`}
async function bytesFromSource(source){
  if(!source)return null;
  if(source instanceof Blob)return await source.arrayBuffer();
  if(source instanceof ArrayBuffer)return source;
  if(source instanceof Uint8Array)return source.buffer.slice(source.byteOffset,source.byteOffset+source.byteLength);
  if(typeof source==='string'){const response=await fetch(source);if(!response.ok)return null;return await response.arrayBuffer()}
  return null;
}

class WaveformPeakCache{
  constructor(){this.memory=new Map();this.dbPromise=null;this.audioContext=null}
  db(){
    if(this.dbPromise)return this.dbPromise;
    this.dbPromise=new Promise(resolve=>{
      if(!('indexedDB' in window)){resolve(null);return}
      const req=indexedDB.open('ReplayLabWaveforms',1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('peaks'))req.result.createObjectStore('peaks')};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null)
    });return this.dbPromise
  }
  async stored(key){const db=await this.db();if(!db)return null;return await new Promise(resolve=>{const req=db.transaction('peaks','readonly').objectStore('peaks').get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>resolve(null)})}
  async store(key,value){const db=await this.db();if(!db)return;try{db.transaction('peaks','readwrite').objectStore('peaks').put(value,key)}catch{}}
  async get(asset,buckets,resolveAsset){
    if(!asset)return null;const signature=JSON.stringify([asset.id,asset.sourcePath,asset.uri,asset.metadata?.updatedAt,asset.metadata?.contentRevision,asset.metadata?.duration,buckets]),cached=this.memory.get(signature);if(cached)return cached;
    const stored=await this.stored(signature);if(stored?.length){const peaks=stored instanceof Float32Array?stored:new Float32Array(stored);this.memory.set(signature,peaks);return peaks}
    try{
      const source=await resolveAsset(asset.id),bytes=await bytesFromSource(source);if(!bytes)return null;
      this.audioContext??=new AudioContext();const buffer=await this.audioContext.decodeAudioData(bytes.slice(0));
      const n=Math.max(32,Math.min(4096,buckets|0)),peaks=new Float32Array(n);const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
      const step=Math.max(1,Math.floor(buffer.length/n));
      for(let i=0;i<n;i++){const start=i*step,end=Math.min(buffer.length,start+step);let max=0;for(const channel of channels){for(let j=start;j<end;j+=Math.max(1,Math.floor(step/32)))max=Math.max(max,Math.abs(channel[j]||0))}peaks[i]=max}
      this.memory.set(signature,peaks);void this.store(signature,peaks);return peaks
    }catch{return null}
  }
}

export class AudioWorkbenchController{
  constructor(options){Object.assign(this,options);this.root=options.root;this.peakCache=new WaveformPeakCache();this.zoom=48;this.trackState={dialogue:true,voice:true,sfx:true,ambient:true,bgm:true};this.muted=new Set();this.solo=new Set();this.lastCrossfadeSeconds=.8;this.bound=false}
  mount(){if(this.bound)return;this.bound=true;this.root.addEventListener('click',e=>this.onClick(e));this.root.addEventListener('input',e=>this.onInput(e));this.root.addEventListener('change',e=>this.onChange(e));this.root.addEventListener('scroll',()=>{},true);this.render()}
  current(){return {project:this.getProject?.(),performance:this.getPerformance?.(),selectedIndex:this.getSelectedIndex?.()??0,playhead:this.getPlayhead?.()??0}}
  render(){
    const {project,performance,selectedIndex,playhead}=this.current();if(!project||!performance){this.root.innerHTML='<div class="audio-empty">导入剧本后会在这里生成 Dialogue / Voice / SFX / Ambient / BGM 音轨。</div>';return}
    const mix=project.settings.audioMix,duration=Math.max(.1,performance.duration),width=Math.max(900,duration*this.zoom),assets=new Map(project.assets.map(a=>[a.id,a]));
    const schedule=this.buildAudioSchedule(performance);
    const timeline=(kind,content)=>`<div class="audio-track ${kind}" data-track="${kind}"><div class="audio-track-head"><button class="audio-track-fold" data-track-fold="${kind}">${this.trackState[kind]?'▾':'▸'}</button><b>${kind==='dialogue'?'对白':kind==='voice'?'人声':kind==='sfx'?'音效':kind==='ambient'?'环境声':'BGM'}</b><span></span><span></span><span></span></div>${this.trackState[kind]?`<div class="audio-track-lane" style="width:${width}px">${content}</div>`:''}</div>`;
    const dialogue=performance.lines.filter(l=>l.type!=='command').map((line,i)=>{const left=line.start*this.zoom,w=Math.max(24,line.duration*this.zoom),selected=performance.lines[selectedIndex]?.lineId===line.lineId?' selected':'';return `<button class="audio-clip dialogue${selected}" data-line-id="${line.lineId}" data-time="${line.start}" style="left:${left}px;width:${w}px"><b>${this.escape(line.speakerName)}</b><span>${this.escape(line.text)}</span><i>🔗</i></button>`}).join('');
    const voice=performance.lines.filter(l=>l.audioAssetId).map(line=>{const asset=assets.get(line.audioAssetId),offset=(Number(line.audioMix?.preRoll)||0)+(Number(line.audioMix?.voiceOffset)||0),start=Math.max(0,line.start+offset),dur=Math.max(.12,Number(asset?.metadata?.duration)||Math.max(.12,line.duration-offset-(Number(line.audioMix?.postRoll)||0))),left=start*this.zoom,w=Math.max(18,dur*this.zoom);return `<button class="audio-clip voice" data-line-id="${line.lineId}" data-time="${line.start}" title="${this.escape(asset?.name||'Voice')}" style="left:${left}px;width:${w}px"><canvas class="waveform" data-wave-asset="${line.audioAssetId}" width="320" height="42"></canvas><span>${this.escape(line.speakerName)}</span><i>🔗</i></button>`}).join('');
    const sfx=schedule.filter(e=>e.kind==='sfx').map(e=>`<button class="audio-clip event" ${e.lineId?`data-line-id="${e.lineId}"`:''} data-time="${e.start}" style="left:${e.start*this.zoom}px;width:${Math.max(42,(e.end?e.end-e.start:.7)*this.zoom)}px">${this.escape(assets.get(e.assetId)?.name||'SFX')}</button>`).join('');
    const longClips=kind=>schedule.filter(e=>e.kind===kind).map(e=>{const dur=Math.max(.2,(e.end??duration)-e.start);return `<button class="audio-clip bed ${kind}" data-time="${e.start}" style="left:${e.start*this.zoom}px;width:${Math.max(60,dur*this.zoom)}px"><span>${this.escape(assets.get(e.assetId)?.name||kind)}</span>${e.fadeIn?'<i class="fade-in">╱</i>':''}${e.fadeOut?'<i class="fade-out">╲</i>':''}</button>`}).join('');
    const rulerTicks=[];const step=duration>600?30:duration>180?10:duration>60?5:1;for(let t=0;t<=duration;t+=step)rulerTicks.push(`<span style="left:${t*this.zoom}px">${fmtTime(t)}</span>`);
    this.lastCrossfadeSeconds=Math.max(.1,Number(mix.bgmCrossfadeSeconds)||this.lastCrossfadeSeconds||.8);
    this.root.innerHTML=`
      <div class="audio-mixer-panel">
        <div class="audio-mixer-title"><strong>声音</strong><span class="muted">常用设置</span></div>
        <div class="audio-mixer-strip audio-mixer-common">
          ${this.slider('人声','voiceVolume',mix.voiceVolume)}${this.slider('背景音乐','bgmVolume',mix.bgmVolume)}${this.slider('环境声','ambientVolume',mix.ambientVolume)}${this.slider('音效','sfxVolume',mix.sfxVolume)}
          <label class="audio-toggle"><input type="checkbox" data-mix-check="ducking" ${mix.ducking.enabled?'checked':''}> 对白时自动降低背景音乐</label>
          <label class="audio-toggle"><input type="checkbox" data-mix-check="bgmFade" ${Number(mix.bgmCrossfadeSeconds)>0?'checked':''}> BGM 自动淡入淡出</label>
        </div>
        <details class="audio-advanced advanced-only"><summary>精确混音</summary><div class="audio-mixer-strip disclosure-body">
          ${this.slider('总音量','masterVolume',mix.masterVolume)}
          <label>淡入淡出时长 <input class="mini-range" type="range" min="0" max="3" step="0.1" value="${mix.bgmCrossfadeSeconds}" data-mix="bgmCrossfadeSeconds"><span>${mix.bgmCrossfadeSeconds.toFixed(1)}s</span></label>
          <label class="audio-toggle"><input type="checkbox" data-mix-check="limiter" ${mix.limiter.enabled?'checked':''}> 输出保护（Limiter）</label>
        </div><div class="muted audio-advanced-note">普通制作通常不需要修改这些参数；Limiter 建议保持开启。</div></details>
      </div>
      <div class="audio-timeline-shell">
        <div class="audio-timeline-toolbar"><button class="small" data-audio-zoom="out">−</button><span>时间线 ${Math.round(this.zoom)} px/s</span><button class="small" data-audio-zoom="in">＋</button><button class="small" data-center-playhead>定位播放头</button><span class="muted">Dialogue 与 Voice 默认按 lineId 锁定</span></div>
        <div class="audio-scroll" data-audio-scroll>
          <div class="audio-ruler" style="width:${width}px">${rulerTicks.join('')}<i class="audio-playhead" style="left:${playhead*this.zoom}px"></i></div>
          ${timeline('dialogue',dialogue)}${timeline('voice',voice)}${timeline('sfx',sfx)}${timeline('ambient',longClips('ambient'))}${timeline('bgm',longClips('bgm'))}
        </div>
      </div>`;
    this.applyTrackVisibility();void this.hydrateWaveforms(assets);this.centerSelected(false)
  }
  slider(label,key,value){return `<label>${label}<input class="mini-range" type="range" min="0" max="1.5" step="0.01" value="${Number(value)||0}" data-mix="${key}"><span>${Math.round((Number(value)||0)*100)}%</span></label>`}
  buildAudioSchedule(performance){return this.scheduleBuilder?this.scheduleBuilder(performance):[]}
  escape(v){return this.escapeHtml?this.escapeHtml(v):String(v??'')}
  async hydrateWaveforms(assets){const canvases=[...this.root.querySelectorAll('canvas[data-wave-asset]')];await Promise.all(canvases.map(async canvas=>{const id=canvas.dataset.waveAsset,asset=assets.get(id),peaks=await this.peakCache.get(asset,Math.max(64,Math.min(1024,canvas.clientWidth*2||320)),this.resolveAsset);if(!peaks||!canvas.isConnected)return;const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='rgba(155,190,255,.78)';const mid=h/2;for(let x=0;x<w;x++){const p=peaks[Math.floor(x/w*peaks.length)]||0,amp=Math.max(1,p*(h*.46));ctx.fillRect(x,mid-amp,1,amp*2)}}))}
  onClick(e){const button=e.target.closest('button');if(!button)return;if(button.dataset.lineId){this.onSelectLine?.(button.dataset.lineId);this.onSeek?.(Number(button.dataset.time)||0);return}if(button.dataset.time){this.onSeek?.(Number(button.dataset.time)||0);return}if(button.dataset.trackFold){const k=button.dataset.trackFold;this.trackState[k]=!this.trackState[k];this.render();return}if(button.dataset.audioZoom){this.zoom=clamp(this.zoom*(button.dataset.audioZoom==='in'?1.35:.74),12,220);this.render();return}if(button.hasAttribute('data-center-playhead'))this.centerSelected(true)}
  onInput(e){const input=e.target;if(input.dataset.mix){const project=this.getProject?.();if(!project)return;const mix=project.settings.audioMix,key=input.dataset.mix,value=Number(input.value);if(key==='bgmCrossfadeSeconds'){mix.bgmCrossfadeSeconds=clamp(value,0,6);if(mix.bgmCrossfadeSeconds>0)this.lastCrossfadeSeconds=mix.bgmCrossfadeSeconds}else mix[key]=clamp(value,0,1.5);if(key==='bgmVolume')project.settings.bgmVolume=mix.bgmVolume;if(key==='sfxVolume')project.settings.sfxVolume=mix.sfxVolume;input.nextElementSibling&&(input.nextElementSibling.textContent=key==='bgmCrossfadeSeconds'?`${mix.bgmCrossfadeSeconds.toFixed(1)}s`:`${Math.round(value*100)}%`);this.onMutate?.('修改音频混音','audio-mix',false)}}
  onChange(e){const input=e.target,project=this.getProject?.();if(!project)return;if(input.dataset.mixCheck==='ducking'){project.settings.audioMix.ducking.enabled=input.checked;this.onMutate?.('切换对白背景压低','audio-ducking',true)}if(input.dataset.mixCheck==='bgmFade'){const mix=project.settings.audioMix;if(input.checked)mix.bgmCrossfadeSeconds=Math.max(.1,this.lastCrossfadeSeconds||.8);else{if(mix.bgmCrossfadeSeconds>0)this.lastCrossfadeSeconds=mix.bgmCrossfadeSeconds;mix.bgmCrossfadeSeconds=0}this.onMutate?.('切换 BGM 淡入淡出','audio-bgm-fade',true)}if(input.dataset.mixCheck==='limiter'){project.settings.audioMix.limiter.enabled=input.checked;this.onMutate?.('切换 Master Limiter','audio-limiter',true)}}
  applyTrackVisibility(){}
  updatePlayhead(time){const playhead=this.root.querySelector('.audio-playhead');if(playhead)playhead.style.left=`${Math.max(0,Number(time)||0)*this.zoom}px`}
  centerSelected(smooth=true){const scroll=this.root.querySelector('[data-audio-scroll]'),{playhead}=this.current();if(!scroll)return;const target=Math.max(0,playhead*this.zoom-scroll.clientWidth*.42);scroll.scrollTo({left:target,behavior:smooth?'smooth':'auto'})}
}
