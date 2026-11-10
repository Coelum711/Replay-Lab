import SoundTouch from './vendor/soundtouch/SoundTouch.js';
import {normalizeProsodyCurve,prosodyIsFlat,prosodyOffsetAt} from '../dist/speech/prosody.js';

/** Offline, tempo-preserving pitch envelope. Input/output lengths are identical. */
export function processPitchCurve(channels,sampleRate,inputCurve) {
  if(!Array.isArray(channels)||channels.length<1||channels.length>2)throw new Error('微调支持单声道或双声道录音。');
  const length=channels[0].length;
  if(!length||!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>96000||length/sampleRate>120)throw new Error('请使用 8–96 kHz、两分钟以内的单句录音。');
  if(channels.some(c=>c.length!==length||!c.every(Number.isFinite)))throw new Error('音频数据无效。');
  const curve=normalizeProsodyCurve(inputCurve);
  if(prosodyIsFlat(curve))return channels.map(c=>c.slice());
  const st=new SoundTouch({sampleRate});
  st.setStretchParameters({sequenceMs:40,seekWindowMs:10,overlapMs:8,quickSeek:false});
  const block=Math.max(64,Math.round(sampleRate*0.01)),pad=Math.round(sampleRate*0.2),flush=Math.round(sampleRate*0.5);
  const target=length+pad,parts=[];let outputLength=0;
  for(let position=-pad;position<length+flush;position+=block){
    // The processor buffers analysis windows; use its consumed input timeline.
    const sourceTime=position-st.inputBuffer.frameCount+block/2;
    st.pitchSemitones=prosodyOffsetAt(curve,Math.max(0,Math.min(1,sourceTime/(length-1))));
    const frames=new Float32Array(block*2);
    for(let i=0;i<block;i++){
      const at=position+i;
      if(at>=0&&at<length){frames[2*i]=channels[0][at];frames[2*i+1]=(channels[1]||channels[0])[at];}
    }
    st.inputBuffer.putSamples(frames);st.process();
    const count=st.outputBuffer.frameCount;
    if(count){const out=new Float32Array(count*2);st.outputBuffer.extract(out,0,count,true);parts.push(out);outputLength+=count;}
    if(position>=length&&outputLength>=target)break;
  }
  if(outputLength<target)throw new Error('音频处理未完整返回尾部，请缩短录音后再试。');
  const joined=new Float32Array(outputLength*2);let cursor=0;
  for(const part of parts){joined.set(part,cursor);cursor+=part.length;}
  const result=channels.map(()=>new Float32Array(length));
  for(let i=0;i<length;i++){
    // Near the zero line crossfade back to the untouched original; no cumulative edits.
    const edge=Math.max(0,Math.min(1,(i-sampleRate*.004)/(sampleRate*.021),(length-1-i-sampleRate*.004)/(sampleRate*.021)));
    const wet=edge*Math.min(1,Math.abs(prosodyOffsetAt(curve,i/Math.max(1,length-1)))/0.15);
    for(let c=0;c<channels.length;c++)result[c][i]=channels[c][i]*(1-wet)+joined[(i+pad)*2+c]*wet;
  }
  st.clear();return result;
}

export function encodePcmWav(channels,sampleRate){
  const frames=channels[0].length,count=channels.length,buffer=new ArrayBuffer(44+frames*count*2),view=new DataView(buffer);
  const text=(at,value)=>{for(let i=0;i<value.length;i++)view.setUint8(at+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,buffer.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,count,true);view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate*count*2,true);view.setUint16(32,count*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,frames*count*2,true);
  for(let i=0;i<frames;i++)for(let c=0;c<count;c++){const x=Math.max(-1,Math.min(1,channels[c][i]));view.setInt16(44+(i*count+c)*2,Math.round(x*(x<0?32768:32767)),true);}
  return buffer;
}
