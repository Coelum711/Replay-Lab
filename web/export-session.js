import {CanvasStageRenderer,BrowserReplayPlayer} from '../dist/index.js';

/** Freeze authoring state and local asset references for the lifetime of one export. */
export function createExportSession({project,performance,workspace,files,width,height,
  createCanvas=()=>document.createElement('canvas'),createRenderer=options=>new CanvasStageRenderer(options),
  createPlayer=(...args)=>new BrowserReplayPlayer(...args)}){
  const snapshot=structuredClone(performance),assets=structuredClone(project.assets),runtime=new Map(files);
  const resolveAsset=async ref=>{
    if(!ref)return null;
    if(/^(data:|blob:|https?:)/i.test(ref))return ref;
    const asset=assets.find(a=>a.id===ref||a.name===ref||a.sourcePath===ref||a.sourcePath?.endsWith('/'+ref));
    if(!asset)return null;
    if(runtime.has(asset.id))return runtime.get(asset.id);
    if(workspace&&asset.sourcePath){try{return await workspace.read(asset.sourcePath);}catch{}}
    return asset.uri&&!asset.uri.startsWith('project://')?asset.uri:null;
  };
  const canvas=createCanvas();canvas.width=width;canvas.height=height;
  const renderer=createRenderer({canvas,performance:snapshot,resolveAsset});
  return {player:createPlayer(snapshot,renderer,resolveAsset),renderer,resolveAsset,performance:snapshot,workspace,title:project.title};
}
