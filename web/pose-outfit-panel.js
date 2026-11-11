// Character card section: body art keyed outfit × pose, independent of expressions.
// Expressions keep changing only the face; a body replaces the expression's 底图.
import { readPsdBodyPlan, describePlan, applyPsdBodyPlan } from './psd-body-import.js';
import { bodyKey, splitBodyKey, characterOutfits, characterPoses, resolveBody, selectCharacterLayers, paintBodyLayers } from '../dist/index.js';

const BLENDS = [['normal', '正常'], ['multiply', '正片叠底（阴影）'], ['screen', '滤色（高光）'], ['overlay', '叠加'], ['clip', '剪切到下层']];

async function loadImage(resolveAsset, ref, cache) {
  if (!ref) return null;
  if (cache.has(ref)) return cache.get(ref);
  const promise = (async () => {
    let source = await resolveAsset(ref);
    if (!source) return null;
    if (source instanceof Uint8Array || source instanceof ArrayBuffer) source = new Blob([source]);
    const url = typeof source === 'string' ? source : URL.createObjectURL(source);
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    return image;
  })().catch(() => null);
  cache.set(ref, promise);
  return promise;
}

/** Draws back body layers, the expression's face layers, then front body layers — the renderer's order, without face-fit templates or puppet deforms. */
export async function drawPosePreview(canvas, character, { outfit, pose, expression }, resolveAsset, cache = new Map()) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const body = resolveBody(character, outfit, pose);
  if (!body) return null;
  const load = layers => Promise.all(layers.map(layer => loadImage(resolveAsset, layer.asset, cache)));
  const backImages = await load(body.back);
  const first = backImages.find(Boolean);
  if (!first) return body;
  const w = first.naturalWidth, h = first.naturalHeight;
  const work = document.createElement('canvas'); work.width = w; work.height = h;
  const wctx = work.getContext('2d');
  const scratch = document.createElement('canvas'); scratch.width = w; scratch.height = h;
  paintBodyLayers(wctx, scratch.getContext('2d'), body.back, backImages, w, h);
  const face = selectCharacterLayers(character, expression || 'default', 'SILENCE', false);
  for (const ref of [face.eyes, face.pupils, face.eyelids, face.brows, face.mouth, face.overlay]) {
    const image = await loadImage(resolveAsset, ref, cache);
    if (image) wctx.drawImage(image, 0, 0, w, h);
  }
  if (body.front.length) {
    const front = document.createElement('canvas'); front.width = w; front.height = h;
    paintBodyLayers(front.getContext('2d'), scratch.getContext('2d'), body.front, await load(body.front), w, h);
    wctx.drawImage(front, 0, 0);
  }
  const scale = Math.min(canvas.width / w, canvas.height / h);
  ctx.drawImage(work, (canvas.width - w * scale) / 2, canvas.height - h * scale, w * scale, h * scale);
  return body;
}

function uniqueKey(bodies, outfit, pose) {
  let p = pose, i = 1;
  while (bodies[bodyKey(outfit, p)]) p = `${pose}${++i}`;
  return bodyKey(outfit, p);
}

export function mountPoseOutfitPanel(host, ctx) {
  const { character, escapeHtml, imageAssetOptions, expressionNames, resolveAsset, scheduleSave, rerender } = ctx;
  if (!host) return;
  const bodies = character.bodies ?? {};
  const keys = Object.keys(bodies);
  const outfits = characterOutfits(character), poses = characterPoses(character);
  const save = (label, rerenderAll = true) => { if (!Object.keys(character.bodies ?? {}).length) delete character.bodies; scheduleSave(label, `${character.id}:bodies`); if (rerenderAll) rerender(); };
  const option = (value, current, label = value) => `<option value="${escapeHtml(value)}" ${value === current ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  const preview = ctx.previewState ?? (ctx.previewState = {});
  preview.outfit ??= outfits[0] ?? ''; preview.pose ??= poses[0] ?? ''; preview.expression ??= 'default';

  host.innerHTML = `
    <div class="muted">姿势和服装与表情分开：表情只换脸，身体按「服装/姿势」取图。缺的组合会退回这件衣服的默认姿势。用指令 <code>/pose 角色 抱臂</code>、<code>/outfit 角色 衬衫</code> 切换，一直保持到下次切换。</div>
    ${keys.length ? `<div class="grid2"><label class="muted">默认服装<select data-body-default-outfit>${outfits.map(o => option(o, character.defaultOutfit || outfits[0])).join('')}</select></label><label class="muted">默认姿势<select data-body-default-pose>${poses.map(p => option(p, character.defaultPose || characterPoses(character, character.defaultOutfit || outfits[0])[0])).join('')}</select></label></div>` : ''}
    <div data-body-list class="stack"></div>
    <div class="row"><button type="button" class="small" data-body-add>+ 服装/姿势组合</button>${ctx.addImageAsset ? `<button type="button" class="small" data-body-import-psd title="按图层/组名自动拆：服装_外套、手_抱臂、手_托腮_前（画在脸前）、阴影（正片叠底）">从 PSD 导入…</button><input type="file" accept=".psd,.procreate" data-body-psd-file hidden>` : ''}<span class="muted" data-body-import-status></span></div>
    ${poses.length ? `<details><summary>台词自动换姿势 <span class="summary-meta">可选</span></summary><div class="stack disclosure-body" data-pose-triggers><small class="muted">台词的语气或情绪标记里出现这些词时，这一句自动换成对应姿势（只影响这一句，空格分隔）</small>${poses.map(p => `<label class="muted">${escapeHtml(p)} ← <input data-pose-trigger="${escapeHtml(p)}" placeholder="例如：讲解 思考" value="${escapeHtml((character.poseTriggers?.[p] || []).join(' '))}"></label>`).join('')}</div></details>` : ''}
    ${keys.length ? `<div class="card stack"><div class="row"><strong>组合预览</strong><span class="muted" data-body-preview-note></span></div><div class="grid3"><label class="muted">服装<select data-preview-outfit>${outfits.map(o => option(o, preview.outfit)).join('')}</select></label><label class="muted">姿势<select data-preview-pose>${poses.map(p => option(p, preview.pose)).join('')}</select></label><label class="muted">表情<select data-preview-expression>${expressionNames.map(e => option(e, preview.expression)).join('')}</select></label></div><canvas data-body-preview width="240" height="280" style="background:repeating-conic-gradient(#0002 0 25%,#0000 0 50%) 0 0/16px 16px;border-radius:8px;align-self:center"></canvas><small class="muted">预览不含五官贴合模板和参数形变；舞台上会用完整效果。</small></div>` : ''}`;

  const list = host.querySelector('[data-body-list]');
  for (const key of keys) {
    const art = bodies[key];
    const { outfit, pose } = splitBodyKey(key);
    const row = document.createElement('div');
    row.className = 'card stack';
    row.innerHTML = `<div class="row" style="gap:6px"><label class="muted" style="flex:1">服装<input data-body-outfit value="${escapeHtml(outfit)}"></label><label class="muted" style="flex:1">姿势<input data-body-pose value="${escapeHtml(pose)}"></label><button type="button" class="small danger" data-body-remove title="删除这个组合">×</button></div>
      <div class="stack" data-body-layers>${(art.layers || []).map((layer, index) => `<div class="row" style="gap:4px;flex-wrap:wrap" data-layer-index="${index}"><select data-layer-asset style="flex:2">${imageAssetOptions(layer.asset)}</select><select data-layer-blend title="混合方式">${BLENDS.map(([v, l]) => option(v, layer.blend || 'normal', l)).join('')}</select><input data-layer-opacity type="number" min="0" max="1" step="0.05" value="${layer.opacity ?? 1}" style="width:4.5em" title="不透明度"><label class="muted" title="画在脸的前面，例如托腮的手"><input type="checkbox" data-layer-front ${layer.front ? 'checked' : ''}> 在脸前面</label><button type="button" class="small" data-layer-up ${index ? '' : 'disabled'} title="往下移一层">↑</button><button type="button" class="small danger" data-layer-remove>×</button></div>`).join('')}</div>
      <div class="row"><button type="button" class="small" data-layer-add>+ 图层</button><span class="muted">从下往上画；所有图层要和底图一样大、对齐。</span></div>`;
    const rename = () => {
      const nextOutfit = row.querySelector('[data-body-outfit]').value.trim().replace(/\//g, '／');
      const nextPose = row.querySelector('[data-body-pose]').value.trim().replace(/\//g, '／');
      const next = bodyKey(nextOutfit, nextPose);
      if (!nextOutfit || !nextPose || (next !== key && bodies[next])) { rerender(); return; }
      if (next === key) return;
      const ordered = {};
      for (const k of Object.keys(bodies)) ordered[k === key ? next : k] = bodies[k];
      character.bodies = ordered;
      if (character.defaultOutfit === outfit && !Object.keys(ordered).some(k => splitBodyKey(k).outfit === outfit)) character.defaultOutfit = nextOutfit;
      save('重命名服装/姿势');
    };
    row.querySelector('[data-body-outfit]').onchange = rename;
    row.querySelector('[data-body-pose]').onchange = rename;
    row.querySelector('[data-body-remove]').onclick = () => { delete bodies[key]; save('删除服装/姿势'); };
    row.querySelector('[data-layer-add]').onclick = () => { (art.layers ??= []).push({ asset: '' }); save('新增身体图层'); };
    for (const item of row.querySelectorAll('[data-layer-index]')) {
      const index = Number(item.dataset.layerIndex), layer = art.layers[index];
      item.querySelector('[data-layer-asset]').onchange = e => { layer.asset = e.target.value; ctx.invalidate?.(); save('修改身体图层'); };
      item.querySelector('[data-layer-blend]').onchange = e => { if (e.target.value === 'normal') delete layer.blend; else layer.blend = e.target.value; save('修改图层混合方式'); };
      item.querySelector('[data-layer-opacity]').onchange = e => { const v = Math.max(0, Math.min(1, Number(e.target.value))); if (!Number.isFinite(v) || v >= 1) delete layer.opacity; else layer.opacity = v; save('修改图层不透明度'); };
      item.querySelector('[data-layer-front]').onchange = e => { if (e.target.checked) layer.front = true; else delete layer.front; save('修改图层前后'); };
      item.querySelector('[data-layer-up]').onclick = () => { if (index) { [art.layers[index - 1], art.layers[index]] = [art.layers[index], art.layers[index - 1]]; save('调整图层顺序'); } };
      item.querySelector('[data-layer-remove]').onclick = () => { art.layers.splice(index, 1); save('删除身体图层'); };
    }
    list.append(row);
  }

  host.querySelector('[data-body-add]').onclick = () => {
    character.bodies ??= {};
    const outfit = outfits[0] || '默认', pose = outfits.length ? '新姿势' : '默认';
    character.bodies[uniqueKey(character.bodies, outfit, pose)] = { layers: [{ asset: character.layers?.base || '' }] };
    save('新增服装/姿势');
  };
  const psdButton = host.querySelector('[data-body-import-psd]'), psdInput = host.querySelector('[data-body-psd-file]'), psdStatus = host.querySelector('[data-body-import-status]');
  if (psdButton && psdInput) {
    psdButton.onclick = () => psdInput.click();
    psdInput.onchange = async () => {
      const file = psdInput.files?.[0]; psdInput.value = '';
      if (!file) return;
      try {
        psdStatus.textContent = '正在读取 PSD…';
        const result = await readPsdBodyPlan(file);
        if (!result.plan.slices.length) { psdStatus.textContent = '这个 PSD 里没有可用的身体图层。'; return; }
        const summary = describePlan(result.plan);
        if (!(ctx.confirm ?? window.confirm)(`从「${file.name}」导入${character.name}的姿势 / 服装：\n\n${summary.join('\n')}\n\n同名组合会被替换。继续吗？`)) { psdStatus.textContent = ''; return; }
        const keys = await applyPsdBodyPlan(result, character, ctx.addImageAsset, (i, n) => { psdStatus.textContent = `正在写入图层 ${i + 1} / ${n}…`; });
        preview.outfit = result.plan.outfits[0]; preview.pose = result.plan.poses[result.plan.outfits[0]][0];
        save(`从 PSD 导入 ${keys.length} 个姿势 / 服装`);
      } catch (error) {
        psdStatus.textContent = `导入失败：${error?.message || error}`;
      }
    };
  }
  const defOutfit = host.querySelector('[data-body-default-outfit]');
  if (defOutfit) defOutfit.onchange = e => { character.defaultOutfit = e.target.value; save('修改默认服装'); };
  const defPose = host.querySelector('[data-body-default-pose]');
  if (defPose) defPose.onchange = e => { character.defaultPose = e.target.value; save('修改默认姿势'); };
  for (const input of host.querySelectorAll('[data-pose-trigger]')) input.onchange = () => {
    const words = input.value.split(/[\s,，、]+/).filter(Boolean);
    character.poseTriggers = { ...(character.poseTriggers || {}) };
    if (words.length) character.poseTriggers[input.dataset.poseTrigger] = words; else delete character.poseTriggers[input.dataset.poseTrigger];
    if (!Object.keys(character.poseTriggers).length) delete character.poseTriggers;
    save('修改台词自动换姿势');
  };

  const canvas = host.querySelector('[data-body-preview]');
  if (canvas) {
    const cache = ctx.imageCache ?? (ctx.imageCache = new Map());
    const draw = async () => {
      const body = await drawPosePreview(canvas, character, preview, resolveAsset, cache);
      const note = host.querySelector('[data-body-preview-note]');
      if (note) note.textContent = !body ? '还没有可用的身体图' : body.fallback ? `没有「${preview.outfit}/${preview.pose}」，用的是 ${body.key}` : body.key;
    };
    for (const [selector, field] of [['[data-preview-outfit]', 'outfit'], ['[data-preview-pose]', 'pose'], ['[data-preview-expression]', 'expression']]) {
      host.querySelector(selector).onchange = e => { preview[field] = e.target.value; void draw(); };
    }
    void draw();
  }
}
