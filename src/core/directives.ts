import { pluginCommand, pluginFilter, pluginTransition } from '../plugins/stage-plugins.js';
import type { DirectorCommandKind, ReplayDirectorCommand, ReplayLine, ReplayProject, StagePosition } from './types.js';
import { resolveCharacterName } from './character-name.js';

export interface DirectorCommandParseResult {
  command: ReplayDirectorCommand | null;
  error?: string;
}

const POSITION_VALUES = new Set<StagePosition>(['auto', 'left', 'center', 'right']);
const CAMERA_VALUES = new Set(['none', 'push', 'shake', 'focus-speaker']);
export const TRANSITION_ALIASES: Record<string, string> = {
  cut: 'cut', 切: 'cut', fade: 'fade', 淡入: 'fade', 黑场: 'fade', dissolve: 'dissolve', 溶解: 'dissolve', 交叉: 'dissolve',
  'wipe-left': 'wipe-left', 左擦: 'wipe-left', 'wipe-right': 'wipe-right', 右擦: 'wipe-right', 'wipe-up': 'wipe-up', 上擦: 'wipe-up', 'wipe-down': 'wipe-down', 下擦: 'wipe-down',
  'iris-in': 'iris-in', 圆开: 'iris-in', 'iris-out': 'iris-out', 圆收: 'iris-out', blinds: 'blinds', 百叶窗: 'blinds', noise: 'noise', 碎点: 'noise', 像素: 'noise'
};
const TRANSITION_VALUES = new Set(Object.values(TRANSITION_ALIASES));
export const EMOTE_ALIASES: Record<string, string> = {
  怒: 'anger', 生气: 'anger', anger: 'anger', 汗: 'sweat', sweat: 'sweat', 惊: 'surprise', '！': 'surprise', '!': 'surprise', surprise: 'surprise',
  问: 'question', '？': 'question', '?': 'question', question: 'question', 惊问: 'surprise-question', '！？': 'surprise-question', '!?': 'surprise-question',
  省略: 'dots', '…': 'dots', '...': 'dots', dots: 'dots', 心: 'heart', heart: 'heart', 音符: 'note', note: 'note', 闪: 'sparkle', 亮: 'sparkle', sparkle: 'sparkle',
  黑线: 'gloom', 低落: 'gloom', gloom: 'gloom', 冒气: 'steam', 蒸汽: 'steam', steam: 'steam', 灵光: 'idea', 灯泡: 'idea', idea: 'idea'
};
export const FILTER_ALIASES: Record<string, string> = {
  回忆: 'memory', memory: 'memory', 夜晚: 'night', 夜: 'night', night: 'night', 黄昏: 'dusk', dusk: 'dusk', 黑白: 'mono', mono: 'mono',
  梦境: 'dream', 梦: 'dream', dream: 'dream', 暗角: 'vignette', vignette: 'vignette', 危险: 'danger', 警报: 'danger', danger: 'danger', 无: 'none', none: 'none', off: 'none', 关: 'none'
};
const SHAKE_STRENGTHS: Record<string, number> = { 轻: 5, 中: 12, 强: 24, light: 5, medium: 12, strong: 24 };
const SHAKE_PATTERNS: Record<string, 'fixed' | 'random'> = { 固定: 'fixed', 规律: 'fixed', fixed: 'fixed', 随机: 'random', random: 'random' };
const FLASH_COLORS: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#b3121d', 黑: '#000000', 白: '#ffffff', 红: '#b3121d' };

function tokenize(input: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const ch of input.trim()) {
    if (escaped) { current += ch; escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (current) { out.push(current); current = ''; }
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

function commandName(raw: string): DirectorCommandKind | null {
  const key = raw.replace(/^\//, '').trim().toLowerCase();
  const aliases: Record<string, DirectorCommandKind> = {
    dismiss: 'dismiss', hide: 'dismiss', exit: 'dismiss', leave: 'dismiss',
    enter: 'enter', show: 'enter', appear: 'enter',
    move: 'move', position: 'move', place: 'move',
    motion: 'motion', action: 'motion', animate: 'motion',
    expression: 'expression', expr: 'expression', face: 'expression',
    bg: 'background', background: 'background',
    cg: 'cg', object: 'object', obj: 'object', prop: 'object', bgm: 'bgm', music: 'bgm', ambient: 'ambient', ambience: 'ambient', amb: 'ambient', sfx: 'sfx', se: 'sfx', sound: 'sfx',
    camera: 'camera', cam: 'camera', transition: 'transition', trans: 'transition',
    scene: 'scene', chapter: 'chapter', wait: 'wait', pause: 'wait', flash: 'flash', shake: 'shake', quake: 'shake', emote: 'emote', mark: 'emote', filter: 'filter', grade: 'filter', card: 'card', eyecatch: 'card',
    pose: 'pose', 姿势: 'pose', outfit: 'outfit', costume: 'outfit', 服装: 'outfit'
  };
  return aliases[key] ?? null;
}

function character(project: ReplayProject, token: string) {
  return project.characters.find(c => c.id === token) ?? resolveCharacterName(project.characters, token).character ?? null;
}

function asset(project: ReplayProject, token: string, kinds?: string[]) {
  const clean = token.trim();
  if (!clean || ['none', 'off', 'stop', 'clear', 'null'].includes(clean.toLowerCase())) return null;
  const exact = project.assets.find(a => a.id === clean) ?? project.assets.find(a => a.name === clean);
  if (exact && (!kinds || kinds.includes(exact.kind))) return exact;
  const lower = clean.toLowerCase();
  return project.assets.find(a => a.name.toLowerCase() === lower && (!kinds || kinds.includes(a.kind))) ?? null;
}

export function parseDirectorCommand(project: ReplayProject, text: string): DirectorCommandParseResult {
  const tokens = tokenize(text);
  if (!tokens.length || !tokens[0]!.startsWith('/')) return { command: null, error: '指令必须以 / 开头。' };
  const kind = commandName(tokens[0]!);
  if (!kind) {
    const plugin = pluginCommand(tokens[0]!.replace(/^\//, ''));
    if (!plugin) return { command: null, error: `未知指令：${tokens[0]}（如果它来自工程插件，请先在「插件」里启用）` };
    const words = tokens.slice(1);
    let parsed: ReturnType<NonNullable<typeof plugin.def.parse>> | undefined;
    try { parsed = plugin.def.parse?.(words); } catch (error) { return { command: null, error: `/${plugin.name} 解析出错：${(error as Error)?.message || error}` }; }
    if (parsed && 'error' in parsed) return { command: null, error: `${parsed.error}${plugin.def.usage ? `（写法：${plugin.def.usage}）` : ''}` };
    const duration = Math.max(0.01, Math.min(120, Number(parsed?.duration ?? plugin.def.defaultDuration ?? 1.5) || 1.5));
    return { command: { kind: 'plugin', target: plugin.name, value: words.map(quoteArg).join(' '), duration, ...(parsed?.blocking ? { blocking: true } : {}) } };
  }
  const args = tokens.slice(1);
  if (kind === 'pose' || kind === 'outfit') {
    if (!args[0]) return { command: null, error: `/${kind} 需要角色名字。` };
    const c = character(project, args[0]);
    if (!c) return { command: null, error: `找不到角色：${args[0]}` };
    const value = args.slice(1).join(' ').trim();
    if (!value) return { command: null, error: kind === 'pose' ? '/pose 需要姿势名字，例如 /pose 亚瑟 抱臂（default 回到默认）。' : '/outfit 需要服装名字，例如 /outfit 亚瑟 衬衫（default 回到默认）。' };
    return { command: { kind, target: args[0], characterId: c.id, value } };
  }
  if (kind === 'dismiss' || kind === 'enter' || kind === 'move' || kind === 'motion' || kind === 'expression') {
    if (!args[0]) return { command: null, error: `/${kind} 需要角色名字。` };
    const c = character(project, args[0]);
    if (!c) return { command: null, error: `找不到角色：${args[0]}` };
    if (kind === 'dismiss') return { command: { kind, target: args[0], characterId: c.id } };
    if (kind === 'move') {
      const rawPos = (args[1] ?? 'auto') as StagePosition;
      if (!POSITION_VALUES.has(rawPos)) return { command: null, error: `未知站位：${args[1]}` };
      return { command: { kind, target: args[0], characterId: c.id, ...(rawPos !== 'auto' ? { position: rawPos } : {}) } };
    }
    if (kind === 'motion') {
      const action = (args[1] ?? '').trim();
      if (!action) return { command: null, error: '/motion 需要已有自定义动作名。' };
      const duration = args[2] == null ? 0.5 : Number(args[2]);
      if (!Number.isFinite(duration) || duration < 0) return { command: null, error: '/motion 时长需要非负秒数。' };
      return { command: { kind, target: args[0], characterId: c.id, value: action, duration } };
    }
    if (kind === 'enter') {
      const rawPos = (args[1] ?? 'auto') as StagePosition;
      if (!POSITION_VALUES.has(rawPos)) return { command: null, error: `未知站位：${args[1]}` };
      return { command: { kind, target: args[0], characterId: c.id, position: rawPos } };
    }
    const expression = args.slice(1).join(' ').trim();
    if (!expression) return { command: null, error: '/expression 需要表情名字。' };
    return { command: { kind, target: args[0], characterId: c.id, expression } };
  }

  if (kind === 'object') {
    const action = (args[0] ?? '').toLowerCase();
    if (!['show','hide','state','transform'].includes(action)) return { command: null, error: '/object 可用：show, hide, state, transform。' };
    const name = args[1]?.trim();
    if (!name) return { command: null, error: `/object ${action} 需要对象名字。` };
    const object = project.customObjects.find(item => item.id === name)
      ?? project.customObjects.find(item => item.name === name)
      ?? project.customObjects.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (!object) return { command: null, error: `找不到自定义对象：${name}` };
    let objectStateId: string | null = null;
    let objectTransform = null as ReplayDirectorCommand['objectTransform'];
    if (action === 'state' || (action === 'show' && args[2])) {
      const rawState = args.slice(2).join(' ').trim();
      if (rawState) {
        const state = object.states.find(item => item.id === rawState) ?? object.states.find(item => item.name === rawState) ?? object.states.find(item => item.name.toLowerCase() === rawState.toLowerCase());
        if (!state) return { command: null, error: `对象「${object.name}」没有状态：${rawState}` };
        objectStateId = state.id;
      }
    }
    if (action === 'transform') {
      const values = args.slice(2).map(Number);
      if (values.length < 3 || values.some(value => !Number.isFinite(value))) return { command: null, error: '/object transform 格式：对象 x y scale [rotation]。数值通常由可视化编辑/录制器生成。' };
      objectTransform = {
        x: Math.max(-0.5, Math.min(1.5, values[0]!)),
        y: Math.max(-0.5, Math.min(1.5, values[1]!)),
        scale: Math.max(0.05, Math.min(4, values[2]!)),
        rotation: Number.isFinite(values[3]) ? values[3] : undefined
      };
    }
    return { command: { kind, objectId: object.id, objectAction: action as any, objectStateId, objectTransform, target: object.name } };
  }

  if (kind === 'background' || kind === 'cg' || kind === 'bgm' || kind === 'ambient' || kind === 'sfx') {
    if (!args.length) return { command: null, error: `/${kind} 需要素材名，或 none/stop。` };
    const raw = args.join(' ').trim();
    const kinds = kind === 'background' ? ['background'] : kind === 'cg' ? ['cg'] : kind === 'bgm' ? ['bgm'] : kind === 'ambient' ? ['ambient'] : ['sfx'];
    const a = asset(project, raw, kinds);
    const cleared = ['none', 'off', 'stop', 'clear', 'null'].includes(raw.toLowerCase());
    if (!a && !cleared) return { command: null, error: `找不到${kind === 'sfx' ? '音效' : '素材'}：${raw}` };
    return { command: { kind, target: raw, assetId: a?.id ?? null } };
  }
  if (kind === 'camera') {
    const value = (args[0] ?? '').toLowerCase();
    if (!CAMERA_VALUES.has(value)) return { command: null, error: `camera 可用：${[...CAMERA_VALUES].join(', ')}` };
    return { command: { kind, value } };
  }
  if (kind === 'transition') {
    const value = TRANSITION_ALIASES[(args[0] ?? '').toLowerCase()] ?? TRANSITION_ALIASES[args[0] ?? ''] ?? pluginTransition(args[0])?.name ?? '';
    if (!TRANSITION_VALUES.has(value) && !pluginTransition(value)) return { command: null, error: '/transition 可用：切 淡入 溶解 左擦 右擦 上擦 下擦 圆开 圆收 百叶窗 碎点（或英文 cut fade dissolve wipe-left …），可再写秒数。' };
    const seconds = args[1] === undefined ? null : Number(args[1]);
    if (seconds !== null && (!(seconds > 0) || seconds > 10)) return { command: null, error: '/transition 秒数需要在 0 到 10 之间。' };
    return { command: { kind, value, ...(seconds !== null ? { duration: seconds } : {}) } };
  }
  if (kind === 'scene' || kind === 'chapter') {
    const value = args.join(' ').trim();
    if (!value) return { command: null, error: `/${kind} 需要名称。` };
    return { command: { kind, value } };
  }
  if (kind === 'shake') {
    const strengthWord = args.find(arg => arg in SHAKE_STRENGTHS);
    const numbers = args.filter(arg => /^\d+(?:\.\d+)?$/.test(arg)).map(Number);
    const patternWord = args.find(arg => arg in SHAKE_PATTERNS);
    const unknown = args.find(arg => !(arg in SHAKE_STRENGTHS) && !(arg in SHAKE_PATTERNS) && !/^\d+(?:\.\d+)?$/.test(arg));
    if (unknown) return { command: null, error: '/shake 写法：/shake 强度 秒数 节奏 频率，例如 /shake 强 3 随机 或 /shake 中 2 固定 8。强度可写 轻/中/强 或像素数。' };
    // With a strength word the numbers are seconds then frequency; without one the first number is pixels.
    const amplitude = strengthWord ? SHAKE_STRENGTHS[strengthWord]! : numbers.length >= 2 ? numbers.shift()! : SHAKE_STRENGTHS['中']!;
    const seconds = numbers[0] ?? 1;
    const pattern = patternWord ? SHAKE_PATTERNS[patternWord]! : 'random';
    const frequency = numbers[1] ?? (pattern === 'fixed' ? 10 : 14);
    if (!(seconds > 0) || seconds > 60) return { command: null, error: '/shake 秒数需要在 0 到 60 之间。' };
    if (!(amplitude > 0) || amplitude > 80) return { command: null, error: '/shake 强度需要在 1 到 80 像素之间。' };
    if (!(frequency > 0) || frequency > 40) return { command: null, error: '/shake 频率需要在 1 到 40 之间。' };
    return { command: { kind, value: `${pattern} ${amplitude} ${frequency}`, duration: seconds } };
  }
  if (kind === 'emote') {
    const [who, mark, secondsArg] = args;
    if (!who || !mark) return { command: null, error: '/emote 写法：/emote 角色 怒 [秒]。可用：怒 汗 惊 问 惊问 省略 心 音符 闪 黑线 冒气 灵光。' };
    const c = character(project, who);
    if (!c) return { command: null, error: `找不到角色：${who}` };
    const value = EMOTE_ALIASES[mark] ?? EMOTE_ALIASES[mark.toLowerCase()];
    if (!value) return { command: null, error: `未知漫符：${mark}。可用：怒 汗 惊 问 惊问 省略 心 音符 闪 黑线 冒气 灵光。` };
    const seconds = secondsArg === undefined ? 1.6 : Number(secondsArg);
    if (!(seconds > 0) || seconds > 30) return { command: null, error: '/emote 秒数需要在 0 到 30 之间。' };
    return { command: { kind, target: who, characterId: c.id, value, duration: seconds } };
  }
  if (kind === 'filter') {
    const value = FILTER_ALIASES[args[0] ?? ''] ?? FILTER_ALIASES[(args[0] ?? '').toLowerCase()] ?? pluginFilter(args[0])?.name;
    if (!value) return { command: null, error: '/filter 可用：回忆 夜晚 黄昏 黑白 梦境 暗角 危险 无。效果一直持续到下一条 /filter。' };
    return { command: { kind, value } };
  }
  if (kind === 'card') {
    const numbers = args.filter(arg => /^\d+(?:\.\d+)?$/.test(arg));
    const words = args.filter(arg => !/^\d+(?:\.\d+)?$/.test(arg));
    if (!words.length) return { command: null, error: '/card 写法：/card 标题 [副标题] [秒]，例如 /card 第一话 "就是一个奇妙的小海岛" 3。' };
    const seconds = numbers.length ? Number(numbers.at(-1)) : 2.6;
    if (!(seconds > 0) || seconds > 30) return { command: null, error: '/card 秒数需要在 0 到 30 之间。' };
    return { command: { kind, value: words[0]!, target: words.slice(1).join(' '), duration: seconds } };
  }
  if (kind === 'flash') {
    const colorArg = args.find(arg => !/^\d/.test(arg));
    const value = colorArg ? (FLASH_COLORS[colorArg.toLowerCase()] ?? (/^#[0-9a-f]{3,8}$/i.test(colorArg) ? colorArg : null)) : '#000000';
    if (!value) return { command: null, error: '/flash 颜色可用：black、white、red 或 #rrggbb，例如 /flash black 0.5。' };
    const secondsArg = args.find(arg => /^\d/.test(arg));
    const seconds = secondsArg === undefined ? 0.5 : Number(secondsArg);
    if (!Number.isFinite(seconds) || seconds <= 0) return { command: null, error: '/flash 需要大于 0 的秒数，例如 /flash black 0.5。' };
    return { command: { kind, value, duration: seconds } };
  }
  const duration = Number(args[0]);
  if (!Number.isFinite(duration) || duration < 0) return { command: null, error: '/wait 需要非负秒数，例如 /wait 0.5。' };
  return { command: { kind: 'wait', duration } };
}

function quoteArg(value: string): string {
  const clean = String(value ?? '');
  return /\s|["']/.test(clean) ? `"${clean.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : clean;
}

export function formatDirectorCommand(project: ReplayProject, command: ReplayDirectorCommand): string {
  const charName = command.characterId ? project.characters.find(c => c.id === command.characterId)?.name : null;
  const assetName = command.assetId ? project.assets.find(a => a.id === command.assetId)?.name : null;
  switch (command.kind) {
    case 'dismiss': return `/dismiss ${quoteArg(charName ?? command.target ?? '')}`.trim();
    case 'enter': return `/enter ${quoteArg(charName ?? command.target ?? '')}${command.position && command.position !== 'auto' ? ` ${command.position}` : ''}`.trim();
    case 'move': return `/move ${quoteArg(charName ?? command.target ?? '')}${command.position && command.position !== 'auto' ? ` ${command.position}` : ''}`.trim();
    case 'motion': return `/motion ${quoteArg(charName ?? command.target ?? '')} ${quoteArg(command.value ?? 'replace')} ${Math.max(0, Number(command.duration) || 0.5)}`.trim();
    case 'expression': return `/expression ${quoteArg(charName ?? command.target ?? '')} ${quoteArg(command.expression ?? 'default')}`.trim();
    case 'pose': return `/pose ${quoteArg(charName ?? command.target ?? '')} ${quoteArg(command.value ?? 'default')}`.trim();
    case 'outfit': return `/outfit ${quoteArg(charName ?? command.target ?? '')} ${quoteArg(command.value ?? 'default')}`.trim();
    case 'background': return `/bg ${quoteArg(assetName ?? command.target ?? 'none')}`;
    case 'cg': return `/cg ${quoteArg(assetName ?? command.target ?? 'none')}`;
    case 'object': {
      const object = command.objectId ? project.customObjects.find(item => item.id === command.objectId) : null;
      const state = object && command.objectStateId ? object.states.find(item => item.id === command.objectStateId) : null;
      const action = command.objectAction ?? 'show';
      if (action === 'transform') {
        const transform = command.objectTransform ?? {};
        const base = object?.transform ?? { x: 0.5, y: 0.5, scale: 0.6, rotation: 0 };
        const x = Number(transform.x ?? base.x).toFixed(4);
        const y = Number(transform.y ?? base.y).toFixed(4);
        const scale = Number(transform.scale ?? base.scale).toFixed(4);
        const rotation = Number(transform.rotation ?? base.rotation ?? 0).toFixed(2);
        return `/object transform ${quoteArg(object?.name ?? command.target ?? '')} ${x} ${y} ${scale} ${rotation}`.trim();
      }
      return `/object ${action} ${quoteArg(object?.name ?? command.target ?? '')}${state ? ` ${quoteArg(state.name)}` : ''}`.trim();
    }
    case 'bgm': return `/bgm ${quoteArg(assetName ?? command.target ?? 'stop')}`;
    case 'ambient': return `/ambient ${quoteArg(assetName ?? command.target ?? 'stop')}`;
    case 'sfx': return `/sfx ${quoteArg(assetName ?? command.target ?? '')}`.trim();
    case 'camera': return `/camera ${command.value ?? 'none'}`;
    case 'transition': return `/transition ${command.value ?? 'cut'}${command.duration ? ` ${command.duration}` : ''}`;
    case 'scene': return `/scene ${quoteArg(command.value ?? 'Scene')}`;
    case 'chapter': return `/chapter ${quoteArg(command.value ?? 'Chapter')}`;
    case 'wait': return `/wait ${Math.max(0, Number(command.duration) || 0)}`;
    case 'shake': { const [pattern = 'random', amplitude = '12', frequency = '14'] = String(command.value ?? '').split(' '); return `/shake ${amplitude} ${Math.max(0.01, Number(command.duration) || 1)} ${pattern === 'fixed' ? '固定' : '随机'} ${frequency}`; }
    case 'emote': return `/emote ${quoteArg(charName ?? command.target ?? '')} ${Object.keys(EMOTE_ALIASES).find(key => EMOTE_ALIASES[key] === command.value) ?? command.value} ${Math.max(0.01, Number(command.duration) || 1.6)}`;
    case 'filter': return `/filter ${Object.keys(FILTER_ALIASES).find(key => FILTER_ALIASES[key] === command.value) ?? command.value}`;
    case 'plugin': return `/${command.target ?? ''}${command.value ? ` ${command.value}` : ''}`;
    case 'card': return `/card ${quoteArg(command.value ?? '')}${command.target ? ` ${quoteArg(command.target)}` : ''} ${Math.max(0.01, Number(command.duration) || 2.6)}`;
    case 'flash': return `/flash ${command.value ?? '#000000'} ${Math.max(0.01, Number(command.duration) || 0.5)}`;
  }
}

export function syncDirectorCommandLine(project: ReplayProject, line: ReplayLine): DirectorCommandParseResult {
  if (line.type !== 'command') return { command: null };
  const result = parseDirectorCommand(project, line.text);
  if (result.command) {
    if (line.command?.beatMode) result.command.beatMode = line.command.beatMode;
    line.command = result.command;
  }
  return result;
}
