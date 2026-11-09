/** Listening pass after a batch: filter, play through, mark bad takes, regenerate only those. */
export function createVoiceReview({ root, getProject, audioBlob, isBusy, regenerate, onChanged, listTakes, activateTake }) {
  const $ = selector => root.querySelector(selector);
  let rows = [], playing = null, objectUrl = null, sequence = false, stopRegen = false;

  const state = (text, kind = '') => { $('#vrState').className = `speech-status ${kind}`; $('#vrState').textContent = text; };
  const assetOf = line => getProject()?.assets.find(asset => asset.id === line.audioAssetId);
  const isRedo = line => line.metadata?.voiceReview === 'redo';
  const speakerName = line => getProject()?.characters.find(character => character.id === line.speakerId)?.name || '未知角色';
  const spokenChars = text => (String(text || '').match(/[\p{L}\p{N}]/gu) || []).length;

  function setRedo(line, redo) {
    line.metadata ??= {};
    if (redo) line.metadata.voiceReview = 'redo'; else delete line.metadata.voiceReview;
    onChanged();
  }
  function looksShort(line, duration) {
    const chars = spokenChars(line.speech?.textOverride || line.text);
    return chars >= 12 && duration > 0 && duration / chars < 0.08;
  }
  function visibleLines() {
    const project = getProject();
    if (!project) return [];
    const character = $('#vrCharacter').value, filter = $('#vrFilter').value;
    return project.lines.filter(line => line.audioAssetId && assetOf(line)?.kind === 'voice'
      && (!character || line.speakerId === character)
      && (filter !== 'redo' || isRedo(line))
      && (filter !== 'short' || looksShort(line, Number(assetOf(line)?.metadata?.duration) || 0)));
  }
  function syncCharacters() {
    const project = getProject(), select = $('#vrCharacter'), current = select.value;
    const voiced = new Set(project?.lines.filter(line => line.audioAssetId).map(line => line.speakerId));
    select.replaceChildren(new Option('全部角色', ''), ...(project?.characters.filter(character => voiced.has(character.id)).map(character => new Option(character.name, character.id)) || []));
    select.value = [...select.options].some(option => option.value === current) ? current : '';
  }
  function renderRow(line) {
    const project = getProject(), tr = document.createElement('tr'), duration = Number(assetOf(line)?.metadata?.duration) || 0;
    const play = document.createElement('button'); play.textContent = '▶'; play.setAttribute('aria-label', `播放第 ${project.lines.indexOf(line) + 1} 行`);
    play.addEventListener('click', () => { sequence = false; void playLine(line); });
    const redo = document.createElement('input'); redo.type = 'checkbox'; redo.checked = isRedo(line); redo.setAttribute('aria-label', '标记重录');
    redo.addEventListener('change', () => { setRedo(line, redo.checked); summarize(); });
    const cell = content => { const td = document.createElement('td'); td.append(content); return td; };
    const length = `${duration.toFixed(1)} 秒${looksShort(line, duration) ? ' · 偏短' : ''}`;
    const roll = document.createElement('button'); roll.textContent = '重 roll';
    roll.addEventListener('click', () => void rollLine(line));
    const count = listTakes(project, line).length;
    const versions = document.createElement('button'); versions.textContent = `版本 ${count + 1}`; versions.disabled = !count; versions.dataset.versions = '1';
    const tools = document.createElement('div'); tools.className = 'row'; tools.append(roll, versions);
    tr.append(cell(play), cell(redo), cell(String(project.lines.indexOf(line) + 1)), cell(speakerName(line)), cell(line.text), cell(line.speech?.textOverride || '（按原文）'), cell(length), cell(tools));
    const panel = document.createElement('tr'); panel.hidden = true;
    versions.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) renderTakes(line, panel); });
    return { line, tr, panel };
  }
  function renderTakes(line, panel) {
    const project = getProject(), holder = document.createElement('td'); holder.colSpan = 8;
    const rowFor = (label, asset, active) => {
      const row = document.createElement('div'); row.className = 'row';
      const play = document.createElement('button'); play.textContent = '▶'; play.setAttribute('aria-label', `试听${label}`);
      play.addEventListener('click', () => { sequence = false; void playAsset(asset, line); });
      const text = document.createElement('span'); text.textContent = `${label} · ${(Number(asset.metadata?.duration) || 0).toFixed(1)} 秒`;
      row.append(play, text);
      if (active) { const mark = document.createElement('small'); mark.className = 'muted'; mark.textContent = '当前使用'; row.append(mark); }
      else {
        const use = document.createElement('button'); use.textContent = '设为当前';
        use.addEventListener('click', () => void chooseTake(line, asset));
        row.append(use);
      }
      return row;
    };
    const takes = listTakes(project, line);
    holder.append(rowFor('当前版本', assetOf(line), true), ...takes.map((take, index) => rowFor(`历史 ${takes.length - index}`, take, false)));
    panel.replaceChildren(holder);
  }
  async function chooseTake(line, take) {
    if (isBusy()) { state('已有声音任务在运行', 'error'); return; }
    stop();
    try { await activateTake(line, take); refresh(); state('已切换当前版本', 'ok'); }
    catch (error) { state(`切换失败：${error?.message || error}`, 'error'); }
  }
  async function rollLine(line) {
    if (isBusy()) { state('已有声音任务在运行', 'error'); return; }
    stop();
    state('重新生成中…', 'busy');
    try { await regenerate(line); refresh(); state('已生成新版本，旧版本已存档', 'ok'); }
    catch (error) { state(`生成失败：${error?.message || error}`, 'error'); }
  }
  function summarize() {
    const redo = getProject()?.lines.filter(isRedo).length || 0;
    $('#vrRegen').textContent = redo ? `重录已标记的 ${redo} 句` : '重录已标记的句子';
    $('#vrRegen').disabled = !redo;
  }
  function refresh() {
    if (!getProject()) { state('请先载入工程', 'error'); return; }
    syncCharacters();
    rows = visibleLines().map(renderRow);
    $('#vrRows').replaceChildren(...rows.flatMap(row => [row.tr, row.panel]));
    $('#vrTable').hidden = !rows.length;
    summarize();
    state(`${rows.length} 句`, 'ok');
  }
  function highlight(line) { for (const row of rows) row.tr.style.background = row.line === line ? 'rgba(180,160,230,.18)' : ''; }
  function stop() {
    sequence = false; playing = null;
    $('#vrAudio').pause();
    highlight(null);
  }
  function playLine(line) { return playAsset(assetOf(line), line); }
  async function playAsset(asset, line) {
    const blob = await audioBlob(asset);
    if (!blob) { state(`第 ${getProject().lines.indexOf(line) + 1} 行的音频读取失败`, 'error'); return; }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    playing = line;
    highlight(line);
    rows.find(row => row.line === line)?.tr.scrollIntoView?.({ block: 'nearest' });
    const audio = $('#vrAudio');
    audio.src = objectUrl;
    await audio.play();
  }
  function advance() {
    if (!sequence || !playing) { highlight(null); return; }
    const next = rows[rows.findIndex(row => row.line === playing) + 1];
    if (!next) { stop(); state('已听完当前列表', 'ok'); return; }
    void playLine(next.line);
  }
  async function regenerateMarked() {
    const project = getProject(), marked = project?.lines.filter(isRedo) || [];
    if (!marked.length) return;
    if (isBusy()) { state('已有声音任务在运行', 'error'); return; }
    stop(); stopRegen = false;
    $('#vrRegen').disabled = true; $('#vrStopRegen').disabled = false;
    let done = 0, failed = 0, lastError = '';
    for (const line of marked) {
      if (stopRegen) break;
      state(`重录中 ${done + failed + 1} / ${marked.length}`, 'busy');
      try { await regenerate(line); setRedo(line, false); done += 1; }
      catch (error) { failed += 1; lastError = error?.message || String(error); }
    }
    $('#vrStopRegen').disabled = true;
    refresh();
    state(failed ? `完成 ${done} 句，失败 ${failed} 句：${lastError}` : `已重录 ${done} 句`, failed ? 'error' : 'ok');
  }

  $('#vrRefresh').addEventListener('click', refresh);
  $('#vrCharacter').addEventListener('change', refresh);
  $('#vrFilter').addEventListener('change', refresh);
  $('#vrPlayAll').addEventListener('click', () => { if (rows.length) { sequence = true; void playLine(rows[0].line); } });
  $('#vrStop').addEventListener('click', stop);
  $('#vrRegen').addEventListener('click', () => void regenerateMarked());
  $('#vrStopRegen').addEventListener('click', () => { stopRegen = true; });
  $('#vrAudio').addEventListener('ended', advance);
  return { refresh };
}
