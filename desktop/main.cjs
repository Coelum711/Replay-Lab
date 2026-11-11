const {app,BrowserWindow,protocol,ipcMain,dialog,Menu,shell,session}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
protocol.registerSchemesAsPrivileged([{scheme:'replaylab',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
app.setName('Replay Lab');
if(!app.requestSingleInstanceLock()){app.quit();}else{void start().catch(error=>{dialog.showErrorBox('Replay Lab 启动失败',error.message);app.quit();});}

async function start(){
  const {WorkspaceFiles}=await import('./files.mjs');
  const {APP_ORIGIN,appResource,localRequest,safeExternal}=await import('./policy.mjs');
  const {WORKSPACE_DIRECTORIES}=await import('../dist/workspace/layout.js');
  const files=new WorkspaceFiles(),windows=new Set(),requests=new Map(),streamOwners=new Map();
  let mainWindow,preferences={recent:[]};
  await app.whenReady();
  const preferencesFile=path.join(app.getPath('userData'),'desktop.json');
  try{preferences={...preferences,...JSON.parse(await fs.readFile(preferencesFile,'utf8'))};}catch{}
  if(!Array.isArray(preferences.recent))preferences.recent=[];
  let preferenceQueue=Promise.resolve();
  const savePreferences=()=>{const text=JSON.stringify(preferences,null,2);return preferenceQueue=preferenceQueue.catch(()=>{}).then(async()=>{await fs.mkdir(path.dirname(preferencesFile),{recursive:true});const tmp=preferencesFile+'.tmp';await fs.writeFile(tmp,text);await fs.rename(tmp,preferencesFile);});};
  function trusted(event){
    if(!windows.has(BrowserWindow.fromWebContents(event.sender))||event.senderFrame!==event.sender.mainFrame||!event.senderFrame.url.startsWith(APP_ORIGIN+'/web/'))throw Error('未授权的窗口');
  }
  function handle(channel,handler){ipcMain.handle(channel,async(event,args)=>{try{trusted(event);return {ok:true,value:await handler(event,args||{})};}catch(error){return {ok:false,error:{message:error.message,name:error.name,code:error.code}};}});}
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.md':'text/plain','.wasm':'application/wasm'};
  // Project plugins: the renderer may only load files the user approved, pinned to their content hash.
  const approvedPlugins=new Map();
  const sha256=data=>createHash('sha256').update(data).digest('hex');
  protocol.handle('replaylab',async request=>{
    try{
      const pluginMatch=new URL(request.url).pathname.match(/^\/__plugins\/([0-9a-f-]{36})\/[^/]+\.js$/);
      if(pluginMatch){
        const approved=approvedPlugins.get(pluginMatch[1]);if(!approved)return new Response('插件未授权',{status:403});
        const data=await files.read(approved.id,approved.relative);
        if(sha256(data)!==approved.sha)return new Response('插件文件在授权后被修改，请重新确认',{status:409});
        return new Response(data,{headers:{'Content-Type':'text/javascript','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'}});
      }
      const target=appResource(request.url,app.getAppPath());
      const data=await fs.readFile(target),headers={'Content-Type':mime[path.extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff'};
      if(target.endsWith('.html')){
        const hashes=[...data.toString().matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>!m[1].includes('src=')).map(m=>"'sha256-"+createHash('sha256').update(m[2]).digest('base64')+"'");
        headers['Content-Security-Policy']=`default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: data: https:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-src 'none'`;
      }
      return new Response(data,{headers});
    }catch{return new Response('资源不存在',{status:404});}
  });
  session.defaultSession.setPermissionRequestHandler((_contents,permission,callback)=>callback(permission==='clipboard-sanitized-write'));
  session.defaultSession.setPermissionCheckHandler((_contents,permission)=>permission==='clipboard-sanitized-write');
  const webPreferences={preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true};
  function protect(win){
    windows.add(win);const ownerId=win.webContents.id;
    win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith(APP_ORIGIN+'/web/')){event.preventDefault();if(safeExternal(url))void shell.openExternal(url);}});
    win.webContents.setWindowOpenHandler(({url,frameName})=>{
      if(url===APP_ORIGIN+'/web/index.html')return {action:'allow',overrideBrowserWindowOptions:{width:1100,height:850,minWidth:760,minHeight:600,title:'Replay Lab · 声音',backgroundColor:'#17191f',titleBarStyle:process.platform==='darwin'?'hiddenInset':'default',webPreferences}};
      if(url===APP_ORIGIN+'/web/studio.html'){revealMain();return {action:'deny'};}
      try{if(safeExternal(url))void shell.openExternal(url);}catch{}
      return {action:'deny'};
    });
    win.webContents.on('did-create-window',child=>protect(child));
    win.webContents.on('will-prevent-unload',event=>{
      const choice=dialog.showMessageBoxSync(win,{type:'question',buttons:['返回编辑','关闭窗口'],defaultId:0,cancelId:0,message:'仍有未保存素材或运行中的声音任务',detail:'关闭此窗口会中断任务，尚未保存到工程目录的素材需要重新导入。'});
      if(choice===1)event.preventDefault();
    });
    win.on('closed',()=>{
      windows.delete(win);for(const [token,owner] of streamOwners)if(owner===ownerId){void files.abort(token);streamOwners.delete(token);}
      for(const [key,job] of requests)if(job.owner===ownerId){job.controller.abort();requests.delete(key);}
    });
  }
  function revealMain(){if(!mainWindow||mainWindow.isDestroyed())createMain();mainWindow.show();mainWindow.focus();}
  function createMain(){
    const bounds=preferences.window||{};
    mainWindow=new BrowserWindow({width:Math.max(1100,Math.min(1800,bounds.width||1460)),height:Math.max(740,Math.min(1200,bounds.height||960)),minWidth:1020,minHeight:720,show:false,title:'Replay Lab',backgroundColor:'#17191f',titleBarStyle:process.platform==='darwin'?'hiddenInset':'default',trafficLightPosition:{x:18,y:21},icon:path.join(__dirname,'assets/icon.png'),webPreferences});
    protect(mainWindow);
    const win=mainWindow;
    win.on('close',()=>{preferences.window=win.getNormalBounds();void savePreferences().catch(()=>{});});
    win.once('ready-to-show',()=>win.show());
    void win.loadURL(APP_ORIGIN+'/web/studio.html');
  }
  app.on('second-instance',revealMain);
  app.on('activate',revealMain);
  app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
  app.on('before-quit',()=>{void files.dispose();});
  handle('replay:recent',()=>preferences.recent.map(({id,label,updatedAt})=>({id,label,updatedAt})));
  handle('replay:workspace',async(event,request)=>{
    const {action,id,relative,data,expected}=request;
    switch(action){
      case 'choose':{
        let directory;
        if(request.recentId){directory=preferences.recent.find(r=>r.id===request.recentId)?.path;if(!directory)throw Error('最近工程记录不存在，请重新打开文件夹');}
        else{const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:'选择 Replay Lab 工程文件夹',buttonLabel:'打开工程',properties:['openDirectory','createDirectory']});if(result.canceled)return null;directory=result.filePaths[0];}
        const grant=await files.grant(directory);
        for(const dir of WORKSPACE_DIRECTORIES)await files.mkdir(grant.id,dir);
        const previous=preferences.recent.find(r=>r.path===grant.path);
        preferences.recent=[{id:previous?.id||randomUUID(),label:grant.label,path:grant.path,updatedAt:Date.now()},...preferences.recent.filter(r=>r.path!==grant.path)].slice(0,8);
        await savePreferences();return grant;
      }
      case 'read':return files.read(id,relative);
      case 'exists':return files.exists(id,relative);
      case 'list':return files.list(id,relative);
      case 'remove':return files.remove(id,relative);
      case 'write':return files.write(id,relative,data);
      case 'save':return files.save(id,data,expected);
      case 'check':return files.check(id,expected);
      case 'stream':{const token=await files.openWrite(id,relative);streamOwners.set(token,event.sender.id);return token;}
      default:throw Error('未知工程操作');
    }
  });
  handle('replay:save-dialog',async(event,request)=>{
    const name=path.basename(String(request.name||'replay-export'));
    const result=await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender),{title:'保存文件',defaultPath:name,buttonLabel:'保存'});
    if(result.canceled||!result.filePath)return null;
    const token=await files.openTarget(result.filePath);streamOwners.set(token,event.sender.id);return {token,name:path.basename(result.filePath)};
  });
  // Writes a handful of exported audio files into a folder the user picks (e.g. a game's audio/se).
  // Only plain audio files, never overwriting what is already there.
  handle('replay:export-to-folder',async(event,request)=>{
    const list=Array.isArray(request?.files)?request.files:[];
    if(!list.length||list.length>200)throw Error('一次导出 1 到 200 个文件');
    let total=0;for(const item of list){const size=item?.data?.byteLength??0;if(!size)throw Error('导出文件是空的');total+=size}
    if(total>300*1024*1024)throw Error('导出内容超过 300 MB，请分批导出');
    const result=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{title:String(request.title||'选择导出到的文件夹'),buttonLabel:'导出到这里',properties:['openDirectory','createDirectory']});
    if(result.canceled||!result.filePaths[0])return null;
    const directory=result.filePaths[0],written=[];
    for(const item of list){
      const raw=path.basename(String(item.name||'audio.ogg')).replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_');
      const ext=path.extname(raw).toLowerCase();if(!['.ogg','.wav'].includes(ext))throw Error(`只能导出 .ogg / .wav：${raw}`);
      const stem=raw.slice(0,-ext.length)||'audio';let name=stem+ext;
      for(let n=2;;n++){try{await fs.access(path.join(directory,name));name=`${stem}_${n}${ext}`}catch{break}}
      await fs.writeFile(path.join(directory,name),Buffer.from(item.data),{flag:'wx'});written.push(name);
    }
    return {directory,written};
  });
  handle('replay:plugins',async(event,request)=>{
    const id=String(request.id||'');
    if(request.action==='scan'){
      let names=[];try{names=(await files.list(id,'plugins')).map(item=>String(item.path||item)).filter(name=>/^plugins\/[^/]+\.js$/i.test(name.replace(/^\.?\//,'')))}catch{return []}
      const out=[];
      for(const relative of names.slice(0,32)){
        const data=await files.read(id,relative);if(data.byteLength>512*1024){out.push({name:path.basename(relative),size:data.byteLength,tooLarge:true});continue}
        const text=Buffer.from(data).toString('utf8');const header=(text.match(/^\s*\/\*\*?([\s\S]*?)\*\//)?.[1]||text.match(/^\s*((?:\/\/.*\n?){1,6})/)?.[1]||'').replace(/^\s*[*/]+ ?/gm,'').trim().slice(0,400);
        out.push({name:path.basename(relative),size:data.byteLength,sha:sha256(data),header});
      }
      return out;
    }
    if(request.action==='load'){
      const out=[];
      for(const item of (Array.isArray(request.files)?request.files:[]).slice(0,32)){
        const name=path.basename(String(item.name||''));if(!/\.js$/i.test(name))continue;
        const relative=`plugins/${name}`,data=await files.read(id,relative);
        if(sha256(data)!==item.sha){out.push({name,error:'文件在确认之后被修改了，请重新确认'});continue}
        const token=randomUUID();approvedPlugins.set(token,{id,relative,sha:item.sha});
        out.push({name,url:`${APP_ORIGIN}/__plugins/${token}/${encodeURIComponent(name.replace(/[^\w.-]/g,'_'))}`});
      }
      return out;
    }
    throw Error('未知插件操作');
  });
  handle('replay:stream',async(event,request)=>{
    if(streamOwners.get(request.token)!==event.sender.id)throw Error('保存流不属于当前窗口');
    if(request.action==='write')return files.chunk(request.token,request.data);
    if(request.action==='close'){await files.close(request.token);streamOwners.delete(request.token);return;}
    if(request.action==='abort'){await files.abort(request.token);streamOwners.delete(request.token);return;}
    throw Error('未知保存操作');
  });
  handle('replay:local-fetch',async(event,request)=>{
    const method=request.method||'GET',url=localRequest(request.url,method),controller=new AbortController();
    const key=event.sender.id+':'+request.id;requests.set(key,{owner:event.sender.id,controller});
    const timeout=setTimeout(()=>controller.abort(),20*60_000);timeout.unref();
    try{
      const headers={};for(const [name,value] of Object.entries(request.headers||{}))if(['content-type','x-replaylab-bridge'].includes(name.toLowerCase()))headers[name]=String(value);
      let body=method==='POST'?String(request.body||''):undefined;
      if(method==='POST'&&request.multipart){body=new FormData();for(const part of request.multipart){if(part.bytes)body.append(part.name,new Blob([part.bytes],{type:part.type||'application/octet-stream'}),part.filename||'upload.bin');else body.append(part.name,String(part.value));}}
      const response=await fetch(url,{method,headers,body,signal:controller.signal,redirect:'error'});
      return {status:response.status,headers:[...response.headers],data:new Uint8Array(await response.arrayBuffer())};
    }finally{clearTimeout(timeout);requests.delete(key);}
  });
  ipcMain.on('replay:cancel-fetch',(event,id)=>{try{trusted(event);requests.get(event.sender.id+':'+id)?.controller.abort();}catch{}});
  ipcMain.on('replay:confirm',(event,message)=>{try{trusted(event);event.returnValue=dialog.showMessageBoxSync(BrowserWindow.fromWebContents(event.sender),{type:'question',buttons:['取消','继续'],defaultId:0,cancelId:0,message:'Replay Lab',detail:String(message)})===1;}catch{event.returnValue=false;}});
  const command=name=>()=>BrowserWindow.getFocusedWindow()?.webContents.send('replay:command',name);
  const menu=[...(process.platform==='darwin'?[{label:'Replay Lab',submenu:[{role:'about'},{type:'separator'},{label:'设置…',accelerator:'CmdOrCtrl+,',click:command('settings')},{type:'separator'},{role:'hide'},{role:'hideOthers'},{role:'unhide'},{type:'separator'},{role:'quit'}]}]:[]),
    {label:'文件',submenu:[{label:'首页',accelerator:'CmdOrCtrl+1',click:command('home')},{label:'新建工程',accelerator:'CmdOrCtrl+N',click:command('new')},{label:'打开工程…',accelerator:'CmdOrCtrl+O',click:command('open')},{label:'保存工程',accelerator:'CmdOrCtrl+S',click:command('save')},{type:'separator'},{role:'close'}]},
    {label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'视图',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{type:'separator'},{role:'togglefullscreen'},{type:'separator'},{label:'启动诊断',role:'toggleDevTools',accelerator:'CmdOrCtrl+Alt+I'}]},
    {label:'窗口',submenu:[{role:'minimize'},{role:'zoom'},{role:'front'}]}];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));createMain();
}
