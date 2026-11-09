import path from 'node:path';
import {relativeParts} from './files.mjs';
export const APP_ORIGIN='replaylab://app';
export function appResource(url,root){
  const parsed=new URL(url);
  if(parsed.protocol!=='replaylab:'||parsed.hostname!=='app')throw Error('Invalid app origin');
  const parts=relativeParts(decodeURIComponent(parsed.pathname).replace(/^\//,''));
  if(!['web','dist','docs','desktop'].includes(parts[0]))throw Error('Resource not exposed');
  if(parts[0]==='desktop'&&parts[1]!=='assets')throw Error('Resource not exposed');
  return path.join(root,...parts);
}
export function localRequest(url,method='GET'){
  const u=new URL(url);
  if(u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.hash)throw Error('此接口只连接本机声音和翻译服务');
  if(!['GET','POST'].includes(method))throw Error('不支持该请求方法');
  if(!/^\/(health|profiles|generate|history|audio|synthesize|translate|llm)(\/|$)/.test(u.pathname))throw Error('不是支持的声音/翻译接口');
  return u.href;
}
export function safeExternal(url){const u=new URL(url);return u.protocol==='https:'||(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname));}
