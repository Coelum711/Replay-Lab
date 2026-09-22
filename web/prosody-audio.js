import {prosodyIsFlat} from '../dist/speech/prosody.js';

export async function decodeRecording(blob){
  if(blob.size>50*1024*1024)throw new Error('单句录音文件请控制在 50 MB 以内。');
  const AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!AudioContext)throw new Error('当前环境没有音频解码能力。');
  const context=new AudioContext();
  try{const audio=await context.decodeAudioData(await blob.arrayBuffer());
    if(audio.duration>120||audio.numberOfChannels>2)throw new Error('请使用两分钟以内的单声道或双声道录音。');
    return {channels:Array.from({length:audio.numberOfChannels},(_,i)=>audio.getChannelData(i).slice()),sampleRate:audio.sampleRate,duration:audio.duration};
  }finally{await context.close();}
}
export async function fineTuneRecording(blob,decoded,curve,{signal}={}){
  signal?.throwIfAborted();
  if(prosodyIsFlat(curve))return blob; // Even the original encoded bytes stay untouched.
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./prosody-worker.js',import.meta.url),{type:'module'});
    const end=()=>{worker.terminate();signal?.removeEventListener('abort',abort);clearTimeout(timer);};
    const abort=()=>{end();reject(new DOMException('已取消微调','AbortError'));};
    const timer=setTimeout(()=>{end();reject(new Error('微调超时，请缩短单句录音。'));},120000);
    signal?.addEventListener('abort',abort,{once:true});
    worker.onerror=()=>{end();reject(new Error('本地音频处理未能启动，请重新打开应用。'));};
    worker.onmessage=({data})=>{end();if(data.error)reject(new Error(data.error));else resolve(new Blob([data.wav],{type:'audio/wav'}));};
    worker.postMessage({channels:decoded.channels,sampleRate:decoded.sampleRate,curve});
  });
}
