import type {ReplayProject} from '../core/types.js';
import {normalizeReplayProject} from '../core/normalize.js';
import {workspaceManifestFingerprint} from './conflict.js';
import {serializeWorkspaceWrite} from './lock.js';
import type {ProjectWorkspace,WorkspaceData,WorkspaceFileInfo} from './types.js';
import {PROJECT_MANIFEST_PATH} from './layout.js';

interface DesktopBridge {workspace(request:Record<string,unknown>):Promise<any>;stream(request:Record<string,unknown>):Promise<any>;}
export function desktopBridge():DesktopBridge|undefined{return (globalThis as any).replayDesktop;}
export async function desktopResult(pending:Promise<any>):Promise<any>{
  const result=await pending;
  if(!result?.ok){const error=new Error(result?.error?.message||'桌面操作失败');Object.assign(error,result?.error);throw error;}
  return result.value;
}
async function bytes(data:WorkspaceData):Promise<string|ArrayBuffer|Uint8Array>{return data instanceof Blob?await data.arrayBuffer():data;}
export function desktopWritable(token:string):WritableStream{
  const api=desktopBridge()!;
  const write=async(data:any)=>{
    if(data?.type==='write')data={...data,data:await bytes(data.data)};
    else if(data?.type!=='seek'&&data?.type!=='truncate')data=await bytes(data);
    await desktopResult(api.stream({action:'write',token,data}));
  };
  return new WritableStream({write,close:()=>desktopResult(api.stream({action:'close',token})),abort:()=>desktopResult(api.stream({action:'abort',token}))});
}
export class DesktopProjectWorkspace implements ProjectWorkspace{
  readonly kind='filesystem' as const;
  private fingerprint:string|null|undefined;
  constructor(readonly id:string,readonly label:string){}
  static async choose(recentId?:string):Promise<DesktopProjectWorkspace>{
    const result=await desktopResult(desktopBridge()!.workspace({action:'choose',recentId}));
    if(!result)throw new DOMException('已取消打开','AbortError');
    return new DesktopProjectWorkspace(result.id,result.label);
  }
  private call(action:string,args:Record<string,unknown>={}){return desktopResult(desktopBridge()!.workspace({action,id:this.id,...args}));}
  async write(relative:string,data:WorkspaceData):Promise<void>{await this.call('write',{relative,data:await bytes(data)});}
  async read(relative:string):Promise<Blob>{
    const types:Record<string,string>={svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg',mp4:'video/mp4',webm:'video/webm',json:'application/json'};
    return new Blob([await this.call('read',{relative})],{type:types[relative.split('.').pop()?.toLowerCase()||'']||'application/octet-stream'});
  }
  exists(relative:string):Promise<boolean>{return this.call('exists',{relative});}
  remove(relative:string):Promise<void>{return this.call('remove',{relative});}
  list(relative=''):Promise<WorkspaceFileInfo[]>{return this.call('list',{relative});}
  async createWritable(relative:string):Promise<WritableStream>{return desktopWritable(await this.call('stream',{relative}));}
  async assertProjectCurrent():Promise<void>{await this.call('check',{expected:this.fingerprint});}
  async loadProject():Promise<ReplayProject|null>{
    if(!await this.exists(PROJECT_MANIFEST_PATH)){this.fingerprint=null;return null;}
    const text=await(await this.read(PROJECT_MANIFEST_PATH)).text();
    const project=normalizeReplayProject(JSON.parse(text));this.fingerprint=workspaceManifestFingerprint(text);return project;
  }
  async saveProject(project:ReplayProject):Promise<void>{
    const data=JSON.stringify(project,null,2);
    await serializeWorkspaceWrite(this,async()=>{this.fingerprint=await this.call('save',{data,expected:this.fingerprint});});
  }
}
