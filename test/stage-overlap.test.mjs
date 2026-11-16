import test from 'node:test';
import assert from 'node:assert/strict';
import { StoryScriptImporter, compilePerformance, stageSlotX } from '../dist/index.js';

const xs = line => line.stage.map((actor, i) => [actor.name, actor.transform ? actor.transform.x : stageSlotX(actor.position, line.stage.length, i, line.stage.map(a => a.position))]);

function project() {
  const p = StoryScriptImporter.parse('甲：一\n乙：二\n甲：三\n乙：四', { title: '重叠' });
  const [a, b] = p.characters.map(c => c.id);
  p.lines.forEach(line => { line.duration = 1; line.stageMode = 'custom'; });
  return { p, a, b };
}

test('a character coming back does not land on someone standing there (第40句)', () => {
  const { p, a, b } = project();
  p.lines[0].stageIds = [a]; p.lines[0].stagePositions = { [a]: 'center' }; p.lines[0].stageTransforms = { [a]: { x: 0.18, y: 0.88, scale: 1 } };
  p.lines[1].stageIds = [b]; p.lines[1].stagePositions = { [b]: 'left' };
  p.lines[2].stageIds = [b, a]; p.lines[2].stagePositions = { [b]: 'left', [a]: 'right' };
  p.lines[3].stageIds = [a]; p.lines[3].stagePositions = { [a]: 'center' };
  const lines = compilePerformance(p).lines;
  assert.deepEqual(xs(lines[2]), [['乙', 0.22], ['甲', 0.78]], 'moves to its own slot instead of 0.18');
  assert.equal(lines[3].stage[0].transform.x, 0.78, 'and stays there afterwards');
});

test('a dragged layout is kept while nobody collides', () => {
  const { p, a, b } = project();
  p.lines[0].stageIds = [a, b]; p.lines[0].stagePositions = { [a]: 'left', [b]: 'right' };
  p.lines[0].stageTransforms = { [a]: { x: 0.8, y: 0.88, scale: 1 }, [b]: { x: 0.25, y: 0.88, scale: 1 } };
  p.lines[1].stageIds = [b]; p.lines[1].stagePositions = { [b]: 'center' };
  p.lines[2].stageIds = [a, b]; p.lines[2].stagePositions = { [a]: 'left', [b]: 'right' };
  const lines = compilePerformance(p).lines;
  assert.deepEqual(xs(lines[2]), [['甲', 0.8], ['乙', 0.25]], 'the swapped composition survives a character leaving and returning');
});

test('positions set on the line itself are never moved, even when they overlap', () => {
  const { p, a, b } = project();
  p.lines[0].stageIds = [a, b]; p.lines[0].stagePositions = { [a]: 'left', [b]: 'right' };
  p.lines[0].stageTransforms = { [a]: { x: 0.5, y: 0.88, scale: 1 }, [b]: { x: 0.52, y: 0.88, scale: 1 } };
  assert.deepEqual(xs(compilePerformance(p).lines[0]), [['甲', 0.5], ['乙', 0.52]]);
});
