import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {workspaceManifestFingerprint} from '../dist/workspace/conflict.js';

const manifest='project.replaylab.json';
export function relativeParts(value=''){
  if(typeof value!=='string'||value.includes('\0')||path.isAbsolute(value)||/^[a-z]:/i.test(value)||value.includes('\\'))throw Error('无效的工程相对路径');
  const parts=value.split('/').filter(Boolean);
  if(parts.some(p=>p==='.'||p==='..'))throw Error('路径不能离开工程目录');
  return parts;
}
const inside=(root,candidate)=>candidate===root||candidate.startsWith(root+path.sep);
export class WorkspaceFiles {
  roots=new Map();streams=new Map();queues=new Map();
  async grant(directory){
    const root=await fs.realpath(directory);
    if(!(await fs.stat(root)).isDirectory())throw Error('请选择工程文件夹');
    const id=randomUUID();this.roots.set(id,root);return {id,label:path.basename(root),path:root};
  }
  root(id){const root=this.roots.get(id);if(!root)throw Error('工程目录尚未授权，请重新打开');return root;}
  async resolve(id,relative,{createParents=false}={}){
    const root=this.root(id),parts=relativeParts(relative);let current=root;
    for(let i=0;i<parts.length;i++){
      current=path.join(current,parts[i]);
      try{
        const actual=await fs.realpath(current);
        if(!inside(root,actual))throw Error('链接指向工程目录外，已停止操作');
        current=actual;
      }catch(error){
        if(error.code!=='ENOENT')throw error;
        if(i<parts.length-1){
          if(!createParents)throw error;
          try{await fs.mkdir(current);}catch(createError){if(createError.code!=='EEXIST')throw createError;}
          // Another write can create this directory concurrently. Revalidate before use.
          const actual=await fs.realpath(current);
          if(!inside(root,actual))throw Error('链接指向工程目录外，已停止操作');
          if(!(await fs.stat(actual)).isDirectory())throw Error('工程路径不是文件夹');
          current=actual;
        }
      }
    }
    return current;
  }
  async read(id,relative){return new Uint8Array(await fs.readFile(await this.resolve(id,relative)));}
  async exists(id,relative){try{await fs.stat(await this.resolve(id,relative));return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
  async mkdir(id,relative){await fs.mkdir(await this.resolve(id,relative,{createParents:true}),{recursive:true});}
  async remove(id,relative){if(!relativeParts(relative).length)throw Error('不能删除工程根目录');await fs.rm(await this.resolve(id,relative),{recursive:true,force:true});}
  async list(id,relative=''){
    const start=await this.resolve(id,relative),out=[];
    const walk=async(dir,prefix)=>{
      for(const entry of await fs.readdir(dir,{withFileTypes:true})){
        if(entry.isSymbolicLink()||entry.name.startsWith('.replaylab-write-'))continue;
        const child=prefix?prefix+'/'+entry.name:entry.name,full=path.join(dir,entry.name);
        if(entry.isDirectory())await walk(full,child);
        else if(entry.isFile()){const stat=await fs.stat(full);out.push({path:child,size:stat.size,modifiedAt:stat.mtimeMs});}
      }
    };await walk(start,relativeParts(relative).join('/'));return out.sort((a,b)=>a.path.localeCompare(b.path));
  }
  async openWrite(id,relative){
    if(!relativeParts(relative).length)throw Error('文件名不能为空');
    const target=await this.resolve(id,relative,{createParents:true});
    return this.openTarget(target,{id,relative});
  }
  async openTarget(target,guard){
    const temp=path.join(path.dirname(target),'.replaylab-write-'+randomUUID());
    const handle=await fs.open(temp,'wx');const token=randomUUID();
    this.streams.set(token,{target,temp,handle,position:0,guard});return token;
  }
  async chunk(token,input){
    const stream=this.streams.get(token);if(!stream)throw Error('保存流已关闭');
    if(input?.type==='seek'){
      if(!Number.isSafeInteger(input.position)||input.position<0)throw Error('无效写入位置');stream.position=input.position;return;
    }
    if(input?.type==='truncate'){
      if(!Number.isSafeInteger(input.size)||input.size<0)throw Error('无效文件尺寸');await stream.handle.truncate(input.size);stream.position=Math.min(stream.position,input.size);return;
    }
    let position=stream.position,data=input;
    if(input?.type==='write'){data=input.data;position=input.position??position;}
    if(!Number.isSafeInteger(position)||position<0)throw Error('无效写入位置');
    const bytes=typeof data==='string'?Buffer.from(data):Buffer.from(data);
    let written=0;while(written<bytes.length){const result=await stream.handle.write(bytes,written,bytes.length-written,position+written);written+=result.bytesWritten;}
    stream.position=position+written;
  }
  async close(token){
    const stream=this.streams.get(token);if(!stream)throw Error('保存流已关闭');
    try{
      await stream.handle.sync();await stream.handle.close();
      if(stream.guard){const actual=await this.resolve(stream.guard.id,stream.guard.relative);if(actual!==stream.target)throw Error('保存目标在写入期间发生改变');}
      await fs.rename(stream.temp,stream.target);this.streams.delete(token);
    }catch(error){await this.abort(token);throw error;}
  }
  async abort(token){const stream=this.streams.get(token);if(!stream)return;this.streams.delete(token);try{await stream.handle.close();}catch{}await fs.rm(stream.temp,{force:true}).catch(()=>{});}
  async write(id,relative,data){const token=await this.openWrite(id,relative);try{await this.chunk(token,data);await this.close(token);}catch(error){await this.abort(token);throw error;}}
  async current(id){return await this.exists(id,manifest)?workspaceManifestFingerprint(new TextDecoder().decode(await this.read(id,manifest))):null;}
  async check(id,expected){
    const current=await this.current(id);
    if((expected===undefined&&current!==null)||(expected!==undefined&&expected!==current)){
      const error=Error('工程文件已被其他窗口或程序修改，请先重新载入。');error.name='WorkspaceConflictError';error.code='workspace-project-conflict';throw error;
    }
  }
  async save(id,text,expected){
    const root=this.root(id),previous=this.queues.get(root)||Promise.resolve();
    const pending=previous.catch(()=>{}).then(async()=>{await this.check(id,expected);await this.write(id,manifest,text);return workspaceManifestFingerprint(text);});
    this.queues.set(root,pending);return pending;
  }
  async dispose(){await Promise.all([...this.streams.keys()].map(token=>this.abort(token)));}
}
