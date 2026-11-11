import test from 'node:test';
import assert from 'node:assert/strict';
import { StoryScriptImporter, parseDirectorCommand, formatDirectorCommand, compilePerformance, createLine,
  installStagePlugin, clearStagePlugins, listStagePlugins, pluginCommand, pluginTransition, pluginFilter, pluginCommandList } from '../dist/index.js';

const recorder = () => {
  const calls = [], props = {};
  const ctx = new Proxy({}, {
    get: (_, key) => key in props ? props[key] : (...args) => { calls.push([String(key), ...args.map(a => typeof a === 'number' ? Math.round(a * 1000) / 1000 : typeof a === 'object' ? 'obj' : a)]); },
    set: (_, key, value) => { props[key] = value; calls.push(['set', String(key), value]); return true; }
  });
  return { ctx, calls };
};
const info = (time, extra = {}) => ({ time, duration: 3, progress: time / 3, width: 1280, height: 720, args: ['10', '粉', '3'], heads: {}, speakerName: 'A', text: 't', random: n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }, ...extra });

test.afterEach(() => clearStagePlugins());

test('plugin commands parse, round-trip and refuse to shadow built-ins', () => {
  const project = StoryScriptImporter.parse('亚瑟：一', { title: 't' });
  assert.match(parseDirectorCommand(project, '/sparkle 3').error, /插件/, 'unknown until a plugin provides it');
  const result = installStagePlugin('p1', '测试', api => {
    api.registerCommand({ name: 'sparkle', aliases: ['闪闪'], usage: '/sparkle 秒数', parse: args => Number(args[0]) > 0 ? { duration: Number(args[0]) } : { error: '秒数要大于 0' }, draw() {} });
    api.registerCommand({ name: 'curtain', defaultDuration: 2, parse: () => ({ blocking: true }), draw() {} });
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(parseDirectorCommand(project, '/sparkle 3 "two words"').command, { kind: 'plugin', target: 'sparkle', value: '3 "two words"', duration: 3 });
  assert.equal(parseDirectorCommand(project, '/闪闪 2').command.target, 'sparkle', 'aliases resolve to the canonical name');
  assert.match(parseDirectorCommand(project, '/sparkle 0').error, /秒数要大于 0.*写法/);
  assert.equal(parseDirectorCommand(project, '/curtain').command.blocking, true);
  const command = parseDirectorCommand(project, '/sparkle 3 "two words"').command;
  assert.deepEqual(parseDirectorCommand(project, formatDirectorCommand(project, command)).command, command);
  const bad = installStagePlugin('p2', '坏', api => api.registerCommand({ name: 'shake', draw() {} }));
  assert.match(bad.error, /内置指令/);
  assert.equal(pluginCommandList().length, 2);
  assert.equal(listStagePlugins().length, 2);
});

test('plugin effects run on across lines; blocking ones hold the script', () => {
  installStagePlugin('p', 'p', api => {
    api.registerCommand({ name: 'rain', defaultDuration: 2.5, draw() {} });
    api.registerCommand({ name: 'curtain', defaultDuration: 2, parse: () => ({ blocking: true }), draw() {} });
  });
  const project = StoryScriptImporter.parse('亚瑟：一\n王耀：二\n亚瑟：三', { title: 't' });
  for (const line of project.lines) line.duration = 1;
  const insert = (at, text) => { const line = createLine(project, 'Director', text, 'command'); line.command = parseDirectorCommand(project, text).command; project.lines.splice(at, 0, line); };
  insert(2, '/curtain'); insert(0, '/rain');
  const lines = compilePerformance(project).lines;
  assert.ok(lines[0].duration < 0.1, 'non-blocking effect does not pause');
  assert.deepEqual(lines.filter(l => l.type === 'dialogue').map(l => (l.pluginEffects ?? []).some(e => e.name === 'rain')), [true, true, false]);
  const curtain = lines.find(l => l.pluginEvent?.name === 'curtain');
  assert.equal(curtain.duration, 2, 'blocking effect holds for its seconds');
});

test('plugin transitions and filters are accepted by name', () => {
  installStagePlugin('p', 'p', api => { api.registerTransition({ name: 'glitch', aliases: ['故障'], cover() {} }); api.registerFilter({ name: '老电视', css: 'contrast(1.2)' }); });
  const project = StoryScriptImporter.parse('亚瑟：一', { title: 't' });
  assert.equal(parseDirectorCommand(project, '/transition 故障 0.8').command.value, 'glitch');
  assert.equal(parseDirectorCommand(project, '/filter 老电视').command.value, '老电视');
  assert.ok(pluginTransition('glitch') && pluginFilter('老电视'));
  assert.match(parseDirectorCommand(project, '/transition nope').error, /transition 可用/);
});

test('the starter plugin installs, draws, and draws the same frame for the same time', async () => {
  const { STARTER_PLUGIN } = await import('../web/plugin-loader.js');
  const module = await import(`data:text/javascript;base64,${Buffer.from(STARTER_PLUGIN).toString('base64')}`);
  const installed = installStagePlugin('starter', '示例', module.default);
  assert.equal(installed.error, undefined);
  assert.deepEqual([installed.commands, installed.transitions, installed.filters], [['hearts'], ['heart-iris'], ['老电视']]);
  const project = StoryScriptImporter.parse('亚瑟：一', { title: 't' });
  assert.equal(parseDirectorCommand(project, '/爱心 30 粉 3').command.duration, 3);
  assert.match(parseDirectorCommand(project, '/hearts 10 粉 99').error, /秒数/);
  const a = recorder(), b = recorder();
  pluginCommand('hearts').def.draw(a.ctx, info(1.25));
  pluginCommand('hearts').def.draw(b.ctx, info(1.25));
  assert.ok(a.calls.length > 20, 'it actually draws');
  assert.deepEqual(a.calls, b.calls, 'deterministic: same time, same drawing');
  const c = recorder(); pluginTransition('heart-iris').def.cover(c.ctx, 0.5, 1280, 720, {});
  assert.ok(c.calls.some(call => call[0] === 'drawImage'));
});

test('unapproved project plugins are never imported', async () => {
  const store = new Map();
  Object.assign(globalThis, { localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } });
  const { loadProjectPlugins } = await import('../web/plugin-loader.js');
  const source = 'export default function (api) { api.registerCommand({ name: "x1", draw() {} }); }';
  const workspace = { kind: 'memory', list: async () => [{ path: 'plugins/x.js' }], read: async () => new Blob([source]) };
  let asked = null;
  const result = await loadProjectPlugins(workspace, { confirm: async pending => { asked = pending.map(p => [p.name, p.sha?.length]); return []; } });
  assert.deepEqual(asked, [['x.js', 64]], 'the user is shown the file and its hash');
  assert.deepEqual(result.results, [], 'declined: nothing runs');
  assert.deepEqual(result.skipped.map(s => s.name), ['x.js']);
  assert.equal(pluginCommand('x1'), null);
});
