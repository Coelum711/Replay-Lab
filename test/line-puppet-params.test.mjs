import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createProject, createLine, compilePerformance, linePuppetOverridesAt, evaluatePuppet, normalizePuppetRig, reimportScriptPreservingSetup } from '../dist/index.js';

const setup = () => {
  const p = createProject('t');
  const add = (text, extra = {}) => { const l = createLine(p, 'Alice', text); Object.assign(l, extra); p.lines.push(l); return l; };
  return { p, add };
};

test('per-line overrides compile; same expression with different values gets an ease-from', () => {
  const { p, add } = setup();
  const a = add('一', {});
  const b = add('二', {});
  const id = p.characters[0].id;
  b.puppetParams = { [id]: { lookX: -1 } };
  const c = add('三', { puppetParams: { [id]: { lookX: -1 } } });
  const d = add('四');
  const perf = compilePerformance(p);
  assert.equal(perf.lines[0].puppetParams, undefined);
  assert.deepEqual(perf.lines[1].puppetParams, { [id]: { lookX: -1 } });
  assert.deepEqual(perf.lines[1].puppetFrom, { [id]: {} }, 'eases from the expression values');
  assert.equal(perf.lines[2].puppetFrom, undefined, 'identical values: no transition');
  assert.equal(perf.lines[3].puppetParams, undefined, 'unset line follows the expression again');
  assert.deepEqual(perf.lines[3].puppetFrom, { [id]: { lookX: -1 } }, 'and eases back from the previous line');
  void a; void c; void d;
});

test('an expression change switches directly; command lines carry overrides without a transition', () => {
  const { p, add } = setup();
  add('一');
  const id = p.characters[0].id;
  p.characters[0].puppet = normalizePuppetRig({ expressionPresets: { 开心: { browY: 1 } } });
  add('二', { expression: '开心', expressionMode: 'set', puppetParams: { [id]: { lookX: 1 } } });
  const wait = createLine(p, 'Director', '/wait 1', 'command'); p.lines.push(wait);
  add('三', { puppetParams: { [id]: { lookX: 1 } } });
  const perf = compilePerformance(p);
  assert.equal(perf.lines[1].state.expressions[id], '开心');
  assert.equal(perf.lines[1].puppetFrom, undefined, 'expression changed: no ease');
  assert.deepEqual(perf.lines[2].puppetParams, { [id]: { lookX: 1 } }, 'command carries');
  assert.equal(perf.lines[2].puppetFrom, undefined);
  assert.equal(perf.lines[3].puppetFrom, undefined, 'same values after the command: no ease');
});

test('the ease is a pure function of line time (smoothstep), missing values use the expression', () => {
  const character = { id: 'c', name: 'A', puppet: normalizePuppetRig({ expressionPresets: { default: { browY: 0.5 } } }) };
  const at = t => linePuppetOverridesAt(character, 'default', { lookX: 1 }, { browY: -0.5 }, t, 0.4);
  assert.deepEqual(at(0), { browY: -0.5, lookX: 0 });
  assert.deepEqual(at(0.2), { browY: 0, lookX: 0.5 });
  assert.deepEqual(at(0.4), { lookX: 1 });
  assert.deepEqual(at(0.2), at(0.2), 'same time, same values (seek / export safe)');
  assert.deepEqual(linePuppetOverridesAt(character, 'default', { lookX: 1 }, { lookX: 0 }, 0.05, 0), { lookX: 1 }, '0 s = cut');
  assert.equal(linePuppetOverridesAt(character, 'default', undefined, undefined, 0), undefined);
  // Overrides sit on top of the expression preset.
  const state = evaluatePuppet(character, 'default', 'SILENCE', false, { lookX: 1 });
  assert.equal(state.parts.pupils.translateX, 0.03);
  assert.equal(state.values.browY, 0.5);
});

test('script reimport keeps per-line puppet overrides', () => {
  const { p, add } = setup();
  const l = add('你好');
  l.puppetParams = { [p.characters[0].id]: { lookY: 0.4 } };
  const imported = createProject('i'); imported.lines.push(createLine(imported, 'Alice', '你好'));
  const result = reimportScriptPreservingSetup(p, imported).project;
  assert.deepEqual(result.lines[0].puppetParams, l.puppetParams);
});

test('立绘 page edits this line or the expression default, with a transition slider and reset', () => {
  const page = fs.readFileSync(new URL('../web/portrait-workbench.js', import.meta.url), 'utf8');
  assert.match(page, /data-portrait-scope="line"/);
  assert.match(page, /data-portrait-scope="expression"/);
  assert.match(page, /本句恢复跟随表情/);
  assert.match(page, /data-portrait-transition/);
  assert.match(page, /line\.puppetParams\[character\.id\]\[id\] = rounded/);
});
