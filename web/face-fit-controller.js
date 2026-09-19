export const FACE_FEATURE_LABELS={eyes:'双眼',eyelids:'双眼皮',pupils:'双瞳孔',brows:'双眉',leftEye:'画面左眼',rightEye:'画面右眼',leftEyelid:'画面左眼皮',rightEyelid:'画面右眼皮',leftPupil:'画面左瞳孔',rightPupil:'画面右瞳孔',leftBrow:'画面左眉',rightBrow:'画面右眉',mouth:'嘴巴'};
export const FACE_BASIC_FEATURES=['eyes','eyelids','pupils','brows','mouth'];
export const FACE_SPLIT_FEATURES=['leftEye','rightEye','leftBrow','rightBrow','leftPupil','rightPupil','leftEyelid','rightEyelid'];

const FACE_PREVIEW_COLORS={eyes:'#66b4ff',eyelids:'#b087ff',pupils:'#72d6b0',brows:'#ffd36c',leftEye:'#66b4ff',rightEye:'#66b4ff',leftEyelid:'#b087ff',rightEyelid:'#b087ff',leftPupil:'#72d6b0',rightPupil:'#72d6b0',leftBrow:'#ffd36c',rightBrow:'#ffd36c',mouth:'#ff8d8d'};
const FACE_PREVIEW_PRIMARY_SLOT={eyes:'eyesOpen',eyelids:'eyelidsOpen',pupils:'pupils',brows:'brows',leftEye:'eyeLeftOpen',rightEye:'eyeRightOpen',leftEyelid:'eyelidLeftOpen',rightEyelid:'eyelidRightOpen',leftPupil:'pupilLeft',rightPupil:'pupilRight',leftBrow:'browLeft',rightBrow:'browRight',mouth:'mouthClosed'};

export function faceFeatureEditorMarkup(feature,fit){
  return `<details><summary>${FACE_FEATURE_LABELS[feature]} <span class="summary-meta">x ${Number(fit.x).toFixed(2)} · y ${Number(fit.y).toFixed(2)}</span></summary><div class="grid2 disclosure-body"><label class="muted">中心 X<input data-face-feature="${feature}" data-face-key="x" type="number" min="-0.5" max="1.5" step="0.01" value="${Number(fit.x).toFixed(2)}"></label><label class="muted">中心 Y<input data-face-feature="${feature}" data-face-key="y" type="number" min="-0.5" max="1.5" step="0.01" value="${Number(fit.y).toFixed(2)}"></label><label class="muted">缩放 X<input data-face-feature="${feature}" data-face-key="scaleX" type="number" min="0.15" max="4" step="0.05" value="${Number(fit.scaleX).toFixed(2)}"></label><label class="muted">缩放 Y<input data-face-feature="${feature}" data-face-key="scaleY" type="number" min="0.15" max="4" step="0.05" value="${Number(fit.scaleY).toFixed(2)}"></label><label class="muted">偏移 X<input data-face-feature="${feature}" data-face-key="offsetX" type="number" min="-0.5" max="0.5" step="0.01" value="${Number(fit.offsetX).toFixed(2)}"></label><label class="muted">偏移 Y<input data-face-feature="${feature}" data-face-key="offsetY" type="number" min="-0.5" max="0.5" step="0.01" value="${Number(fit.offsetY).toFixed(2)}"></label><label class="muted">旋转（弧度）<input data-face-feature="${feature}" data-face-key="rotation" type="number" min="-1.57" max="1.57" step="0.01" value="${Number(fit.rotation).toFixed(2)}"></label></div></details>`;
}

function combinedFacePreviewRef(character,template,feature){
  const slot=FACE_PREVIEW_PRIMARY_SLOT[feature];
  return character.layers?.[slot]||template?.layers?.[slot]||null;
}
function facePreviewPair(character,template,left,right){return Boolean(combinedFacePreviewRef(character,template,left)&&combinedFacePreviewRef(character,template,right))}
function facePreviewDrawOrder(character,template){
  return [
    ...(facePreviewPair(character,template,'leftBrow','rightBrow')?['leftBrow','rightBrow']:['brows']),
    ...(facePreviewPair(character,template,'leftEye','rightEye')?['leftEye','rightEye']:['eyes']),
    ...(facePreviewPair(character,template,'leftEyelid','rightEyelid')?['leftEyelid','rightEyelid']:['eyelids']),
    ...(facePreviewPair(character,template,'leftPupil','rightPupil')?['leftPupil','rightPupil']:['pupils']),
    'mouth'
  ];
}

export class FaceFitController {
  constructor({resolveAsset,defaultFaceFit,projectFaceFeature,unprojectFaceFeatureX,onPreviewChange,scheduleSave}){
    this.resolveAsset=resolveAsset;
    this.defaultFaceFit=defaultFaceFit;
    this.projectFaceFeature=projectFaceFeature;
    this.unprojectFaceFeatureX=unprojectFaceFeatureX;
    this.onPreviewChange=onPreviewChange;
    this.scheduleSave=scheduleSave;
    this.imageCache=new Map();
    this.mountToken=0;
  }

  clearImageCache(){
    for(const value of this.imageCache.values())Promise.resolve(value).then(img=>{const url=img?.dataset?.objectUrl;if(url)URL.revokeObjectURL(url)}).catch(()=>{});
    this.imageCache.clear();
  }

  async loadImage(ref){
    if(!ref)return null;
    if(this.imageCache.has(ref))return this.imageCache.get(ref);
    const promise=(async()=>{
      const source=await this.resolveAsset(ref);if(!source)return null;
      let url='';if(source instanceof Blob)url=URL.createObjectURL(source);else if(typeof source==='string')url=source;else return null;
      return await new Promise(resolve=>{const img=new Image();if(source instanceof Blob)img.dataset.objectUrl=url;img.onload=()=>resolve(img);img.onerror=()=>resolve(null);img.src=url});
    })();
    this.imageCache.set(ref,promise);return promise;
  }

  placement(featureName,featureFit,orientation,perspective,baseRect,baseImage,featureImage){
    const projected=this.projectFaceFeature(featureName,featureFit,orientation,perspective);
    const baseScaleX=baseRect.dw/Math.max(1,baseImage?.naturalWidth||baseRect.dw||1),baseScaleY=baseRect.dh/Math.max(1,baseImage?.naturalHeight||baseRect.dh||1);
    const dw=Math.max(8,(featureImage?.naturalWidth||40)*baseScaleX*Math.max(0.15,featureFit.scaleX)*projected.scaleX),dh=Math.max(8,(featureImage?.naturalHeight||16)*baseScaleY*Math.max(0.15,featureFit.scaleY)*projected.scaleY);
    const cx=baseRect.x+projected.centerX*baseRect.dw,cy=baseRect.y+projected.centerY*baseRect.dh;
    return {x:cx-dw/2,y:cy-dh/2,dw,dh,cx,cy};
  }

  syncInputs(card,character,feature){
    const fit=character.faceFit.features[feature];
    for(const key of ['x','y','scaleX','scaleY','offsetX','offsetY','rotation']){
      const input=card.querySelector(`[data-face-feature="${feature}"][data-face-key="${key}"]`);if(input)input.value=Number(fit[key]).toFixed(2);
    }
  }

  mount(card,character,template){
    const token=++this.mountToken;
    const canvas=card.querySelector('[data-facefit-canvas]');if(!canvas)return;
    const ctx=canvas.getContext('2d'),featureSelect=card.querySelector('[data-facefit-selected-feature]'),status=card.querySelector('[data-facefit-status]'),previewNote=card.querySelector('[data-facefit-note]');
    let selected=featureSelect?.value||'eyes',dragging=false,baseRect={x:34,y:30,dw:252,dh:320},currentBaseImage=null,handles=[];
    const active=()=>token===this.mountToken&&card.isConnected;
    const refreshLinkedViews=()=>this.onPreviewChange?.();
    const setSelected=feature=>{selected=feature;if(featureSelect)featureSelect.value=feature;void draw()};
    const drawPlaceholder=base=>{ctx.fillStyle='#161b28';ctx.fillRect(base.x,base.y,base.dw,base.dh);ctx.strokeStyle='#2e3850';ctx.lineWidth=2;ctx.strokeRect(base.x,base.y,base.dw,base.dh);ctx.fillStyle='#cdd6f4';ctx.font='600 14px system-ui';ctx.textAlign='center';ctx.fillText(character.name||'角色',base.x+base.dw/2,base.y+26);const mouth=character.faceFit.features.mouth,eyes=character.faceFit.features.eyes,leftEyeX=base.x+base.dw*(eyes.x-0.12+eyes.offsetX),rightEyeX=base.x+base.dw*(eyes.x+0.12+eyes.offsetX),eyeY=base.y+base.dh*(eyes.y+eyes.offsetY);ctx.fillStyle='#0e131c';ctx.fillRect(leftEyeX-14,eyeY-5,28,10);ctx.fillRect(rightEyeX-14,eyeY-5,28,10);const mouthY=base.y+base.dh*(mouth.y+mouth.offsetY),mouthX=base.x+base.dw*(mouth.x+mouth.offsetX);ctx.fillRect(mouthX-22,mouthY-6,44,12)};
    const draw=async()=>{
      if(!active())return;
      const activeOrder=facePreviewDrawOrder(character,template);if(!activeOrder.includes(selected)){selected=activeOrder[0]||'mouth';if(featureSelect)featureSelect.value=selected}
      ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#0b1017';ctx.fillRect(0,0,canvas.width,canvas.height);
      const baseRef=character.layers?.base||character.images?.idle||null,baseImage=await this.loadImage(baseRef);if(!active())return;currentBaseImage=baseImage;
      if(baseImage){const scale=Math.min((canvas.width-28)/baseImage.naturalWidth,(canvas.height-28)/baseImage.naturalHeight),dw=baseImage.naturalWidth*scale,dh=baseImage.naturalHeight*scale;baseRect={x:(canvas.width-dw)/2,y:(canvas.height-dh)/2,dw,dh};ctx.drawImage(baseImage,baseRect.x,baseRect.y,baseRect.dw,baseRect.dh)}else{baseRect={x:34,y:30,dw:252,dh:320};drawPlaceholder(baseRect)}
      handles=[];const basis=currentBaseImage||{naturalWidth:baseRect.dw,naturalHeight:baseRect.dh};
      for(const feature of facePreviewDrawOrder(character,template)){const fit=character.faceFit.features[feature],image=await this.loadImage(combinedFacePreviewRef(character,template,feature));if(!active())return;const box=this.placement(feature,fit,character.faceFit.orientation,character.faceFit.perspective,baseRect,basis,image);handles.push({feature,...box});if(image){ctx.save();ctx.translate(box.cx,box.cy);ctx.rotate(fit.rotation||0);ctx.drawImage(image,-box.dw/2,-box.dh/2,box.dw,box.dh);ctx.restore()}ctx.strokeStyle=feature===selected?'#ffffff':FACE_PREVIEW_COLORS[feature];ctx.fillStyle=FACE_PREVIEW_COLORS[feature];ctx.lineWidth=feature===selected?2.5:1.5;ctx.beginPath();ctx.arc(box.cx,box.cy,feature===selected?7:5,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.font='12px system-ui';ctx.textAlign='left';ctx.fillStyle=feature===selected?'#ffffff':FACE_PREVIEW_COLORS[feature];ctx.fillText(FACE_FEATURE_LABELS[feature],box.cx+9,box.cy-7)}
      ctx.strokeStyle='#2e3850';ctx.setLineDash([5,4]);ctx.strokeRect(baseRect.x,baseRect.y,baseRect.dw,baseRect.dh);ctx.setLineDash([]);
      if(status){const fit=character.faceFit.features[selected];status.textContent=`${FACE_FEATURE_LABELS[selected]} · x ${fit.x.toFixed(2)} · y ${fit.y.toFixed(2)} · sx ${fit.scaleX.toFixed(2)} · sy ${fit.scaleY.toFixed(2)}`}
      if(previewNote)previewNote.textContent=baseImage?'拖彩色点移动五官；滚轮缩放。位置看着对就可以停。':'当前没有角色底图，仍可正常用占位形象；这一步可以先跳过。';
    };
    const pickFeature=(x,y)=>{let best=null;for(const handle of handles){const d=Math.hypot(handle.cx-x,handle.cy-y);if(d<18&&(!best||d<best.dist))best={feature:handle.feature,dist:d}}return best?.feature||null};
    const updateFeatureCenter=(feature,clientX,clientY)=>{const rect=canvas.getBoundingClientRect(),px=(clientX-rect.left)*(canvas.width/rect.width),py=(clientY-rect.top)*(canvas.height/rect.height),fit=character.faceFit.features[feature],projectedX=(px-baseRect.x)/baseRect.dw;fit.x=Math.max(-0.5,Math.min(1.5,this.unprojectFaceFeatureX(feature,projectedX,fit,character.faceFit.orientation,character.faceFit.perspective)));fit.y=Math.max(-0.5,Math.min(1.5,(py-baseRect.y)/baseRect.dh-fit.offsetY));this.syncInputs(card,character,feature);refreshLinkedViews();void draw()};
    canvas.onpointerdown=e=>{const rect=canvas.getBoundingClientRect(),x=(e.clientX-rect.left)*(canvas.width/rect.width),y=(e.clientY-rect.top)*(canvas.height/rect.height),hit=pickFeature(x,y);if(!hit)return;setSelected(hit);dragging=true;canvas.setPointerCapture?.(e.pointerId);updateFeatureCenter(hit,e.clientX,e.clientY)};
    canvas.onpointermove=e=>{if(dragging)updateFeatureCenter(selected,e.clientX,e.clientY)};
    const endDrag=()=>{if(!dragging)return;dragging=false;this.scheduleSave?.('拖拽脸部位置',`face-fit:${character.id}:${selected}:drag`)};canvas.onpointerup=endDrag;canvas.onpointercancel=endDrag;canvas.onlostpointercapture=endDrag;
    canvas.onwheel=e=>{e.preventDefault();const fit=character.faceFit.features[selected],delta=e.deltaY<0?0.05:-0.05;if(e.shiftKey)fit.scaleY=Math.max(0.15,Math.min(4,fit.scaleY+delta));else{fit.scaleX=Math.max(0.15,Math.min(4,fit.scaleX+delta));fit.scaleY=Math.max(0.15,Math.min(4,fit.scaleY+delta))}this.syncInputs(card,character,selected);this.scheduleSave?.('缩放脸部部件',`face-fit:${character.id}:${selected}:scale`);refreshLinkedViews();void draw()};
    if(featureSelect)featureSelect.onchange=e=>setSelected(e.target.value);
    const resetCurrent=card.querySelector('[data-facefit-reset-current]');if(resetCurrent)resetCurrent.onclick=()=>{character.faceFit.features[selected]={...this.defaultFaceFit().features[selected]};this.syncInputs(card,character,selected);this.scheduleSave?.('重置脸部位置',`face-fit:${character.id}:${selected}:reset`);refreshLinkedViews();void draw()};
    const resetAll=card.querySelector('[data-facefit-reset-all]');if(resetAll)resetAll.onclick=()=>{character.faceFit=this.defaultFaceFit();character.faceFit.templateId=template?.id||null;for(const feature of [...FACE_BASIC_FEATURES,...FACE_SPLIT_FEATURES])this.syncInputs(card,character,feature);const orient=card.querySelector('[data-face-orientation]');if(orient)orient.value=character.faceFit.orientation;const slider=card.querySelector('[data-face-perspective]');if(slider)slider.value=Number(character.faceFit.perspective).toFixed(2);const out=card.querySelector('[data-face-perspective-value]');if(out)out.textContent=Number(character.faceFit.perspective).toFixed(2);this.scheduleSave?.('重置全部脸部位置',`face-fit:${character.id}:reset-all`);refreshLinkedViews();void draw()};
    const orientation=card.querySelector('[data-face-orientation]');if(orientation)orientation.onchange=e=>{character.faceFit.orientation=e.target.value;this.scheduleSave?.('修改脸部朝向',`face-fit:${character.id}`);refreshLinkedViews();void draw()};
    const perspective=card.querySelector('[data-face-perspective]');if(perspective)perspective.oninput=e=>{character.faceFit.perspective=Number(e.target.value);const out=card.querySelector('[data-face-perspective-value]');if(out)out.textContent=Number(e.target.value).toFixed(2);this.scheduleSave?.('修改脸部透视',`face-fit:${character.id}`);refreshLinkedViews();void draw()};
    for(const input of card.querySelectorAll('[data-face-feature][data-face-key]'))input.oninput=()=>{const feature=input.dataset.faceFeature,key=input.dataset.faceKey;if(!feature||!key)return;character.faceFit.features[feature][key]=Number(input.value);this.scheduleSave?.('微调脸部位置',`face-fit:${character.id}:${feature}:${key}`);refreshLinkedViews();void draw()};
    void draw();
  }
}
