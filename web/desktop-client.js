import {desktopResult,desktopWritable} from '../dist/index.js';
export const isDesktop=!!window.replayDesktop;
export async function desktopCall(method,arg){return desktopResult(window.replayDesktop[method](arg));}
export async function serviceFetch(url,options={}){
  const parsed=new URL(url,location.href);
  if(!isDesktop && parsed.protocol==='http:' && ['localhost','127.0.0.1'].includes(parsed.hostname) && parsed.port==='17493' && !parsed.username && !parsed.password && ['localhost','127.0.0.1'].includes(location.hostname)){
    return fetch(`/__voicebox${parsed.pathname}${parsed.search}`,options);
  }
  if(!isDesktop||parsed.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))return fetch(url,options);
  options.signal?.throwIfAborted();
  const id=crypto.randomUUID(),api=window.replayDesktop;
  const cancel=()=>api.cancelFetch(id);options.signal?.addEventListener('abort',cancel,{once:true});
  try{
    const multipart=options.body instanceof FormData?await Promise.all([...options.body.entries()].map(async([name,value])=>typeof value==='string'?{name,value}:{name,filename:value.name,type:value.type,bytes:new Uint8Array(await value.arrayBuffer())})):undefined;
    const result=await desktopCall('localFetch',{id,url:parsed.href,method:options.method||'GET',headers:Object.fromEntries(new Headers(options.headers)),...(multipart?{multipart}:{body:options.body})});
    options.signal?.throwIfAborted();return new Response(result.data,{status:result.status,headers:result.headers});
  }finally{options.signal?.removeEventListener('abort',cancel);}
}
if(isDesktop){
  document.documentElement.dataset.desktop=window.replayDesktop.platform;
  window.confirm=message=>window.replayDesktop.confirm(message);
  window.showSaveFilePicker=async options=>{
    const result=await desktopCall('saveDialog',{name:options?.suggestedName});
    if(!result)throw new DOMException('已取消保存','AbortError');
    let used=false;
    return {name:result.name,async createWritable(){
      if(used)throw Error('此保存对话框已经使用');used=true;
      const stream=desktopWritable(result.token);
      // Browser FileSystemWritableFileStream has direct helpers in addition to the Streams API.
      const writer=()=>stream.getWriter();
      stream.write=async data=>{const w=writer();try{await w.write(data);}finally{w.releaseLock();}};
      stream.close=async()=>{const w=writer();try{await w.close();}finally{w.releaseLock();}};
      return stream;
    }};
  };
}
