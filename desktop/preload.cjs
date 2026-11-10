const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('replayDesktop',{
  platform:process.platform,
  workspace:request=>ipcRenderer.invoke('replay:workspace',request),
  recent:()=>ipcRenderer.invoke('replay:recent'),
  saveDialog:request=>ipcRenderer.invoke('replay:save-dialog',request),
  stream:request=>ipcRenderer.invoke('replay:stream',request),
  localFetch:request=>ipcRenderer.invoke('replay:local-fetch',request),
  cancelFetch:id=>ipcRenderer.send('replay:cancel-fetch',id),
  confirm:message=>ipcRenderer.sendSync('replay:confirm',String(message).slice(0,3000)),
  onCommand:callback=>{const handler=(_event,command)=>callback(command);ipcRenderer.on('replay:command',handler);return ()=>ipcRenderer.removeListener('replay:command',handler);}
});
