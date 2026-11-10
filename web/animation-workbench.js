/**
 * 施工台 → 动画: everything that stages the current line in one place. Lists the director
 * commands just before it (editable), effects still running from earlier lines, and buttons
 * that insert new effects right before this line so they land on it.
 */
const KIND_LABEL = { shake: '震动', flash: '闪屏', emote: '漫符', transition: '转场', filter: '滤镜', card: '章节卡', wait: '停顿', expression: '表情', motion: '动作', enter: '上场', dismiss: '退场', move: '移动', background: '背景', cg: 'CG', bgm: 'BGM', ambient: '环境声', sfx: '音效', camera: '镜头', scene: 'Scene', chapter: '章节', object: '对象' };
const EMOTES = ['怒', '汗', '惊', '问', '惊问', '省略', '心', '音符', '闪', '黑线', '冒气', '灵光'];
const EMOTE_VALUE = { 怒: 'anger', 汗: 'sweat', 惊: 'surprise', 问: 'question', 惊问: 'surprise-question', 省略: 'dots', 心: 'heart', 音符: 'note', 闪: 'sparkle', 黑线: 'gloom', 冒气: 'steam', 灵光: 'idea' };
const TRANSITIONS = [['dissolve', '溶解'], ['fade', '黑场淡入'], ['wipe-left', '向左擦除'], ['wipe-right', '向右擦除'], ['wipe-up', '向上擦除'], ['wipe-down', '向下擦除'], ['iris-in', '圆形展开'], ['iris-out', '圆形收缩'], ['blinds', '百叶窗'], ['noise', '碎点溶解'], ['cut', '直接切换']];
const FILTERS = [['回忆', '回忆（泛黄）'], ['夜晚', '夜晚'], ['黄昏', '黄昏'], ['黑白', '黑白'], ['梦境', '梦境'], ['暗角', '暗角'], ['危险', '危险（红色脉动）'], ['无', '关闭滤镜']];
const FILTER_VALUE = { 回忆: 'memory', 夜晚: 'night', 黄昏: 'dusk', 黑白: 'mono', 梦境: 'dream', 暗角: 'vignette', 危险: 'danger', 无: 'none' };
const quote = value => /\s/.test(String(value)) ? `"${String(value).replace(/"/g, '\\"')}"` : String(value);

export function renderAnimationWorkbench(host, ctx) {
  const { project, line, index, perf, performance } = ctx;
  host.replaceChildren();
  const el = (tag, props = {}, ...children) => { const node = Object.assign(document.createElement(tag), props); node.append(...children); return node; };
  if (!project || !line) { host.append(el('div', { className: 'muted', textContent: '先在左侧选一句台词。' })); return; }
  // Commands directly before a visible line stage it; a selected command edits its own block.
  let target = index;
  if (line.type === 'command') { target = index; while (target < project.lines.length && project.lines[target].type === 'command') target++; }
  let first = target;
  while (first > 0 && project.lines[first - 1].type === 'command') first--;
  const targetLine = project.lines[target];
  const characterName = id => project.characters.find(c => c.id === id)?.name ?? '';

  const head = el('div', { className: 'row' }, el('strong', { textContent: targetLine ? `第 ${target + 1} 句的演出` : '末尾的指令' }),
    el('span', { className: 'muted', textContent: targetLine ? ` ${characterName(targetLine.speakerId)}：${String(targetLine.text).slice(0, 24)}` : '' }));
  const preview = el('button', { className: 'small', textContent: '▶ 试看这一句' });
  preview.dataset.animPreview = '1';
  preview.onclick = () => ctx.preview(target);
  head.append(preview);
  host.append(head);

  // ---- add buttons
  const adders = el('div', { className: 'row' });
  adders.style.flexWrap = 'wrap';
  const onStage = (perf?.stage ?? []).map(actor => actor.characterId);
  const someone = characterName(targetLine?.speakerId) || characterName(onStage[0]) || project.characters[0]?.name || '角色';
  const templates = [['震动', `/shake 中 1.5 随机`], ['闪屏', '/flash white 0.3'], ['漫符', `/emote ${quote(someone)} 怒 1.6`], ['转场', '/transition 溶解'], ['滤镜', '/filter 回忆'], ['章节卡', '/card 第一话 "副标题" 2.6'], ['停顿', '/wait 0.5'], ['表情', `/expression ${quote(someone)} default`]];
  adders.append(el('span', { className: 'muted', textContent: '加到这句前：' }));
  for (const [label, text] of templates) { const b = el('button', { className: 'small', textContent: label }); b.dataset.animAdd = label; b.onclick = () => ctx.insertAt(first + (target - first), text); adders.append(b); }
  const sound = el('button', { className: 'small', textContent: '声音…' }); sound.onclick = () => ctx.openSound(target); adders.append(sound);
  host.append(adders);

  // ---- commands in front of this line
  const list = el('div', { className: 'stack' });
  const commands = project.lines.slice(first, target).map((item, offset) => ({ item, at: first + offset }));
  if (!commands.length) list.append(el('div', { className: 'muted', textContent: '这句前面还没有导演指令。用上面的按钮加一个，它会正好落在这一句上。' }));
  for (const { item, at } of commands) list.append(commandRow(item, at));
  host.append(list);

  // ---- effects carried in from earlier
  const carried = [];
  const lineStart = perf?.start ?? 0;
  for (const shake of perf?.shakes ?? []) if (shake.offset < -0.05) carried.push([`震动（之前开始，还剩 ${Math.max(0, shake.duration + shake.offset).toFixed(1)} 秒）`, lineStart + shake.offset]);
  for (const emote of perf?.emotes ?? []) if (emote.offset < -0.05) carried.push([`漫符 · ${characterName(emote.characterId)}（之前开始）`, lineStart + emote.offset]);
  if (perf?.screenFilter) carried.push([`滤镜：${Object.keys(FILTER_VALUE).find(k => FILTER_VALUE[k] === perf.screenFilter) ?? perf.screenFilter}（一直持续到 /filter 无）`, null, 'filter']);
  if (carried.length) {
    host.append(el('strong', { textContent: '从前面延续过来的效果' }));
    for (const [text, at, kind] of carried) {
      const row = el('div', { className: 'row' }, el('span', { className: 'muted', textContent: text }));
      const jump = el('button', { className: 'small', textContent: '跳到那条指令' });
      jump.onclick = () => ctx.jumpToSource(kind === 'filter' ? lastFilterBefore(project, first) : lineAtTime(performance, project, at));
      row.append(jump); host.append(row);
    }
  }

  function commandRow(item, at) {
    const command = item.command;
    const row = el('div', { className: 'card stack' });
    row.dataset.animCommand = String(at);
    row.style.cssText = 'padding:8px;gap:6px';
    const top = el('div', { className: 'row' }, el('strong', { textContent: KIND_LABEL[command?.kind] ?? '指令' }), el('code', { textContent: item.text }));
    top.style.flexWrap = 'wrap';
    const up = el('button', { className: 'small', textContent: '↑', title: '往前挪' }), down = el('button', { className: 'small', textContent: '↓', title: '往后挪' }), remove = el('button', { className: 'small', textContent: '删除' });
    up.disabled = at === 0; up.onclick = () => ctx.move(at, -1);
    down.onclick = () => ctx.move(at, 1);
    remove.onclick = () => ctx.remove(at);
    top.append(up, down, remove);
    row.append(top);
    const fields = el('div', { className: 'row' }); fields.style.flexWrap = 'wrap';
    const set = text => ctx.setText(at, text);
    const num = (label, value, step, commit, attr) => { const input = el('input', { type: 'number', value: String(value), step: String(step), min: '0' }); input.style.width = '5em'; if (attr) input.dataset[attr] = '1'; input.onchange = () => commit(Number(input.value)); return el('label', { className: 'muted', textContent: `${label} ` }, input); };
    const pick = (label, options, value, commit, attr) => { const select = el('select'); for (const [v, t] of options) select.append(el('option', { value: v, textContent: t })); select.value = value; if (attr) select.dataset[attr] = '1'; select.onchange = () => commit(select.value); return el('label', { className: 'muted', textContent: `${label} ` }, select); };
    const kind = command?.kind;
    if (kind === 'shake') {
      const [pattern = 'random', amplitude = '12', frequency = '14'] = String(command.value ?? '').split(' ');
      const seconds = Number(command.duration) || 1;
      const build = (a, s, p, f) => set(`/shake ${a} ${s} ${p === 'fixed' ? '固定' : '随机'} ${f}`);
      fields.append(
        pick('强度', [['5', '轻'], ['12', '中'], ['24', '强'], ...(['5', '12', '24'].includes(amplitude) ? [] : [[amplitude, `${amplitude} 像素`]])], amplitude, v => build(v, seconds, pattern, frequency), 'animShakeAmp'),
        num('秒数', seconds, 0.1, v => build(amplitude, v, pattern, frequency), 'animShakeSeconds'),
        pick('节奏', [['random', '随机'], ['fixed', '固定']], pattern, v => build(amplitude, seconds, v, frequency)),
        num('频率', frequency, 1, v => build(amplitude, seconds, pattern, v)));
    } else if (kind === 'flash') {
      const color = command.value ?? '#000000', seconds = Number(command.duration) || 0.5;
      fields.append(pick('颜色', [['#000000', '黑'], ['#ffffff', '白'], ['#b3121d', '红'], ...(['#000000', '#ffffff', '#b3121d'].includes(color) ? [] : [[color, color]])], color, v => set(`/flash ${v} ${seconds}`)),
        num('秒数', seconds, 0.1, v => set(`/flash ${color} ${v}`)));
    } else if (kind === 'emote') {
      const who = characterName(command.characterId) || command.target || '';
      const mark = Object.keys(EMOTE_VALUE).find(k => EMOTE_VALUE[k] === command.value) ?? '怒';
      const seconds = Number(command.duration) || 1.6;
      const people = [...new Set([...onStage, command.characterId].filter(Boolean))].map(id => [characterName(id), characterName(id)]);
      fields.append(pick('谁', people.length ? people : [[who, who]], who, v => set(`/emote ${quote(v)} ${mark} ${seconds}`), 'animEmoteWho'),
        pick('漫符', EMOTES.map(e => [e, e]), mark, v => set(`/emote ${quote(who)} ${v} ${seconds}`), 'animEmoteMark'),
        num('秒数', seconds, 0.1, v => set(`/emote ${quote(who)} ${mark} ${v}`)));
    } else if (kind === 'transition') {
      const value = command.value ?? 'cut', seconds = Number(command.duration) || '';
      fields.append(pick('方式', TRANSITIONS, value, v => set(`/transition ${v}${seconds ? ` ${seconds}` : ''}`), 'animTransition'),
        num('秒数', seconds || 0.7, 0.1, v => set(`/transition ${value} ${v}`)));
    } else if (kind === 'filter') {
      const word = Object.keys(FILTER_VALUE).find(k => FILTER_VALUE[k] === command.value) ?? '无';
      fields.append(pick('滤镜', FILTERS, word, v => set(`/filter ${v}`), 'animFilter'));
    } else if (kind === 'card') {
      const title = el('input', { value: command.value ?? '' }), subtitle = el('input', { value: command.target ?? '', placeholder: '副标题' });
      const seconds = Number(command.duration) || 2.6;
      const build = () => set(`/card ${quote(title.value || '标题')}${subtitle.value ? ` ${quote(subtitle.value)}` : ''} ${seconds}`);
      title.onchange = build; subtitle.onchange = build;
      fields.append(el('label', { className: 'muted', textContent: '标题 ' }, title), el('label', { className: 'muted', textContent: '副标题 ' }, subtitle),
        num('秒数', seconds, 0.1, v => set(`/card ${quote(title.value || '标题')}${subtitle.value ? ` ${quote(subtitle.value)}` : ''} ${v}`)));
    } else if (kind === 'wait') {
      fields.append(num('停顿秒数', Number(command.duration) || 0, 0.1, v => set(`/wait ${v}`)));
    } else {
      const raw = el('input', { value: item.text }); raw.style.flex = '1'; raw.onchange = () => set(raw.value);
      fields.append(raw);
    }
    if (fields.children.length) row.append(fields);
    if (!command) row.append(el('small', { className: 'status error', textContent: '这条指令没能解析，检查一下写法。' }));
    return row;
  }
}

function lastFilterBefore(project, index) {
  for (let i = index - 1; i >= 0; i--) if (project.lines[i].type === 'command' && project.lines[i].command?.kind === 'filter') return i;
  return -1;
}
function lineAtTime(performance, project, time) {
  if (!performance || time == null) return -1;
  const hit = performance.lines.findIndex(item => item.type === 'command' && Math.abs(item.start - time) < 0.02);
  return hit;
}
