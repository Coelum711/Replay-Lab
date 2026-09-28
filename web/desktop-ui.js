import {desktopCall,isDesktop} from './desktop-client.js';
const $=id=>document.getElementById(id),studio=document.body.classList.contains('studio-shell');
const dialog=$('appSettingsDialog');let opening=false,connected=false;
function active(name){for(const item of ['Home','Editor','Voice'])$('app'+item).setAttribute('aria-current',item===name?'page':'false');}
function editor(){if(studio){$('studioHome').hidden=true;document.body.classList.remove('home-visible');active('Editor');}else $('returnStudio').click();}
function home(){if(studio){$('studioHome').hidden=false;document.body.classList.add('home-visible');active('Home');void recents();document.dispatchEvent(new CustomEvent('replaylab:desktop-command',{detail:'home'}));}else $('returnStudio').click();}
function voice(){if(studio)$('openVoiceWorkbench').click();else window.scrollTo({top:0,behavior:'smooth'});}
function settings(){dialog.showModal();}
function closeSettings(){dialog.close();}
function openProject(id){opening=true;if(studio)editor();if(id)document.dispatchEvent(new CustomEvent('replaylab:open-recent',{detail:id}));else $('chooseWorkspace').click();}
function save(){
  if(!studio){$('saveWorkspace').click();return;}
  editor();$('workspaceDetails').open=true;
  if(!connected)openProject();else if(!$('saveProject').disabled)$('saveProject').click();
}
function syncProjectUi(state={}){
  if(!studio)return;
  if('connected' in state)connected=state.connected;
  const source=$('projectState');$('appSaveState').textContent=source.textContent;$('appSaveState').className=source.className;
  $('appSaveState').title=connected?$('workspaceDetail').textContent:'尚未保存到工程文件夹。自动备份只包含台本和设置，不包含图片、音频。';
  $('appSave').textContent=connected?($('saveProject').disabled?'查看保存问题':'保存'):'选择保存位置';
  $('homeRecovery').hidden=$('recoveryBar').hidden;$('homeRecoveryText').textContent=$('recoveryText').textContent;
}
async function recents(){
  if(!studio||!isDesktop)return;
  try{
    const items=await desktopCall('recent'),host=$('recentProjects');host.replaceChildren();
    $('recentCount').textContent=items.length?`${items.length} 个工程`:'准备开始';
    if(!items.length){const empty=document.createElement('div');empty.className='recent-empty';empty.textContent='打开的工程会出现在这里。你也可以先新建一份台本，稍后再选择保存位置。';host.append(empty);return;}
    for(const item of items){const button=document.createElement('button');button.className='recent-project';const mark=document.createElement('img');mark.src='../desktop/assets/mark.svg';mark.alt='';const text=document.createElement('span'),title=document.createElement('b'),date=document.createElement('small');title.textContent=item.label;date.textContent='上次打开 · '+new Date(item.updatedAt).toLocaleDateString('zh-CN');text.append(title,date);button.append(mark,text);button.onclick=()=>openProject(item.id);host.append(button);}
  }catch(error){$('recentCount').textContent='暂时无法读取最近工程';}
}
$('appBrand').onclick=event=>{event.preventDefault();home();};
$('appHome').onclick=home;$('appEditor').onclick=editor;$('appVoice').onclick=voice;
$('appSettings').onclick=settings;$('closeAppSettings').onclick=closeSettings;
$('settingsVoice').onclick=()=>{closeSettings();voice();};
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeSettings();}});
const body=$('appSettingsBody');
if(studio){
  for(const id of ['projectSpeechLanguage','projectTtsProvider']){const input=$(id),label=input.closest('label'),old=input.closest('.voice-line-card');if(old)old.hidden=true;body.append(label);}
  $('homeNew').onclick=()=>{editor();$('newProject').click();};$('homeOpen').onclick=()=>openProject();$('homeResume').onclick=editor;
  $('homeScript').onclick=()=>{editor();$('importDetails').open=true;$('logInput').focus();};
  $('homeStage').onclick=()=>{editor();$('layoutMode').value='stage';$('layoutMode').dispatchEvent(new Event('change',{bubbles:true}));};
  $('homeVoice').onclick=voice;
  $('appSave').onclick=save;
  $('homeRestoreRecovery').onclick=()=>{editor();$('restoreRecovery').click();};
  $('homeViewRecovery').onclick=()=>{editor();$('recoveryBar').scrollIntoView({block:'center'});};
  window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();save();}});
  document.addEventListener('replaylab:project-state',event=>{
    const state=event.detail;$('homeResume').hidden=!state.hasContent;
    syncProjectUi(state);
    if(opening&&state.connected){opening=false;editor();}
    document.querySelector('.top h1').textContent=state.title||'Replay Lab Studio';
  });
  syncProjectUi();
  void recents();
}else{
  active('Voice');
  const section=$('speechLanguage').closest('section');body.append(section);
}
window.replayDesktop?.onCommand(command=>{
  if(command==='home')home();
  else if(command==='settings')settings();
  else if(command==='new'&&studio){editor();$('newProject').click();}
  else if(command==='open')openProject();
  else if(command==='save')save();
});
