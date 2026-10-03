// A classic script so startup diagnostics work even when an ES module fails.
(()=>{
  const guard=document.getElementById('bootGuard');
  if(!guard)return;
  const page=document.currentScript?.dataset.page||'Studio';
  const desktop=location.protocol==='replaylab:'||!!window.replayDesktop;
  let ready=false,firstError=null,timer;
  function show(message){
    document.body.classList.add('boot-blocked');guard.hidden=false;
    const title=document.createElement('strong'),detail=document.createElement('div');
    title.textContent=`${page} 没有成功启动。`;detail.className='boot-help';detail.textContent=message;
    guard.replaceChildren(title,detail);
  }
  function fail(message){
    if(ready||firstError)return;
    firstError=String(message);clearTimeout(timer);show(firstError);
    console.error('[Replay Lab startup]',firstError);
  }
  window.__replayLabBootFail=fail;
  window.__replayLabMarkBootReady=()=>{ready=true;clearTimeout(timer);document.body.classList.remove('boot-blocked');guard.hidden=true;};
  window.addEventListener('error',event=>{
    if(event.message){const source=event.filename?` (${event.filename}:${event.lineno||0}:${event.colno||0})`:'';fail(`启动异常：${event.message}${source}`);}
    else if(event.target?.tagName==='SCRIPT')fail(`脚本加载失败：${event.target.src||'未知脚本'}`);
  },true);
  window.addEventListener('unhandledrejection',event=>fail(`启动异常：${event.reason?.stack||event.reason?.message||event.reason||'未处理的 Promise 错误'}`));
  if(location.protocol==='file:')fail('不能直接双击 HTML。请从工程根目录运行 START_REPLAY_LAB 启动器。');
  if(!firstError)timer=setTimeout(()=>{
    if(ready||firstError)return;
    show(desktop?'制作区仍未完成加载。请从“视图 → 启动诊断”查看 Console 中的首个错误，并发送错误内容。':'页面仍未完成加载。请查看浏览器控制台中的首个错误；若从源码运行，请确认已经执行 npm run build。');
  },10000);
  window.addEventListener('beforeunload',()=>clearTimeout(timer),{once:true});
})();
