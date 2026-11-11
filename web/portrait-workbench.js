// 施工台「立绘」页: gaze pad + face shape sliders + lattice warp.
// Two scopes:
//   - 这一句: line.puppetParams[characterId] overrides the expression for this
//     line only; consecutive lines in the same expression ease between values.
//   - 表情默认: character.puppet.expressionPresets[expression], used by every
//     line in that expression that has no override.

export const PORTRAIT_PARAM_GROUPS = [
  ['眼睛', [['eyeSquash', '眼睛压扁', 0.6, 1.25, 0.01]]],
  ['眉毛', [['browY', '眉毛高度', -1, 1, 0.02], ['browAngle', '眉毛角度', -1, 1, 0.02]]],
  ['嘴巴', [['mouthY', '嘴巴高度', -1, 1, 0.02], ['mouthTilt', '嘴巴倾斜', -1, 1, 0.02]]]
];

const PAD_W = 180, PAD_H = 120;

export function renderPortraitWorkbench(host, ctx) {
  const { project, line, perf, escapeHtml, characterExpressionNames, normalizePuppetRig, bindWarpEditor, target, setTarget, onChange } = ctx;
  if (!host) return;
  if (!project) { host.innerHTML = '<div class="muted">先打开工程。</div>'; return; }
  const characters = project.characters;
  if (!characters.length) { host.innerHTML = '<div class="muted">工程里还没有角色。</div>'; return; }
  let character = characters.find(c => c.id === target.characterId);
  let expression = target.expression;
  if (!character || target.followLine) {
    const speaker = line && line.type !== 'command' ? characters.find(c => c.id === line.speakerId) : null;
    character = speaker ?? character ?? characters[0];
    expression = (speaker && perf?.state?.expressions?.[speaker.id]) || (target.followLine ? 'default' : expression) || 'default';
  }
  const names = characterExpressionNames(character);
  if (!names.includes(expression)) expression = 'default';
  const scope = target.scope === 'expression' ? 'expression' : 'line';
  const lineEditable = !!line && line.type !== 'command';
  // In line scope the expression is whatever this line shows for the character.
  if (scope === 'line' && lineEditable) expression = perf?.state?.expressions?.[character.id] || 'default';
  setTarget({ characterId: character.id, expression, followLine: target.followLine, scope });
  character.puppet = normalizePuppetRig(character.puppet);
  const preset = character.puppet.expressionPresets[expression] ?? {};
  const lineValues = scope === 'line' && lineEditable ? (line.puppetParams?.[character.id] ?? {}) : {};
  const expressionValue = id => preset[id] ?? character.puppet.parameters.find(x => x.id === id)?.defaultValue ?? 0;
  const value = id => lineValues[id] ?? expressionValue(id);
  const onStage = !perf?.state?.roster || perf.state.roster.includes(character.id);
  const exprLabel = escapeHtml(expression === 'default' ? '默认' : expression);
  const hasPupils = !!(character.layers?.pupils || character.layers?.pupilLeft || character.layers?.pupilRight ||
    Object.values(character.layerExpressions || {}).some(set => set?.pupils || set?.pupilLeft || set?.pupilRight) ||
    project.faceTemplates?.find(t => t.id === character.faceFit?.templateId)?.layers?.pupils);
  const mark = id => scope === 'line' && Object.prototype.hasOwnProperty.call(lineValues, id) ? ' <span class="summary-meta" data-portrait-own="' + id + '">本句</span>' : '';
  const slider = ([id, label, min, max, step]) => `<label class="muted">${label}${mark(id)} <span data-portrait-value="${id}">${Number(value(id)).toFixed(2)}</span><input data-portrait-param="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value(id)}"></label>`;
  host.innerHTML = `
    <div class="voice-line-card stack">
      <div class="row" style="flex-wrap:wrap;gap:8px">
        <label class="muted">角色<select data-portrait-character style="width:auto">${characters.map(c => `<option value="${escapeHtml(c.id)}" ${c.id === character.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}</select></label>
        <div class="row" role="radiogroup" aria-label="改哪里" style="gap:4px"><button type="button" class="small${scope === 'line' ? ' active' : ''}" data-portrait-scope="line" aria-pressed="${scope === 'line'}">这一句</button><button type="button" class="small${scope === 'expression' ? ' active' : ''}" data-portrait-scope="expression" aria-pressed="${scope === 'expression'}">表情默认</button></div>
        <label class="muted">表情<select data-portrait-expression style="width:auto" ${scope === 'line' && lineEditable ? 'disabled title="这一句的表情由台词决定"' : ''}>${names.map(n => `<option value="${escapeHtml(n)}" ${n === expression ? 'selected' : ''}>${escapeHtml(n === 'default' ? '默认' : n)}</option>`).join('')}</select></label>
        <label class="muted"><input data-portrait-follow type="checkbox" ${target.followLine ? 'checked' : ''}> 跟随当前句</label>
        ${scope === 'line'
          ? `<button data-portrait-line-reset class="small" type="button" ${Object.keys(lineValues).length ? '' : 'disabled'}>本句恢复跟随表情</button>`
          : '<button data-portrait-reset class="small" type="button">这个表情全部归零</button>'}
      </div>
      ${scope === 'line'
        ? (lineEditable
          ? `<div class="muted">改的是<strong>这一句</strong>里的「${escapeHtml(character.name)}」（表情：${exprLabel}）。没单独设的项跟随表情；标着「本句」的是这一句自己的值。</div>${onStage ? '' : '<div class="status warn">这个角色这一句不在场，改了也看不到。</div>'}
             <label class="muted">同一表情换句时过渡 <span data-portrait-transition-value>${Number(project.settings.puppetTransitionSeconds ?? 0.3).toFixed(2)} 秒</span><input data-portrait-transition type="range" min="0" max="1" step="0.05" value="${project.settings.puppetTransitionSeconds ?? 0.3}"></label>`
          : '<div class="status warn">当前选中的是导演指令行，选一句台词才能单独设置；或切到「表情默认」。</div>')
        : `<div class="muted">改的是「${escapeHtml(character.name)} · ${exprLabel}」的默认值：所有用这个表情、且没单独设置的句子都会跟着变。</div>`}
    </div>
    <div class="voice-line-card stack">
      <strong>视线</strong>
      ${hasPupils ? '' : '<div class="status warn">这个角色还没有瞳孔图层（角色卡里的「瞳孔」），视线调了也看不出来。</div>'}
      <div class="row" style="gap:12px;align-items:flex-start;flex-wrap:wrap">
        <canvas data-gaze-pad width="${PAD_W}" height="${PAD_H}" style="width:${PAD_W}px;height:${PAD_H}px;border-radius:8px;cursor:crosshair;touch-action:none" title="拖动小圆点改变视线；双击回正"></canvas>
        <div class="stack" style="min-width:180px;flex:1">${slider(['lookX', '视线左右', -1, 1, 0.02])}${slider(['lookY', '视线上下', -1, 1, 0.02])}<button data-gaze-center class="small" type="button">视线回正</button><div class="muted">左右按立绘图片本身的方向；角色在舞台上被镜像时视线也一起镜像。</div></div>
      </div>
    </div>
    ${PORTRAIT_PARAM_GROUPS.map(([title, params]) => `<div class="voice-line-card stack"><strong>${title}</strong>${params.map(slider).join('')}</div>`).join('')}
    ${scope === 'line' ? '' : `<details class="voice-line-card advanced-only"><summary>网格拉形变 <span class="summary-meta">3×3 lattice</span></summary><div class="stack disclosure-body"><div class="row"><select data-warp-part style="width:auto"><option value="mouth">嘴巴</option><option value="eyes">眼睛</option><option value="brows">眉毛</option><option value="eyelids">眼皮</option><option value="pupils">瞳孔</option><option value="overlay">覆盖层</option><option value="base">底图</option></select><button data-warp-reset class="small" type="button">重置网格</button></div><canvas data-warp-canvas width="260" height="196" style="width:260px;height:196px;border-radius:8px;cursor:grab"></canvas></div></details>`}`;
  const disabled = scope === 'line' && !lineEditable;
  if (disabled) for (const el of host.querySelectorAll('[data-portrait-param],[data-gaze-center]')) el.disabled = true;

  const write = (id, v, label = '调整立绘') => {
    if (disabled) return;
    const rounded = Math.round(Number(v) * 100) / 100;
    if (scope === 'line') {
      line.puppetParams ??= {};
      line.puppetParams[character.id] ??= {};
      line.puppetParams[character.id][id] = rounded;
      lineValues[id] = rounded;
      host.querySelector('[data-portrait-line-reset]')?.removeAttribute('disabled');
    } else {
      character.puppet.expressionPresets[expression] ??= {};
      character.puppet.expressionPresets[expression][id] = rounded;
    }
    const out = host.querySelector(`[data-portrait-value="${id}"]`);
    if (out) out.textContent = Number(v).toFixed(2);
    const input = host.querySelector(`[data-portrait-param="${id}"]`);
    if (input && Number(input.value) !== Number(v)) input.value = String(v);
    onChange(label, scope === 'line' ? `line-puppet:${line.id}:${character.id}:${id}` : `puppet-param:${character.id}:${expression}:${id}`);
  };
  for (const input of host.querySelectorAll('[data-portrait-param]')) input.oninput = () => { write(input.dataset.portraitParam, input.value); drawPad(); };
  // Re-render after a line edit so the 「本句」 marks and reset button update.
  for (const input of host.querySelectorAll('[data-portrait-param]')) input.onchange = () => { if (scope === 'line') ctx.rerender(); };

  const pad = host.querySelector('[data-gaze-pad]'), g = pad.getContext('2d');
  const drawPad = () => {
    const x = (value('lookX') + 1) / 2 * PAD_W, y = (value('lookY') + 1) / 2 * PAD_H;
    g.clearRect(0, 0, PAD_W, PAD_H); g.fillStyle = '#0c111a'; g.fillRect(0, 0, PAD_W, PAD_H);
    g.strokeStyle = '#34405a'; g.beginPath(); g.moveTo(PAD_W / 2, 0); g.lineTo(PAD_W / 2, PAD_H); g.moveTo(0, PAD_H / 2); g.lineTo(PAD_W, PAD_H / 2); g.stroke();
    g.fillStyle = '#e8edf7'; g.beginPath(); g.ellipse(PAD_W / 2, PAD_H / 2, PAD_W * 0.42, PAD_H * 0.38, 0, 0, Math.PI * 2); g.globalAlpha = 0.12; g.fill(); g.globalAlpha = 1;
    g.fillStyle = '#7bb6ff'; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); g.strokeStyle = '#0a0d13'; g.stroke();
  };
  let dragging = false;
  const fromEvent = e => {
    const r = pad.getBoundingClientRect();
    const w = r.width || PAD_W, h = r.height || PAD_H;
    const unit = v => Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
    write('lookX', unit(((e.clientX - r.left) / w) * 2 - 1).toFixed(2), '调整视线');
    write('lookY', unit(((e.clientY - r.top) / h) * 2 - 1).toFixed(2), '调整视线');
    drawPad();
  };
  pad.onpointerdown = e => { if (disabled) return; dragging = true; pad.setPointerCapture?.(e.pointerId); fromEvent(e); };
  pad.onpointermove = e => { if (dragging) fromEvent(e); };
  pad.onpointerup = e => { const was = dragging; dragging = false; pad.releasePointerCapture?.(e.pointerId); if (was && scope === 'line') ctx.rerender(); };
  const center = () => { if (disabled) return; write('lookX', 0, '视线回正'); write('lookY', 0, '视线回正'); drawPad(); if (scope === 'line') ctx.rerender(); };
  pad.ondblclick = center;
  host.querySelector('[data-gaze-center]').onclick = center;
  drawPad();

  host.querySelector('[data-portrait-character]').onchange = e => { setTarget({ characterId: e.target.value, expression: 'default', followLine: false, scope }); ctx.rerender(); };
  host.querySelector('[data-portrait-expression]').onchange = e => { setTarget({ characterId: character.id, expression: e.target.value, followLine: false, scope }); ctx.rerender(); };
  host.querySelector('[data-portrait-follow]').onchange = e => { setTarget({ characterId: character.id, expression, followLine: e.target.checked, scope }); ctx.rerender(); };
  for (const button of host.querySelectorAll('[data-portrait-scope]')) button.onclick = () => { setTarget({ characterId: character.id, expression, followLine: target.followLine, scope: button.dataset.portraitScope }); ctx.rerender(); };
  const transition = host.querySelector('[data-portrait-transition]');
  if (transition) transition.oninput = () => {
    project.settings.puppetTransitionSeconds = Number(transition.value);
    host.querySelector('[data-portrait-transition-value]').textContent = `${Number(transition.value).toFixed(2)} 秒`;
    onChange('修改立绘过渡时长', 'puppet-transition');
  };
  host.querySelector('[data-portrait-line-reset]')?.addEventListener('click', () => {
    if (!line?.puppetParams?.[character.id]) return;
    delete line.puppetParams[character.id];
    if (!Object.keys(line.puppetParams).length) delete line.puppetParams;
    onChange('本句立绘恢复跟随表情', `line-puppet-reset:${line.id}:${character.id}`);
    ctx.rerender();
  });
  host.querySelector('[data-portrait-reset]')?.addEventListener('click', () => {
    const keep = Object.fromEntries(Object.entries(character.puppet.expressionPresets[expression] ?? {}).filter(([id]) => id.startsWith('exprWarp:')));
    character.puppet.expressionPresets[expression] = keep;
    onChange('立绘参数归零', `puppet-reset:${character.id}:${expression}`);
    ctx.rerender();
  });
  if (scope === 'expression') bindWarpEditor(host, character, expression);
}
