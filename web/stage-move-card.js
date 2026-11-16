/**
 * 「换位置」 card: whether characters cut or move to this line's spots, with a speed curve
 * editor (two draggable Bézier handles, like After Effects' graph editor).
 */
import { MOVE_CURVE_PRESETS, DEFAULT_STAGE_MOVE, curveBezier, bezierCurve, moveCurveValue, normalizeStageMove } from '../dist/index.js';

const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
const describe = move => {
  if (!move || move.mode !== 'move') return '瞬移';
  const preset = MOVE_CURVE_PRESETS.find(p => p.key === move.curve);
  return `移动 ${move.duration}s · ${preset ? preset.label : '自定义曲线'}${move.delay ? ` · 延迟 ${move.delay}s` : ''}`;
};

/** Curve box: x = time, y = position (−0.8 … 1.8 so overshoot fits). */
function curveEditor(move, onInput, onCommit) {
  const W = 240, H = 170, pad = 14, yMin = -0.8, yMax = 1.8;
  const canvas = el('canvas', { width: W * 2, height: H * 2, className: 'move-curve-canvas', title: '拖动两个圆点调曲线：横向是时间，纵向是走了多远。超出上面那条线就是冲过头。' });
  canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;
  const ctx = canvas.getContext('2d'); ctx.scale(2, 2);
  const px = x => pad + x * (W - pad * 2), py = y => H - pad - (y - yMin) / (yMax - yMin) * (H - pad * 2);
  const ux = X => (X - pad) / (W - pad * 2), uy = Y => yMin + (H - pad - Y) / (H - pad * 2) * (yMax - yMin);
  let dot = 0, raf = 0, started = performance.now();
  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.03)'; ctx.fillRect(px(0), py(1), px(1) - px(0), py(0) - py(1));
    ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    for (const y of [0, 1]) { ctx.beginPath(); ctx.moveTo(px(0), py(y)); ctx.lineTo(px(1), py(y)); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.font = '10px system-ui'; ctx.fillText('到位', px(1) - 24, py(1) - 4); ctx.fillText('原位', px(1) - 24, py(0) - 4);
    const points = curveBezier(move.curve);
    if (points) {
      ctx.strokeStyle = 'rgba(180,160,255,.55)';
      ctx.beginPath(); ctx.moveTo(px(0), py(0)); ctx.lineTo(px(points[0]), py(points[1])); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px(1), py(1)); ctx.lineTo(px(points[2]), py(points[3])); ctx.stroke();
    }
    ctx.strokeStyle = '#c9b8ff'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 80; i++) { const t = i / 80, v = moveCurveValue(move.curve, t); i ? ctx.lineTo(px(t), py(v)) : ctx.moveTo(px(t), py(v)); }
    ctx.stroke();
    if (points) for (const [x, y] of [[points[0], points[1]], [points[2], points[3]]]) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(px(x), py(y), 5, 0, Math.PI * 2); ctx.fill(); }
    // A dot sliding along the bottom shows the speed in real time.
    ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(px(Math.min(1.25, Math.max(-0.25, dot))), H - 5, 4, 0, Math.PI * 2); ctx.fill();
  };
  const tick = now => {
    if (!canvas.isConnected) { cancelAnimationFrame(raf); return; }
    const cycle = Math.max(0.05, move.duration) + 0.6, t = ((now - started) / 1000) % cycle;
    dot = moveCurveValue(move.curve, t / Math.max(0.05, move.duration));
    draw(); raf = requestAnimationFrame(tick);
  };
  let dragging = -1;
  const pick = event => { const r = canvas.getBoundingClientRect(); return [event.clientX - r.left, event.clientY - r.top]; };
  canvas.onpointerdown = event => {
    const points = curveBezier(move.curve) ?? [0, 0, 0.58, 1];
    const [X, Y] = pick(event);
    const d1 = Math.hypot(X - px(points[0]), Y - py(points[1])), d2 = Math.hypot(X - px(points[2]), Y - py(points[3]));
    dragging = d1 <= d2 ? 0 : 1;
    canvas.setPointerCapture(event.pointerId);
    canvas.onpointermove(event);
  };
  canvas.onpointermove = event => {
    if (dragging < 0) return;
    const points = curveBezier(move.curve) ?? [0, 0, 0.58, 1];
    const [X, Y] = pick(event), x = Math.max(0, Math.min(1, ux(X))), y = Math.max(yMin, Math.min(yMax, uy(Y)));
    points[dragging * 2] = Math.round(x * 100) / 100; points[dragging * 2 + 1] = Math.round(y * 100) / 100;
    move.curve = bezierCurve(points); onInput(); draw();
  };
  canvas.onpointerup = () => { if (dragging >= 0) { dragging = -1; onCommit(); } };
  raf = requestAnimationFrame(tick);
  return canvas;
}

/**
 * @param host element to fill
 * @param ctx { project, line, onPreview(), onCommit(label) }
 */
export function renderStageMoveCard(host, { project, line, onPreview, onCommit }) {
  if (!host) return;
  const open = host.querySelector('details')?.open ?? false;
  host.replaceChildren();
  if (!project || !line) return;
  const projectDefault = normalizeStageMove(project.settings.stageMoveDefault);
  const own = line.stageMove !== undefined ? normalizeStageMove(line.stageMove) : null;
  const effective = own ?? projectDefault;
  const details = el('details', { open });
  details.append(el('summary', { textContent: '换位置 ' }, el('span', { className: 'summary-meta', textContent: `${describe(effective)}${own ? '' : ' · 跟随默认'}` })));
  const body = el('div', { className: 'stack disclosure-body' });
  details.append(body);
  host.append(details);

  if (line.type === 'command') {
    body.append(el('div', { className: 'muted', textContent: '指令行自己不显示画面。/move 指令可以直接写移动方式，例如：/move 亚瑟 右 0.25s 急停 延迟0.5（不写时长就是瞬移）。' }));
    return;
  }
  body.append(el('div', { className: 'muted', textContent: '上一句也在场的角色，如果这一句位置、大小变了：瞬移就是直接出现在新位置；移动就是滑过去。' }));

  const modes = el('div', { className: 'row move-mode-row' });
  const choose = (label, value) => {
    const button = el('button', { className: 'small' + ((value === 'default' ? !own : own?.mode === value) ? ' active' : ''), textContent: label });
    button.onclick = () => {
      if (value === 'default') delete line.stageMove;
      else line.stageMove = { ...(own ?? projectDefault ?? DEFAULT_STAGE_MOVE), mode: value };
      onCommit(value === 'default' ? '换位置：跟随默认' : value === 'move' ? '换位置：移动' : '换位置：瞬移');
    };
    return button;
  };
  modes.append(choose(`默认（${describe(projectDefault)}）`, 'default'), choose('瞬移', 'cut'), choose('移动', 'move'));
  body.append(modes);

  const editable = own?.mode === 'move' ? own : null;
  if (editable) {
    const move = line.stageMove = { ...editable };
    const live = () => { line.stageMove = { ...move }; onPreview(); };
    const slider = (label, key, min, max, step) => {
      const out = el('output', { textContent: `${move[key]}s` });
      const input = el('input', { type: 'range', min, max, step, value: move[key] });
      input.oninput = () => { move[key] = Number(input.value); out.textContent = `${input.value}s`; live(); };
      input.onchange = () => onCommit(`换位置：${label}`);
      return el('label', { className: 'muted' }, `${label} `, out, input);
    };
    body.append(el('div', { className: 'grid2' }, slider('时长', 'duration', 0.05, 2, 0.05), slider('延迟', 'delay', 0, Math.max(1, Math.min(10, Math.ceil(Number(line.duration) || 3))), 0.05)));
    const presets = el('div', { className: 'row move-curve-presets' });
    for (const preset of MOVE_CURVE_PRESETS) {
      const button = el('button', { className: 'small' + (move.curve === preset.key ? ' active' : ''), textContent: preset.label, title: preset.hint });
      button.onclick = () => { move.curve = preset.key; line.stageMove = { ...move }; onCommit(`换位置曲线：${preset.label}`); };
      presets.append(button);
    }
    body.append(presets);
    const isPreset = MOVE_CURVE_PRESETS.find(p => p.key === move.curve);
    body.append(el('div', { className: 'row move-curve-row' }, curveEditor(move, live, () => onCommit('换位置：调整曲线')),
      el('div', { className: 'muted move-curve-note', textContent: isPreset ? `${isPreset.label}：${isPreset.hint}。拖白点就变成自定义曲线。` : '自定义曲线。拖白点继续调；黄点按这个速度来回演示。' })));
  }

  const setDefault = el('button', { className: 'small', textContent: '把本句设置设为工程默认' });
  setDefault.disabled = !own;
  setDefault.onclick = () => { project.settings.stageMoveDefault = own?.mode === 'move' ? { ...own } : null; delete line.stageMove; onCommit('换位置：设为工程默认'); };
  body.append(el('div', { className: 'row' }, setDefault));
}
