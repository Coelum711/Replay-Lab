import type { DirectorCommandKind, ReplayDirectorCommand, ReplayLine, ReplayProject, StagePosition } from './types.js';
import { resolveCharacterName } from './character-name.js';

export interface DirectorCommandParseResult {
  command: ReplayDirectorCommand | null;
  error?: string;
}

const POSITION_VALUES = new Set<StagePosition>(['auto', 'left', 'center', 'right']);
const CAMERA_VALUES = new Set(['none', 'push', 'shake', 'focus-speaker']);
const TRANSITION_VALUES = new Set(['cut', 'fade']);

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
    scene: 'scene', chapter: 'chapter', wait: 'wait', pause: 'wait'
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
  if (!kind) return { command: null, error: `未知指令：${tokens[0]}` };
  const args = tokens.slice(1);
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
    const value = (args[0] ?? '').toLowerCase();
    if (!TRANSITION_VALUES.has(value)) return { command: null, error: `transition 可用：${[...TRANSITION_VALUES].join(', ')}` };
    return { command: { kind, value } };
  }
  if (kind === 'scene' || kind === 'chapter') {
    const value = args.join(' ').trim();
    if (!value) return { command: null, error: `/${kind} 需要名称。` };
    return { command: { kind, value } };
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
    case 'transition': return `/transition ${command.value ?? 'cut'}`;
    case 'scene': return `/scene ${quoteArg(command.value ?? 'Scene')}`;
    case 'chapter': return `/chapter ${quoteArg(command.value ?? 'Chapter')}`;
    case 'wait': return `/wait ${Math.max(0, Number(command.duration) || 0)}`;
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
