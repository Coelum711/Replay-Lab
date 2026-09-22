import {processPitchCurve,encodePcmWav} from './prosody-dsp.js';
self.onmessage=({data})=>{
  try{const channels=processPitchCurve(data.channels,data.sampleRate,data.curve);const wav=encodePcmWav(channels,data.sampleRate);self.postMessage({wav},[wav]);}
  catch(error){self.postMessage({error:error.message||String(error)});}
};
