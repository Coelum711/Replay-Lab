/**
 * 「图层」 workbench tab: a timeline cut into scenes (大段) and lines (小段). Layer clips can be dragged
 * across lines, but every edge and keyframe is stored against the nearest line, so re-rolled voice
 * keeps them in place. Snaps to line boundaries; hold Option (Alt) to place freely inside a line.
 */
import { LAYER_TRACKS, MOVE_CURVE_PRESETS, DEFAULT_LAYER_POSE, DEFAULT_LAYER_FRAME, anchorAt, anchorTime, layerPoseAt, normalizeLayer, makeId } from '../dist/index.js';

const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children.filter(c => c != null)); return node; };
const round = (v, n = 2) => Math.round(v * 10 ** n) / 10 ** n;
const state = { layerId: null, keyframeId: null, windowShift: 0 };
const WINDOW_LINES = 14;

/** The slice of the script the timeline shows: the selected line's scene, capped to a window of lines. */
function timelineWindow(perf, selectedIndex) {
  const shown = perf.lines.map((line, index) => ({ line, index })).filter(item => item.line.duration > 0);
  if (!shown.length) return null;
  const key = line => `${line.chapterTitle ?? ''}\u0000${line.sceneTitle ?? ''}`;
  const groups = [];
  for (const item of shown) { const last = groups.at(-1); if (last && last.key === key(item.line)) last.items.push(item); else groups.push({ key: key(item.line), title: item.line.sceneTitle || item.line.chapterTitle || '未分场景', items: [item] }); }
  let at = shown.findIndex(item => item.index >= selectedIndex); if (at < 0) at = shown.length - 1;
  let from = Math.max(0, at - Math.floor(WINDOW_LINES / 2) + state.windowShift * WINDOW_LINES);
  from = Math.min(from, Math.max(0, shown.length - WINDOW_LINES));
  const items = shown.slice(from, from + WINDOW_LINES);
  const t0 = items[0].line.start, t1 = items.at(-1).line.end;
  return { shown, groups, items, t0, t1, canBack: from > 0, canForward: from + WINDOW_LINES < shown.length };
}

/** End anchors prefer "end of the line that finishes here" over "start of the next one". */
function endAnchor(time, lines) {
  const shown = lines.filter(line => line.duration > 0);
  const line = shown.find(item => time > item.start + 1e-6 && time <= item.start + item.duration + 1e-6) ?? shown.at(-1);
  if (!line) return null;
  const offset = Math.min(line.duration, Math.max(0, time - line.start));
  return { lineId: line.lineId, offset: offset >= line.duration - 1e-3 ? null : round(offset, 3) };
}

function describeAnchor(anchor, perf, end = false) {
  const index = perf.lines.findIndex(line => line.lineId === anchor.lineId);
  if (index < 0) return '（那一句已删除）';
  return anchor.offset === null ? `第 ${index + 1} 句结束` : `第 ${index + 1} 句${anchor.offset ? ` +${round(anchor.offset)}s` : end ? ' 开头' : ''}`;
}

/**
 * @param host element to fill
 * @param ctx { project, perf, getPerf(), time (playhead seconds), selectedIndex, selectLine(index), importFiles(files) → Promise<string[]> (asset ids), onPreview(), onCommit(label), setStatus(text) }
 */
export function renderLayerTimeline(host, ctx) {
  if (!host) return;
  host.replaceChildren();
  const { project, perf } = ctx;
  if (!project || !perf) { host.append(el('div', { className: 'muted', textContent: '先导入台本。' })); return; }
  project.layers ??= [];
  const layers = project.layers;
  const lines = perf.lines;
  const win = timelineWindow(perf, ctx.selectedIndex);
  const resolved = id => (ctx.getPerf?.() ?? perf).layers?.find(layer => layer.id === id) ?? null;
  const span = () => Math.max(0.001, win.t1 - win.t0);
  const pct = t => `${((t - win.t0) / span()) * 100}%`;

  const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  const addAt = async (files, time) => {
    const images = [...files].filter(file => file.type.startsWith('image/'));
    if (!images.length) { ctx.setStatus('只能加入图片（GIF 和视频会在下一步支持）。'); return; }
    const ids = await ctx.importFiles(images);
    const t = time ?? (lines[ctx.selectedIndex]?.start ?? win.t0);
    for (const [i, assetId] of ids.entries()) {
      const start = anchorAt(t, lines);
      const layer = normalizeLayer({ id: makeId('layer'), name: images[i].name.replace(/\.[^.]+$/, ''), assetId, track: 'pip', start, end: { lineId: start.lineId, offset: null }, base: { ...DEFAULT_LAYER_POSE, x: DEFAULT_LAYER_POSE.x - i * 0.04, y: DEFAULT_LAYER_POSE.y + i * 0.04 }, frame: { ...DEFAULT_LAYER_FRAME }, keyframes: [] });
      layers.push(layer); state.layerId = layer.id; state.keyframeId = null;
    }
    ctx.onCommit(images.length > 1 ? `加入 ${images.length} 个图层` : '加入图层');
  };
  fileInput.onchange = () => { if (fileInput.files?.length) void addAt(fileInput.files); fileInput.value = ''; };

  const head = el('div', { className: 'row layer-head' },
    el('strong', { textContent: '图层' }),
    el('span', { className: 'muted', textContent: '拖动吸附句子边界 · 按住 Option 句内微调 · 可以把图片直接拖进来' }),
    el('span', { style: 'flex:1' }),
    Object.assign(el('button', { className: 'small', textContent: '◀', title: '往前看' }), { disabled: !win?.canBack, onclick: () => { state.windowShift -= 1; ctx.onPreview(true); } }),
    Object.assign(el('button', { className: 'small', textContent: '回到当前句' }), { onclick: () => { state.windowShift = 0; ctx.onPreview(true); } }),
    Object.assign(el('button', { className: 'small', textContent: '▶', title: '往后看' }), { disabled: !win?.canForward, onclick: () => { state.windowShift += 1; ctx.onPreview(true); } }),
    Object.assign(el('button', { className: 'small primary', textContent: '+ 图片' }), { onclick: () => fileInput.click() }),
    fileInput);
  host.append(head);
  if (!win) { host.append(el('div', { className: 'muted', textContent: '没有可显示的台词。' })); return; }

  const body = el('div', { className: 'layer-body' });
  const timeline = el('div', { className: 'layer-timeline' });
  const panel = el('div', { className: 'layer-panel' });
  body.append(timeline, panel);
  host.append(body);

  // Scene row (大段)
  const sceneLane = el('div', { className: 'layer-lane' });
  for (const group of win.groups) {
    const s = Math.max(win.t0, group.items[0].line.start), e = Math.min(win.t1, group.items.at(-1).line.end);
    if (e <= s) continue;
    sceneLane.append(el('div', { className: 'layer-seg scene', textContent: group.title, title: group.title, style: `left:${pct(s)};width:calc(${pct(e)} - ${pct(s)} - 2px)` }));
  }
  timeline.append(el('div', { className: 'layer-row' }, el('span', { className: 'layer-row-label', textContent: '场景' }), sceneLane));

  // Line row (小段)
  const lineLane = el('div', { className: 'layer-lane' });
  for (const { line, index } of win.items) {
    const color = project.characters.find(c => c.id === line.speakerId)?.color || '#8b7cf0';
    const seg = el('div', { className: 'layer-seg line' + (index === ctx.selectedIndex ? ' active' : ''), title: `第 ${index + 1} 句 · ${line.speakerName}：${line.text}`, style: `left:${pct(line.start)};width:calc(${pct(line.end)} - ${pct(line.start)} - 2px);border-color:${color}` },
      el('span', { textContent: `${index + 1} ${line.type === 'dialogue' ? line.speakerName.slice(0, 2) : ''}` }));
    seg.onclick = () => ctx.selectLine(index);
    lineLane.append(seg);
  }
  timeline.append(el('div', { className: 'layer-row' }, el('span', { className: 'layer-row-label', textContent: '台词' }), lineLane));
  const current = lines[ctx.selectedIndex];
  const now = Number.isFinite(ctx.time) && current && ctx.time >= current.start && ctx.time <= current.end ? ctx.time : current?.start;
  const playhead = now !== undefined && now >= win.t0 && now <= win.t1 ? el('div', { className: 'layer-playhead', style: `left:${pct(now)}` }) : null;

  // Snapping
  const boundaries = win.items.flatMap(({ line }) => [line.start, line.end]);
  const laneWidth = () => lineLane.getBoundingClientRect().width || 1;
  const snap = (t, event) => {
    if (event.altKey) return t;
    const reach = 10 / laneWidth() * span();
    let best = t, bestDistance = reach;
    for (const b of boundaries) { const d = Math.abs(b - t); if (d < bestDistance) { best = b; bestDistance = d; } }
    return best;
  };
  const timeAtX = clientX => { const r = lineLane.getBoundingClientRect(); return win.t0 + (clientX - r.left) / (r.width || 1) * span(); };

  // Tracks
  for (const track of LAYER_TRACKS) {
    const lane = el('div', { className: 'layer-lane track' });
    lane.ondragover = event => { event.preventDefault(); lane.classList.add('drop'); };
    lane.ondragleave = () => lane.classList.remove('drop');
    lane.ondrop = event => { event.preventDefault(); lane.classList.remove('drop'); const files = event.dataTransfer?.files; if (files?.length) { const t = snap(timeAtX(event.clientX), event); void addAt(files, t).then(() => { const last = layers.at(-1); if (last && last.track !== track.key) { last.track = track.key; ctx.onCommit('调整图层轨道'); } }); } };
    for (const raw of layers.filter(layer => (layer.track || 'pip') === track.key)) {
      const layer = resolved(raw.id);
      if (!layer || layer.end <= win.t0 || layer.start >= win.t1) continue;
      const s = Math.max(win.t0, layer.start), e = Math.min(win.t1, layer.end);
      const clip = el('div', { className: 'layer-clip' + (raw.id === state.layerId ? ' active' : '') + (raw.hidden ? ' muted-clip' : ''), title: `${raw.name}\n${describeAnchor(raw.start, perf)} → ${describeAnchor(raw.end, perf, true)}`, style: `left:${pct(s)};width:calc(${pct(e)} - ${pct(s)})` },
        el('span', { className: 'layer-edge left' }), el('span', { className: 'layer-clip-name', textContent: raw.name }), el('span', { className: 'layer-edge right' }));
      for (const key of layer.keyframes) {
        if (key.time < win.t0 || key.time > win.t1) continue;
        const source = raw.keyframes.find(k => anchorTime(k.at, lines) === key.time);
        const diamond = el('span', { className: 'layer-kf' + (source && source.id === state.keyframeId ? ' active' : ''), title: '关键帧', style: `left:calc(${((key.time - s) / Math.max(0.001, e - s)) * 100}% - 5px)` });
        diamond.dataset.kf = source?.id ?? '';
        clip.append(diamond);
      }
      clip.onpointerdown = event => {
        event.preventDefault(); event.stopPropagation();
        const kfId = event.target.dataset?.kf;
        const mode = kfId ? 'kf' : event.target.classList.contains('left') ? 'left' : event.target.classList.contains('right') ? 'right' : 'move';
        const startTime = anchorTime(raw.start, lines), endTime = anchorTime(raw.end, lines);
        const keyTimes = raw.keyframes.map(k => [k, anchorTime(k.at, lines)]);
        const grab = timeAtX(event.clientX);
        let moved = false;
        state.layerId = raw.id; state.keyframeId = kfId || null;
        try { clip.setPointerCapture(event.pointerId); } catch {}
        clip.onpointermove = ev => {
          const delta = timeAtX(ev.clientX) - grab;
          if (!moved && Math.abs(delta) < span() * 0.004) return;
          moved = true;
          if (mode === 'move') {
            const length = endTime - startTime;
            let ns = snap(startTime + delta, ev); const ne0 = snap(endTime + delta, ev);
            if (ns === startTime + delta && ne0 !== endTime + delta) ns = ne0 - length;
            ns = Math.max(0, Math.min(perf.duration - length, ns));
            raw.start = anchorAt(ns, lines); raw.end = endAnchor(ns + length, lines);
            for (const [k, t] of keyTimes) if (t !== null) k.at = anchorAt(Math.min(ns + length, t + (ns - startTime)), lines);
          } else if (mode === 'left') {
            const ns = Math.min(endTime - 0.1, Math.max(0, snap(startTime + delta, ev)));
            raw.start = anchorAt(ns, lines);
          } else if (mode === 'right') {
            const ne = Math.max(startTime + 0.1, Math.min(perf.duration, snap(endTime + delta, ev)));
            raw.end = endAnchor(ne, lines);
          } else {
            const k = raw.keyframes.find(item => item.id === kfId); const t0 = keyTimes.find(([item]) => item === k)?.[1];
            if (k && t0 !== null) k.at = anchorAt(Math.max(startTime, Math.min(endTime, snap(t0 + delta, ev))), lines);
          }
          ctx.onPreview(false);
          const r = resolved(raw.id);
          if (r) { const a = Math.max(win.t0, r.start), b = Math.min(win.t1, r.end); clip.style.left = pct(a); clip.style.width = `calc(${pct(b)} - ${pct(a)})`; }
        };
        clip.onpointerup = () => {
          clip.onpointermove = null; clip.onpointerup = null;
          if (moved) ctx.onCommit(mode === 'kf' ? '移动关键帧' : mode === 'move' ? '移动图层' : '调整图层长度');
          else { if (kfId) { const k = raw.keyframes.find(item => item.id === kfId); const at = k ? lines.findIndex(l => l.lineId === k.at.lineId) : -1; if (at >= 0) { ctx.selectLine(at); return; } } ctx.onPreview(true); }
        };
      };
      lane.append(clip);
    }
    timeline.append(el('div', { className: 'layer-row' }, el('span', { className: 'layer-row-label', textContent: track.label }), lane));
  }
  if (playhead) timeline.querySelectorAll('.layer-lane').forEach(lane => lane.append(playhead.cloneNode()));

  // Properties
  const raw = layers.find(layer => layer.id === state.layerId);
  if (!raw) {
    panel.append(el('div', { className: 'muted', textContent: layers.length ? '点一个图层条来编辑。' : '还没有图层。点「+ 图片」或把图片拖到轨道上。' }));
    const lost = layers.filter(layer => !resolved(layer.id) && !layer.hidden);
    if (lost.length) panel.append(el('div', { className: 'muted warn-text', textContent: `${lost.length} 个图层绑定的句子已被删除，暂时不显示：${lost.map(l => l.name).join('、')}。选中后可以用「挪到当前句」救回来。` }));
    const list = el('div', { className: 'stack' });
    for (const layer of layers) list.append(Object.assign(el('button', { className: 'small layer-list-item', textContent: `${layer.name} · ${describeAnchor(layer.start, perf)}` }), { onclick: () => { state.layerId = layer.id; const at = lines.findIndex(l => l.lineId === layer.start.lineId); if (at >= 0) { state.windowShift = 0; ctx.selectLine(at); } else ctx.onPreview(true); } }));
    panel.append(list);
    return;
  }
  const key = raw.keyframes.find(k => k.id === state.keyframeId) ?? null;
  const r = resolved(raw.id);
  const keyTime = key ? anchorTime(key.at, lines) : null;
  const poseNow = r ? (key && keyTime !== null ? { ...layerPoseAt({ ...r, fadeIn: 0, fadeOut: 0 }, Math.min(r.end - 1e-4, keyTime)) } : raw.base) : raw.base;
  const target = key ?? raw.base;

  const name = el('input', { value: raw.name });
  name.onchange = () => { raw.name = name.value.trim() || raw.name; ctx.onCommit('重命名图层'); };
  panel.append(el('div', { className: 'row' }, name, Object.assign(el('button', { className: 'small', textContent: '×', title: '取消选择' }), { onclick: () => { state.layerId = null; state.keyframeId = null; ctx.onPreview(true); } })));
  panel.append(el('div', { className: 'muted', textContent: `${describeAnchor(raw.start, perf)} → ${describeAnchor(raw.end, perf, true)}` }));
  if (!r) panel.append(Object.assign(el('button', { className: 'small', textContent: '挪到当前句' }), { onclick: () => { const line = lines[ctx.selectedIndex]; if (!line) return; raw.start = { lineId: line.lineId, offset: 0 }; raw.end = { lineId: line.lineId, offset: null }; raw.keyframes = []; ctx.onCommit('图层挪到当前句'); } }));

  const select = (label, value, options, apply) => {
    const s = el('select');
    for (const [v, text] of options) s.append(el('option', { value: v, textContent: text, selected: v === value }));
    s.onchange = () => { apply(s.value); ctx.onCommit(`图层：${label}`); };
    return el('label', { className: 'muted' }, label, s);
  };
  panel.append(el('div', { className: 'grid2' },
    select('轨道', raw.track, LAYER_TRACKS.map(t => [t.key, t.label]), v => { raw.track = v; }),
    select('层级', raw.z, [['characters', '在角色之上'], ['top', '在对话框之上']], v => { raw.z = v; })));

  const slider = (label, obj, field, min, max, step, fallback, unit = '', scale = 1) => {
    const value = obj[field] ?? fallback;
    const out = el('output', { textContent: `${round(value * scale, 1)}${unit}` });
    const input = el('input', { type: 'range', min, max, step, value });
    input.oninput = () => { obj[field] = Number(input.value); out.textContent = `${round(Number(input.value) * scale, 1)}${unit}`; ctx.onPreview(false); };
    input.onchange = () => ctx.onCommit(`图层：${label}`);
    return el('label', { className: 'muted layer-slider' }, el('span', { textContent: label }), out, input);
  };
  panel.append(el('div', { className: 'layer-section-title', textContent: key ? `关键帧 · ${describeAnchor(key.at, perf)}` : '位置（图层开始时）' }));
  panel.append(el('div', { className: 'layer-grid' },
    slider('横向', target, 'x', -0.3, 1.3, 0.005, poseNow.x, '%', 100),
    slider('纵向', target, 'y', -0.3, 1.3, 0.005, poseNow.y, '%', 100),
    slider('大小', target, 'width', 0.03, 1.5, 0.005, poseNow.width, '%', 100),
    slider('透明', target, 'opacity', 0, 1, 0.01, poseNow.opacity, '%', 100),
    slider('旋转', target, 'rotation', -180, 180, 1, poseNow.rotation, '°')));
  if (key) {
    const curve = el('select');
    for (const preset of MOVE_CURVE_PRESETS) curve.append(el('option', { value: preset.key, textContent: `${preset.label} · ${preset.hint}`, selected: preset.key === key.curve }));
    if (!MOVE_CURVE_PRESETS.some(p => p.key === key.curve)) curve.append(el('option', { value: key.curve, textContent: '自定义曲线', selected: true }));
    curve.onchange = () => { key.curve = curve.value; ctx.onCommit('关键帧曲线'); };
    panel.append(el('label', { className: 'muted' }, '从上一个位置到这里的曲线', curve));
    panel.append(el('div', { className: 'row' },
      Object.assign(el('button', { className: 'small', textContent: '回到图层设置' }), { onclick: () => { state.keyframeId = null; ctx.onPreview(true); } }),
      Object.assign(el('button', { className: 'small danger', textContent: '删除这个关键帧' }), { onclick: () => { raw.keyframes = raw.keyframes.filter(k => k !== key); state.keyframeId = null; ctx.onCommit('删除关键帧'); } })));
  }
  const offset = el('input', { type: 'number', min: 0, step: 0.1, value: current && now !== undefined ? round(now - current.start) : 0, style: 'width:5em' });
  const addKey = el('button', { className: 'small', textContent: '◆ 在当前句加关键帧' });
  addKey.onclick = () => {
    const line = lines[ctx.selectedIndex]; if (!line || !r) return;
    const t = Math.min(r.end - 0.001, Math.max(r.start, line.start + Number(offset.value || 0)));
    if (t < r.start || t >= r.end) { ctx.setStatus('当前句不在这个图层的时间范围里，先选中图层覆盖的某一句。'); return; }
    const pose = layerPoseAt({ ...r, fadeIn: 0, fadeOut: 0 }, t) ?? raw.base;
    const k = { id: makeId('kf'), at: anchorAt(t, lines), curve: 'easeInOut', x: pose.x, y: pose.y, width: pose.width, opacity: pose.opacity, rotation: pose.rotation };
    raw.keyframes.push(k); state.keyframeId = k.id; ctx.onCommit('加关键帧');
  };
  panel.append(el('div', { className: 'row' }, addKey, el('span', { className: 'muted', textContent: '句内' }), offset, el('span', { className: 'muted', textContent: '秒' })));

  panel.append(el('div', { className: 'layer-section-title', textContent: '画中画框' }));
  const color = el('input', { type: 'color', value: raw.frame.borderColor });
  color.oninput = () => { raw.frame.borderColor = color.value; ctx.onPreview(false); };
  color.onchange = () => ctx.onCommit('图层：边框颜色');
  const shadow = el('input', { type: 'checkbox', checked: raw.frame.shadow });
  shadow.onchange = () => { raw.frame.shadow = shadow.checked; ctx.onCommit('图层：阴影'); };
  panel.append(el('div', { className: 'layer-grid' },
    slider('圆角', raw.frame, 'radius', 0, 80, 1, raw.frame.radius),
    slider('边框', raw.frame, 'borderWidth', 0, 20, 0.5, raw.frame.borderWidth),
    slider('淡入', raw, 'fadeIn', 0, 3, 0.05, raw.fadeIn, 's'),
    slider('淡出', raw, 'fadeOut', 0, 3, 0.05, raw.fadeOut, 's')));
  panel.append(el('div', { className: 'row' }, el('label', { className: 'muted row' }, '边框色', color), el('label', { className: 'muted row' }, shadow, '阴影'),
    select('形状', raw.frame.mask, [['rect', '圆角矩形'], ['circle', '圆形']], v => { raw.frame.mask = v; })));
  const replace = el('input', { type: 'file', accept: 'image/*', hidden: true });
  replace.onchange = async () => { const file = replace.files?.[0]; if (!file) return; const [id] = await ctx.importFiles([file]); if (id) { raw.assetId = id; ctx.onCommit('替换图层图片'); } };
  panel.append(el('div', { className: 'row' },
    Object.assign(el('button', { className: 'small', textContent: '换图片' }), { onclick: () => replace.click() }), replace,
    Object.assign(el('button', { className: 'small', textContent: raw.hidden ? '显示' : '隐藏' }), { onclick: () => { raw.hidden = !raw.hidden; ctx.onCommit(raw.hidden ? '隐藏图层' : '显示图层'); } }),
    Object.assign(el('button', { className: 'small', textContent: '复制' }), { onclick: () => { const copy = structuredClone(raw); copy.id = makeId('layer'); copy.name += ' 副本'; copy.keyframes = copy.keyframes.map(k => ({ ...k, id: makeId('kf') })); layers.push(copy); state.layerId = copy.id; ctx.onCommit('复制图层'); } }),
    Object.assign(el('button', { className: 'small danger', textContent: '删除图层' }), { onclick: () => { const at = layers.indexOf(raw); if (at >= 0) layers.splice(at, 1); state.layerId = null; state.keyframeId = null; ctx.onCommit('删除图层'); } })));
}

export function selectedLayerId() { return state.layerId; }
export function selectLayer(id) { state.layerId = id; state.keyframeId = null; }

/**
 * Dashed box over the preview for the selected layer: drag inside to move, drag the corner to scale.
 * With keyframes, dragging records the pose at the current moment (a new keyframe unless one is selected there).
 * @param overlay absolutely positioned element covering the stage canvas
 * @param ctx { project, getPerf(), time, imageAspect(assetId) → number|null, onPreview(), onCommit(label), visible }
 */
export function updateLayerStageOverlay(overlay, ctx) {
  if (!overlay) return;
  overlay.replaceChildren();
  const raw = ctx.project?.layers?.find(layer => layer.id === state.layerId);
  const perf = ctx.getPerf();
  const resolvedLayer = raw && perf?.layers?.find(layer => layer.id === raw.id);
  if (!ctx.visible || !raw || !resolvedLayer) { overlay.hidden = true; return; }
  const pose = layerPoseAt({ ...resolvedLayer, fadeIn: 0, fadeOut: 0 }, Math.min(resolvedLayer.end - 1e-4, Math.max(resolvedLayer.start, ctx.time)));
  if (!pose) { overlay.hidden = true; return; }
  overlay.hidden = false;
  const aspect = ctx.imageAspect(raw.assetId) ?? 1;
  const stageAspect = 16 / 9;
  const box = el('div', { className: 'layer-stage-box', title: '拖动移动 · 拖右下角缩放' });
  const place = p => { const h = p.width * stageAspect / aspect; Object.assign(box.style, { left: `${(p.x - p.width / 2) * 100}%`, top: `${(p.y - h / 2) * 100}%`, width: `${p.width * 100}%`, height: `${h * 100}%`, transform: p.rotation ? `rotate(${p.rotation}deg)` : '' }); };
  place(pose);
  const corner = el('span', { className: 'layer-stage-corner' });
  box.append(corner);
  overlay.append(box);
  box.onpointerdown = event => {
    event.preventDefault(); event.stopPropagation();
    const lines = perf.lines;
    let target = raw.base;
    if (raw.keyframes.length) {
      const selected = raw.keyframes.find(k => k.id === state.keyframeId);
      const selectedTime = selected ? anchorTime(selected.at, lines) : null;
      if (selected && selectedTime !== null && Math.abs(selectedTime - ctx.time) < 0.05) target = selected;
      else {
        const k = { id: makeId('kf'), at: anchorAt(ctx.time, lines), curve: 'easeInOut', x: pose.x, y: pose.y, width: pose.width, opacity: pose.opacity, rotation: pose.rotation };
        raw.keyframes.push(k); state.keyframeId = k.id; target = k;
      }
    }
    const start = { x: target.x ?? pose.x, y: target.y ?? pose.y, width: target.width ?? pose.width };
    const rect = overlay.getBoundingClientRect();
    const scaling = event.target === corner;
    const cx = rect.left + start.x * rect.width, cy = rect.top + start.y * rect.height;
    const startDistance = Math.hypot(event.clientX - cx, event.clientY - cy) || 1;
    const ox = event.clientX, oy = event.clientY;
    try { box.setPointerCapture(event.pointerId); } catch {}
    box.onpointermove = ev => {
      if (scaling) target.width = Math.max(0.03, Math.min(3, start.width * Math.hypot(ev.clientX - cx, ev.clientY - cy) / startDistance));
      else { target.x = start.x + (ev.clientX - ox) / rect.width; target.y = start.y + (ev.clientY - oy) / rect.height; }
      place({ ...pose, x: target.x ?? pose.x, y: target.y ?? pose.y, width: target.width ?? pose.width });
      ctx.onPreview();
    };
    box.onpointerup = () => { box.onpointermove = null; box.onpointerup = null; ctx.onCommit(scaling ? '缩放图层' : '移动图层'); };
  };
}
