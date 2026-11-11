/**
 * Stage plugins: project-supplied director commands, transitions and colour filters.
 *
 * A plugin file's default export is `function (api) { api.registerCommand({...}) }`.
 * Everything a plugin draws must be a pure function of its arguments and time, so that
 * scrubbing, preview and video export render the same frame.
 */

export interface PluginHead { x: number; y: number; h: number; }

export interface PluginDrawInfo {
  /** Seconds since the effect started (negative before, ≥ duration after: such frames are skipped). */
  time: number;
  duration: number;
  /** 0 → 1 across the effect. */
  progress: number;
  width: number;
  height: number;
  /** Words after the command name, as typed. */
  args: string[];
  /** Heads of on-stage characters by name, in world coordinates (world layer) — empty elsewhere. */
  heads: Record<string, PluginHead>;
  speakerName: string;
  text: string;
  /** Deterministic 0..1 noise; use instead of Math.random. */
  random(seed: number): number;
}

export interface PluginCommandDef {
  /** Command word, written as `/name …`. Letters, digits, CJK, `-` and `_`. */
  name: string;
  aliases?: string[];
  /** One-line usage shown in the UI and in parse errors, e.g. `/hearts 3 粉`. */
  usage?: string;
  /** Inserted by the quick button. Defaults to `/name`. */
  template?: string;
  /** Where it draws: behind the textbox with the characters (`world`), over the stage (`screen`, default) or over everything (`top`). */
  layer?: 'world' | 'screen' | 'top';
  defaultDuration?: number;
  /** Validate the words; return an error string, or seconds / blocking to override defaults. */
  parse?(args: string[]): { duration?: number; blocking?: boolean } | { error: string } | void;
  draw(ctx: CanvasRenderingContext2D, info: PluginDrawInfo): void;
}

export interface PluginTransitionDef {
  name: string;
  aliases?: string[];
  /** Draw the part of `previous` that is still covering the new frame; progress 0 → 1 reveals. */
  cover(ctx: CanvasRenderingContext2D, progress: number, width: number, height: number, previous: CanvasImageSource): void;
}

export interface PluginFilterDef {
  name: string;
  aliases?: string[];
  /** CSS filter applied to the world layer, e.g. `contrast(1.3) saturate(0.6)`. */
  css?: string;
  overlay?(ctx: CanvasRenderingContext2D, width: number, height: number, time: number): void;
}

export interface StagePluginInfo { id: string; label: string; commands: string[]; transitions: string[]; filters: string[]; error?: string; }

export interface StagePluginApi {
  version: 1;
  registerCommand(def: PluginCommandDef): void;
  registerTransition(def: PluginTransitionDef): void;
  registerFilter(def: PluginFilterDef): void;
  util: { random(seed: number): number; clamp(v: number, lo: number, hi: number): number; easeOut(t: number): number; easeInOut(t: number): number };
}

const NAME = /^[\p{L}\p{N}_-]{1,24}$/u;
const BUILTIN_COMMANDS = new Set(['dismiss', 'hide', 'exit', 'leave', 'enter', 'show', 'appear', 'move', 'position', 'place', 'motion', 'action', 'animate', 'expression', 'expr', 'face', 'bg', 'background', 'cg', 'object', 'obj', 'prop', 'bgm', 'music', 'ambient', 'ambience', 'amb', 'sfx', 'se', 'sound', 'camera', 'cam', 'transition', 'trans', 'scene', 'chapter', 'wait', 'pause', 'flash', 'shake', 'quake', 'emote', 'mark', 'filter', 'grade', 'card', 'eyecatch', 'pose', '姿势', 'outfit', 'costume', '服装']);

const commands = new Map<string, { plugin: string; def: PluginCommandDef }>();
const commandAliases = new Map<string, string>();
const transitions = new Map<string, { plugin: string; def: PluginTransitionDef }>();
const transitionAliases = new Map<string, string>();
const filters = new Map<string, { plugin: string; def: PluginFilterDef }>();
const filterAliases = new Map<string, string>();
const plugins = new Map<string, StagePluginInfo>();
const reported = new Set<string>();
let revision = 0;

export function hash01(n: number): number { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function checkName(kind: string, name: string): string {
  const clean = String(name ?? '').trim();
  if (!NAME.test(clean)) throw new Error(`${kind}名字只能用字母、数字、中文、- 和 _，最多 24 个字符：${name}`);
  return clean;
}

/** Runs a plugin's setup function and records what it registered. Errors are kept, never thrown. */
export function installStagePlugin(id: string, label: string, setup: (api: StagePluginApi) => void): StagePluginInfo {
  removeStagePlugin(id);
  const info: StagePluginInfo = { id, label, commands: [], transitions: [], filters: [] };
  const api: StagePluginApi = {
    version: 1,
    registerCommand(def) {
      const name = checkName('指令', def?.name);
      if (BUILTIN_COMMANDS.has(name.toLowerCase())) throw new Error(`/${name} 是内置指令，插件不能覆盖`);
      if (commands.has(name) || commandAliases.has(name)) throw new Error(`/${name} 已经被别的插件注册了`);
      if (typeof def.draw !== 'function') throw new Error(`/${name} 缺少 draw 函数`);
      commands.set(name, { plugin: id, def });
      for (const alias of def.aliases ?? []) { const a = checkName('别名', alias); if (!BUILTIN_COMMANDS.has(a.toLowerCase()) && !commands.has(a)) commandAliases.set(a, name); }
      info.commands.push(name);
    },
    registerTransition(def) {
      const name = checkName('转场', def?.name);
      if (transitions.has(name)) throw new Error(`转场 ${name} 已经被注册了`);
      if (typeof def.cover !== 'function') throw new Error(`转场 ${name} 缺少 cover 函数`);
      transitions.set(name, { plugin: id, def });
      for (const alias of def.aliases ?? []) transitionAliases.set(checkName('别名', alias), name);
      info.transitions.push(name);
    },
    registerFilter(def) {
      const name = checkName('滤镜', def?.name);
      if (filters.has(name)) throw new Error(`滤镜 ${name} 已经被注册了`);
      filters.set(name, { plugin: id, def });
      for (const alias of def.aliases ?? []) filterAliases.set(checkName('别名', alias), name);
      info.filters.push(name);
    },
    util: { random: hash01, clamp, easeOut: t => 1 - Math.pow(1 - clamp(t, 0, 1), 3), easeInOut: t => { const x = clamp(t, 0, 1); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; } }
  };
  try { setup(api); } catch (error) { info.error = (error as Error)?.message || String(error); }
  plugins.set(id, info);
  revision += 1;
  return info;
}

export function removeStagePlugin(id: string): void {
  for (const [map, aliases] of [[commands, commandAliases], [transitions, transitionAliases], [filters, filterAliases]] as const) {
    for (const [name, entry] of [...map]) if (entry.plugin === id) { map.delete(name); for (const [alias, target] of [...aliases]) if (target === name) aliases.delete(alias); }
  }
  if (plugins.delete(id)) revision += 1;
}

export function clearStagePlugins(): void { for (const id of [...plugins.keys()]) removeStagePlugin(id); reported.clear(); }
export function listStagePlugins(): StagePluginInfo[] { return [...plugins.values()].map(item => ({ ...item })); }
export function stagePluginRevision(): number { return revision; }

export function pluginCommand(name: string) { const key = commandAliases.get(name) ?? name; const hit = commands.get(key); return hit ? { name: key, ...hit } : null; }
export function pluginTransition(name: string | null | undefined) { if (!name) return null; const key = transitionAliases.get(name) ?? name; const hit = transitions.get(key); return hit ? { name: key, ...hit } : null; }
export function pluginFilter(name: string | null | undefined) { if (!name) return null; const key = filterAliases.get(name) ?? name; const hit = filters.get(key); return hit ? { name: key, ...hit } : null; }
export function pluginCommandList() { return [...commands.entries()].map(([name, { plugin, def }]) => ({ name, plugin, usage: def.usage ?? `/${name}`, template: def.template ?? `/${name}` })); }

/** A plugin that throws while drawing is reported once and skipped, never breaking the frame. */
export function reportPluginError(key: string, error: unknown): void {
  if (reported.has(key)) return;
  reported.add(key);
  const [plugin] = key.split(':');
  const info = plugin ? plugins.get(plugin) : undefined;
  if (info && !info.error) info.error = `绘制出错：${(error as Error)?.message || String(error)}`;
  if (typeof console !== 'undefined') console.warn(`[Replay Lab 插件] ${key}`, error);
}
