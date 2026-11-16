/**
 * 「对话框」 card: sliders for the textbox layout. Values live in assets/system/对话框.json, so
 * people who prefer files can edit that instead, and the card shows what the files say.
 */
import { DIALOGUE_LAYOUT_FIELDS, DEFAULT_DIALOGUE_LAYOUT, DIALOGUE_SKIN_FOLDER, formatDialogueLayout, resolveDialogueLayout } from '../dist/index.js';

const MAIN = ['marginX', 'bottom', 'height', 'opacity', 'fontSize', 'lineHeight', 'textColor', 'fontFamily', 'showName', 'nameFontSize', 'nameColor', 'nameTint', 'progress', 'boxColor', 'boxAlpha'];

const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };

/**
 * @param host element to fill
 * @param ctx { project, workspace, onPreview(), onCommit(label) }
 */
export function renderDialogueSkinCard(host, { project, workspace, onPreview, onCommit, setStatus = () => {} }) {
  if (!host || !project) return;
  const open = host.querySelector('details')?.open ?? false;
  host.replaceChildren();
  const skin = project.settings.dialogueSkin ?? null;
  const layout = resolveDialogueLayout(skin);
  const nameOf = id => id ? (project.assets.find(a => a.id === id)?.sourcePath?.split('/').pop() ?? '缺失') : null;
  const files = [['对话框图', nameOf(skin?.box)], ['名字框图', nameOf(skin?.name)], ['RPG Maker 窗口', nameOf(skin?.window)]].filter(([, n]) => n);
  const details = el('details', { open });
  details.append(el('summary', { textContent: '对话框样式 ' }, el('span', { className: 'summary-meta', textContent: files.length ? files.map(([, n]) => n).join(' · ') : Object.keys(skin?.layout ?? {}).length ? '已调整' : '默认' })));
  const body = el('div', { className: 'stack disclosure-body dialogue-skin-body' });
  body.append(el('div', { className: 'muted', textContent: `换样式：把图片放进工程的 ${DIALOGUE_SKIN_FOLDER}/ 文件夹——对话框.png（九宫格拉伸）、名字框.png（白色会染成角色代表色）或 RPG Maker 的 Window.png。替换文件后切回 Replay Lab 就会更新。下面的数值存在 对话框.json，也可以直接改那个文件。` }));
  if (!workspace) body.append(el('div', { className: 'muted', textContent: '没连接工程文件夹时，调整只存在工程里，不会写出 对话框.json。' }));

  const draft = { ...(skin?.layout ?? {}) };
  const apply = () => {
    const clean = Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== DEFAULT_DIALOGUE_LAYOUT[key]));
    const base = project.settings.dialogueSkin ?? { box: null, name: null, window: null };
    const next = { ...base, layout: clean };
    project.settings.dialogueSkin = next.box || next.name || next.window || Object.keys(clean).length ? next : null;
    return clean;
  };
  const commit = async label => {
    const clean = apply();
    if (workspace) {
      try { await workspace.write(`${DIALOGUE_SKIN_FOLDER}/对话框.json`, new Blob([formatDialogueLayout(clean)], { type: 'application/json' }), 'application/json'); }
      catch (error) { setStatus(`写入 对话框.json 失败：${error.message || error}`); }
    }
    onCommit(label);
  };

  const control = field => {
    const value = layout[field.key], fallback = DEFAULT_DIALOGUE_LAYOUT[field.key];
    const label = el('label', { className: 'muted', title: field.hint ?? '' });
    let input;
    if (typeof fallback === 'boolean') {
      input = el('input', { type: 'checkbox', checked: !!value });
      input.onchange = () => { draft[field.key] = input.checked; void commit(`对话框：${field.label}`); };
      label.className = 'muted checkrow'; label.append(input, el('span', { textContent: field.label }));
      return label;
    }
    if (typeof fallback === 'number') {
      const out = el('output', { textContent: String(value) });
      input = el('input', { type: 'range', min: field.min ?? 0, max: field.max ?? 100, step: field.step ?? 1, value });
      input.oninput = () => { draft[field.key] = Number(input.value); out.textContent = input.value; apply(); onPreview(); };
      input.onchange = () => void commit(`对话框：${field.label}`);
      label.append(`${field.label} `, out, input);
      return label;
    }
    if (field.key.endsWith('Color')) {
      input = el('input', { type: 'color', value });
      input.oninput = () => { draft[field.key] = input.value; apply(); onPreview(); };
      input.onchange = () => void commit(`对话框：${field.label}`);
    } else {
      input = el('input', { value, placeholder: '默认字体' });
      input.onchange = () => { draft[field.key] = input.value.trim(); void commit(`对话框：${field.label}`); };
    }
    label.append(field.label, input);
    return label;
  };

  const grid = el('div', { className: 'dialogue-skin-grid' });
  const more = el('div', { className: 'dialogue-skin-grid' });
  for (const field of DIALOGUE_LAYOUT_FIELDS) (MAIN.includes(field.key) ? grid : more).append(control(field));
  const moreBox = el('details', {}, el('summary', { textContent: '更多：名字框位置、留白、描边、九宫格' }), more);
  const reset = el('button', { className: 'small', textContent: '恢复默认数值' });
  reset.onclick = () => { for (const key of Object.keys(draft)) delete draft[key]; void commit('对话框：恢复默认数值'); };
  body.append(grid, moreBox, el('div', { className: 'row' }, reset));
  details.append(body);
  host.append(details);
}
