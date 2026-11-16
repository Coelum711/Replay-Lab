import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { moveCurveValue, stageMoveProgress, parseMoveWords, parseMoveCurve, formatMoveWords, curveBezier, normalizeStageMove, MOVE_CURVE_PRESETS,
  StoryScriptImporter, compilePerformance, createLine, parseDirectorCommand, formatDirectorCommand } from '../dist/index.js';

test('every curve starts at 0 and ends at 1; overshoot curves leave the 0..1 band', () => {
  for (const { key } of MOVE_CURVE_PRESETS) { assert.equal(moveCurveValue(key, 0), 0, key); assert.equal(moveCurveValue(key, 1), 1, key); }
  assert.ok(Math.abs(moveCurveValue('linear', 0.37) - 0.37) < 1e-3);
  const sample = curve => Array.from({ length: 101 }, (_, i) => moveCurveValue(curve, i / 100));
  assert.ok(Math.max(...sample('snap')) > 1.05, '急停 overshoots');
  assert.ok(Math.min(...sample('anticipate')) < -0.05, '蓄力 pulls back first');
  assert.ok(Math.max(...sample('spring')) > 1.05 && Math.abs(moveCurveValue('spring', 0.999) - 1) < 0.02, '弹簧 wobbles and settles');
  assert.ok(moveCurveValue('easeOut', 0.2) > moveCurveValue('easeIn', 0.2));
  assert.ok(Math.abs(moveCurveValue('bezier(0.25,0.25,0.75,0.75)', 0.6) - 0.6) < 1e-3, 'a straight bezier is linear');
});

test('progress follows delay and duration; cuts have none', () => {
  const move = { mode: 'move', duration: 0.5, delay: 0.2, curve: 'linear' };
  assert.equal(stageMoveProgress(move, 0.1), 0);
  assert.ok(Math.abs(stageMoveProgress(move, 0.45) - 0.5) < 1e-3);
  assert.equal(stageMoveProgress(move, 2), 1);
  assert.equal(stageMoveProgress({ ...move, mode: 'cut' }, 0.3), null);
  assert.equal(stageMoveProgress(null, 0.3), null);
  assert.deepEqual(normalizeStageMove({ mode: 'move', duration: 99, curve: 'nope' }), { mode: 'move', duration: 10, delay: 0, curve: 'easeOut' });
});

test('/move words: seconds, curve, delay; no seconds means a cut', () => {
  assert.deepEqual(parseMoveWords(['0.25s', '急停', '延迟0.5']), { move: { mode: 'move', duration: 0.25, delay: 0.5, curve: 'snap' } });
  assert.deepEqual(parseMoveWords([]), { move: null });
  assert.deepEqual(parseMoveWords(['瞬移']), { move: null });
  assert.equal(parseMoveWords(['曲线(.2,1.6,.35,1)']).move.curve, 'bezier(0.2,1.6,0.35,1)');
  assert.match(parseMoveWords(['乱写']).error, /看不懂/);
  assert.equal(parseMoveCurve('缓出'), 'easeOut');
  assert.deepEqual(curveBezier('bezier(0.2,1.6,0.35,1)'), [0.2, 1.6, 0.35, 1]);
  assert.equal(formatMoveWords({ mode: 'move', duration: 0.25, delay: 0.5, curve: 'snap' }), '0.25s 急停 延迟0.5');
});

function sample() {
  const p = StoryScriptImporter.parse('亚瑟：左\n亚瑟：右\n亚瑟：再左\n亚瑟：不动', { title: '移动' });
  const id = p.characters[0].id;
  p.lines.forEach((line, i) => { line.duration = 1; line.stagePositions = { [id]: ['left', 'right', 'left', 'left'][i] }; });
  return { p, id };
}

test('the compiler resolves line moves, the project default and /move glides', () => {
  const { p, id } = sample();
  p.settings.stageMoveDefault = { mode: 'move', duration: 0.3, delay: 0, curve: 'easeOut' };
  p.lines[1].stageMove = { mode: 'move', duration: 0.5, delay: 0, curve: 'snap' };
  p.lines[3].stageMove = { mode: 'cut', duration: 0.3, delay: 0, curve: 'easeOut' };
  const cmd = createLine(p, 'Director', '/move 亚瑟 左 0.4s 蓄力 延迟0.2', 'command');
  cmd.command = parseDirectorCommand(p, cmd.text).command;
  p.lines.splice(2, 0, cmd);
  assert.equal(formatDirectorCommand(p, cmd.command), '/move 亚瑟 left 0.4s 蓄力 延迟0.2');
  const shown = compilePerformance(p).lines.filter(line => line.duration > 0);
  assert.equal(shown[0].stageMove.curve, 'easeOut', 'project default');
  assert.equal(shown[1].stageMove.curve, 'snap', 'line setting wins');
  assert.deepEqual(shown[2].actorMoves[id], { mode: 'move', duration: 0.4, delay: 0.2, curve: 'anticipate' }, '/move attaches to the next shown line');
  assert.equal(shown[3].stageMove, undefined, 'explicit cut beats the default');
});

test('plain /move still parses as before, Chinese positions work, and old projects stay cuts', () => {
  const { p } = sample();
  assert.deepEqual(parseDirectorCommand(p, '/move 亚瑟 right').command.move, undefined);
  assert.equal(parseDirectorCommand(p, '/move 亚瑟 右').command.position, 'right');
  assert.equal(parseDirectorCommand(p, '/move 亚瑟 0.3s').command.move.duration, 0.3);
  assert.match(parseDirectorCommand(p, '/move 亚瑟 上天').error, /未知站位/);
  assert.ok(compilePerformance(p).lines.every(line => !line.stageMove && !line.actorMoves));
});

test('the renderer eases from the previous shown line', async () => {
  const src = await readFile(new URL('../src/renderers/canvas-stage.ts', import.meta.url), 'utf8');
  assert.match(src, /stageMoveProgress\(line\.actorMoves\?\.\[actor\.characterId\] \?\? line\.stageMove, localTime\)/);
  assert.match(src, /private previousActorRect\(/);
});
