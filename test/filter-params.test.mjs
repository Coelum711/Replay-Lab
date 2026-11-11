import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { StoryScriptImporter, parseDirectorCommand, formatDirectorCommand, decodeFilterValue, compilePerformance, createLine } from '../dist/index.js';
import { screenFilterCss, drawScreenFilterOverlay } from '../dist/renderers/stage-fx.js';

const project = StoryScriptImporter.parse('亚瑟：一', { title: 't' });
const parse = text => parseDirectorCommand(project, text);

test('filters are presets plus adjustable parameters', () => {
  assert.equal(parse('/filter 回忆').command.value, 'memory', 'a plain preset stays a plain name');
  const tweaked = parse('/filter 回忆 暗0.7');
  const decoded = decodeFilterValue(tweaked.command.value);
  assert.equal(decoded.preset, 'memory');
  assert.equal(decoded.params.vignette, 0.7);
  assert.equal(decoded.params.sepia, 0.75, 'untouched preset values are kept');
  assert.equal(formatDirectorCommand(project, tweaked.command), '/filter 回忆 暗0.7');
  const custom = parse('/filter 自定义 色#ff8800 强0.35 混柔光 亮0.9');
  assert.equal(formatDirectorCommand(project, custom.command), '/filter 自定义 色#ff8800 强0.35 混柔光 亮0.9');
  assert.deepEqual(parse(formatDirectorCommand(project, custom.command)).command, custom.command);
  assert.equal(decodeFilterValue(parse('/filter 色#336699 强0.4').command.value).params.tint, '#336699', 'no preset name means custom');
  assert.match(parse('/filter 回忆 好看').error, /看不懂/);
  assert.match(parse('/filter 回忆 亮9').error, /0 到 3/);
  assert.equal(parse('/filter 无').command.value, 'none');
});

test('custom grades render: css for the world layer, wash and vignette on top', () => {
  assert.match(screenFilterCss('memory'), /sepia\(0\.75\)/);
  const value = parse('/filter 自定义 色#ff8800 强0.35 混柔光 亮0.9 暗0.4').command.value;
  assert.equal(screenFilterCss(value), 'brightness(0.9)');
  const calls = [], props = {};
  const ctx = new Proxy({}, { get: (_, k) => k in props ? props[k] : k === 'createRadialGradient' ? () => ({ addColorStop: () => calls.push('stop') }) : (...a) => calls.push(String(k)), set: (_, k, v) => { props[k] = v; calls.push(`${String(k)}=${typeof v === 'string' ? v : 'obj'}`); return true; } });
  drawScreenFilterOverlay(ctx, value, 1280, 720, 0);
  assert.ok(calls.includes('globalCompositeOperation=soft-light'));
  assert.ok(calls.includes('fillStyle=rgba(255,136,0,0.35)'));
  assert.equal(calls.filter(c => c === 'fillRect').length, 2, 'wash plus vignette');
  const lines = [createLine(project, 'Director', '/filter 回忆 暗0.7', 'command')];
  lines[0].command = parse(lines[0].text).command;
  const p2 = StoryScriptImporter.parse('亚瑟：一\n亚瑟：二', { title: 't' }); p2.lines.unshift(lines[0]);
  assert.ok(compilePerformance(p2).lines.slice(1).every(l => decodeFilterValue(l.screenFilter)?.params.vignette === 0.7), 'tweaked filter persists like a preset');
});

test('the 动画 panel edits a filter with colour and sliders', async () => {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>');
  Object.assign(globalThis, { document: dom.window.document });
  const { renderAnimationWorkbench } = await import('../web/animation-workbench.js');
  const p = StoryScriptImporter.parse('亚瑟：一', { title: 't' });
  const cmd = createLine(p, 'Director', '/filter 回忆', 'command'); cmd.command = parseDirectorCommand(p, cmd.text).command; p.lines.unshift(cmd);
  const performance = compilePerformance(p), calls = [];
  const host = document.querySelector('#host');
  renderAnimationWorkbench(host, { project: p, line: p.lines[1], index: 1, perf: performance.lines[1], performance, setText: (at, text) => calls.push(text), insertAt() {}, preview() {}, move() {}, remove() {}, jumpToSource() {}, openSound() {} });
  const vignette = host.querySelector('[data-anim-filter-slider="vignette"]');
  vignette.value = '0.8'; vignette.dispatchEvent(new dom.window.Event('change'));
  assert.equal(calls.at(-1), '/filter 回忆 暗0.8');
  const tint = host.querySelector('[data-anim-filter-tint]');
  tint.value = '#3366ff'; tint.dispatchEvent(new dom.window.Event('change'));
  assert.equal(calls.at(-1), '/filter 回忆 色#3366ff');
  const preset = host.querySelector('select[data-anim-filter]');
  preset.value = '夜晚'; preset.dispatchEvent(new dom.window.Event('change'));
  assert.equal(calls.at(-1), '/filter 夜晚', 'switching preset starts from its own values');
});
