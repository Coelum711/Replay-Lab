/**
 * Sound picker in the spirit of RPG Maker's "Play SE" dialog: browse by folder, search,
 * audition, set volume / pan / delay, then attach to the line or insert a command.
 */
const KINDS = [['sfx', '音效'], ['ambient', '环境声'], ['bgm', 'BGM']];
const formatSeconds = value => Number.isFinite(value) && value > 0 ? `${value.toFixed(1)} 秒` : '';

export function createSoundPicker({ getProject, resolveAsset, applyLineSound, insertCommand, startBed, rescan, importFiles }) {
  let overlay = null, audio = null, objectUrl = null, playingId = null;
  const stop = () => { audio?.pause(); if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; playingId = null; };
  const close = () => { stop(); overlay?.remove(); overlay = null; document.removeEventListener('keydown', onKey); };
  const onKey = event => { if (event.key === 'Escape') close(); };

  async function audition(asset, volume, button) {
    if (playingId === asset.id) { stop(); button.textContent = '▶'; return; }
    stop();
    const source = await resolveAsset(asset.id);
    if (!source) { button.textContent = '✕'; button.title = '读取失败'; return; }
    audio ??= new Audio();
    if (typeof source === 'string') audio.src = source; else { objectUrl = URL.createObjectURL(source); audio.src = objectUrl; }
    audio.volume = Math.max(0, Math.min(1, volume));
    playingId = asset.id;
    overlay?.querySelectorAll('[data-sound-play]').forEach(item => { item.textContent = '▶'; });
    button.textContent = '■';
    audio.onended = () => { button.textContent = '▶'; playingId = null; };
    audio.play().catch(() => { button.textContent = '▶'; playingId = null; });
  }

  function open(line, { lineNumber, kind: initialKind = 'sfx' } = {}) {
    close();
    const project = getProject();
    if (!project || !line) return;
    const mix = line.audioMix ?? {};
    let kind = initialKind, query = '';
    let chosen = line.sfxAssetId || null;
    overlay = document.createElement('div');
    overlay.className = 'sound-picker-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(6,6,12,.55);display:flex;align-items:center;justify-content:center;z-index:9999';
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    const panel = document.createElement('div');
    panel.className = 'card stack';
    panel.dataset.soundPicker = '1';
    panel.style.cssText = 'width:min(560px,92vw);max-height:84vh;display:flex;flex-direction:column;gap:10px;background:#1d1b27;border:1px solid #3a3746;border-radius:12px;padding:16px';
    panel.innerHTML = `
      <div class="row" style="justify-content:space-between"><strong>选择声音 · 第 ${lineNumber ?? '?'} 句</strong><button class="small" data-sound-close>关闭</button></div>
      <div class="row" data-sound-tabs>${KINDS.map(([value, label]) => `<button class="small" data-sound-kind="${value}">${label}</button>`).join('')}</div>
      <input data-sound-search placeholder="搜索文件名…">
      <div data-sound-list class="stack" style="overflow:auto;min-height:120px;max-height:42vh;gap:4px"></div>
      <div class="grid3" data-sound-controls>
        <label>音量 <input type="range" min="0" max="150" step="5" data-sound-volume value="${Math.round((mix.sfxGain ?? 1) * 100)}"><span data-sound-volume-label></span></label>
        <label>左右 <input type="range" min="-100" max="100" step="10" data-sound-pan value="${Math.round((mix.sfxPan ?? 0) * 100)}"><span data-sound-pan-label></span></label>
        <label>开口后几秒响 <input type="number" min="0" step="0.1" data-sound-delay value="${mix.sfxOffset ?? 0}" style="width:5em"></label>
      </div>
      <div class="row" data-sound-actions style="flex-wrap:wrap"></div>
      <div class="row muted" style="font-size:11px;flex-wrap:wrap;gap:6px"><span>没找到？把文件放进工程的 <code>assets/sfx</code>（BGM 放 <code>assets/bgm</code>，环境声放 <code>assets/ambient</code>）再刷新，或者直接导入。</span>
        <button class="small" data-sound-rescan>刷新素材文件夹</button><button class="small" data-sound-import>导入文件…</button></div>`;
    overlay.append(panel);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    const $ = selector => panel.querySelector(selector);
    const volume = () => Number($('[data-sound-volume]').value) / 100;
    const pan = () => Number($('[data-sound-pan]').value) / 100;
    const labels = () => {
      $('[data-sound-volume-label]').textContent = ` ${Math.round(volume() * 100)}%`;
      const p = pan(); $('[data-sound-pan-label]').textContent = p === 0 ? ' 居中' : ` ${p < 0 ? '左' : '右'} ${Math.round(Math.abs(p) * 100)}%`;
    };
    function renderActions() {
      const actions = $('[data-sound-actions]');
      actions.replaceChildren();
      const button = (text, attr, handler, primary = false) => { const b = document.createElement('button'); b.className = primary ? 'small primary' : 'small'; b.textContent = text; b.dataset[attr] = '1'; b.disabled = !chosen && attr !== 'soundRemove'; b.onclick = handler; actions.append(b); };
      const asset = getProject()?.assets.find(item => item.id === chosen);
      if (kind === 'sfx') {
        button('用在这句', 'soundApply', () => { applyLineSound(line, { assetId: chosen, gain: volume(), pan: pan(), offset: Math.max(0, Number($('[data-sound-delay]').value) || 0) }); close(); }, true);
        button('插成单独一行 /sfx', 'soundCommand', () => { insertCommand(`/sfx ${quote(asset.name)}`); close(); });
        if (line.sfxAssetId) { const remove = document.createElement('button'); remove.className = 'small'; remove.textContent = '去掉这句的音效'; remove.dataset.soundRemove = '1'; remove.onclick = () => { applyLineSound(line, { assetId: null }); close(); }; actions.append(remove); }
      } else {
        const command = kind === 'bgm' ? '/bgm' : '/ambient';
        button(`从这句开始播放`, 'soundBed', () => { startBed(line, kind, chosen); close(); }, true);
        button(`插成单独一行 ${command}`, 'soundCommand', () => { insertCommand(`${command} ${quote(asset.name)}`); close(); });
        button(`插一行停止 ${command} stop`, 'soundStop', () => { insertCommand(`${command} stop`); close(); });
        actions.lastChild.disabled = false;
      }
    }
    function renderList() {
      const list = $('[data-sound-list]');
      list.replaceChildren();
      panel.querySelectorAll('[data-sound-kind]').forEach(tab => tab.classList.toggle('primary', tab.dataset.soundKind === kind));
      $('[data-sound-controls]').hidden = kind !== 'sfx';
      const items = (getProject()?.assets ?? []).filter(asset => asset.kind === kind && (!query || asset.name.toLowerCase().includes(query)))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      if (!items.length) { const empty = document.createElement('div'); empty.className = 'muted'; empty.textContent = query ? '没有匹配的文件。' : '这个分类还没有素材。'; list.append(empty); }
      for (const asset of items) {
        const row = document.createElement('div');
        row.className = 'row'; row.dataset.soundItem = asset.id;
        row.style.cssText = `padding:4px 6px;border-radius:6px;cursor:pointer;${asset.id === chosen ? 'background:rgba(180,160,230,.22)' : ''}`;
        const play = document.createElement('button'); play.className = 'small'; play.textContent = playingId === asset.id ? '■' : '▶'; play.dataset.soundPlay = asset.id;
        play.onclick = event => { event.stopPropagation(); void audition(asset, kind === 'sfx' ? volume() : 0.8, play); };
        const name = document.createElement('span'); name.textContent = asset.name; name.style.flex = '1';
        const length = document.createElement('small'); length.className = 'muted'; length.textContent = formatSeconds(Number(asset.metadata?.duration));
        row.append(play, name, length);
        row.onclick = () => { chosen = asset.id; renderList(); renderActions(); };
        row.ondblclick = () => { chosen = asset.id; void audition(asset, kind === 'sfx' ? volume() : 0.8, play); };
        list.append(row);
      }
    }
    panel.querySelectorAll('[data-sound-kind]').forEach(tab => tab.onclick = () => { kind = tab.dataset.soundKind; chosen = kind === 'sfx' ? line.sfxAssetId || null : null; stop(); renderList(); renderActions(); });
    $('[data-sound-search]').oninput = event => { query = event.target.value.trim().toLowerCase(); renderList(); };
    $('[data-sound-volume]').oninput = () => { labels(); if (audio) audio.volume = Math.max(0, Math.min(1, volume())); };
    $('[data-sound-pan]').oninput = labels;
    $('[data-sound-close]').onclick = close;
    $('[data-sound-rescan]').onclick = async () => { await rescan?.(); renderList(); };
    $('[data-sound-import]').onclick = () => { close(); importFiles?.(kind); };
    labels(); renderList(); renderActions();
    $('[data-sound-search]').focus();
  }
  return { open, close };
}

const quote = value => /\s/.test(value) ? `"${String(value).replace(/"/g, '\\"')}"` : value;
