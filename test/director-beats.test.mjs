import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TextImporter,
  createLine,
  parseDirectorCommand,
  buildDirectorBeats,
  buildScriptRenderRows,
  compilePerformance,
  setDirectorBeatTiming
} from '../dist/index.js';

function commandLine(project, text) {
  const line = createLine(project, 'Director', text, 'command');
  line.command = parseDirectorCommand(project, text).command;
  return line;
}

test('0.45 consecutive director commands derive one collapsible Beat without replacing source rows', () => {
  const project = TextImporter.parse('A: first\nA: second');
  const expression = commandLine(project, '/expression A angry');
  const wait = commandLine(project, '/wait 0.2');
  project.lines.splice(1, 0, expression, wait);

  const beats = buildDirectorBeats(project);
  assert.equal(beats.length, 1);
  assert.deepEqual(beats[0].commandLineIds, [expression.id, wait.id]);
  assert.equal(beats[0].targetLineId, project.lines[3].id);
  assert.match(beats[0].summary, /A → angry/);

  const expanded = buildScriptRenderRows(project, {});
  assert.equal(expanded.filter(row => row.kind === 'beat').length, 1);
  assert.equal(expanded.filter(row => row.kind === 'line' && [expression.id, wait.id].includes(row.lineId)).length, 2);

  const collapsed = buildScriptRenderRows(project, { collapsedGroups: [beats[0].id] });
  assert.equal(collapsed.filter(row => row.kind === 'beat').length, 1);
  assert.equal(collapsed.filter(row => row.kind === 'line' && [expression.id, wait.id].includes(row.lineId)).length, 0);
  assert.ok(collapsed.some(row => row.kind === 'line' && row.lineId === project.lines[3].id));
});

test('0.45 expressions inherit until an explicit line or /expression command changes them', () => {
  const project = TextImporter.parse('A: one\nA: two\nA: three');
  project.lines[0].expression = 'angry';
  project.lines[0].expressionMode = 'set';
  project.lines[1].expression = 'default';
  project.lines[1].expressionMode = 'inherit';
  project.lines[2].expression = 'smile';
  project.lines[2].expressionMode = 'set';

  const perf = compilePerformance(project);
  assert.equal(perf.lines[0].expression, 'angry');
  assert.equal(perf.lines[1].expression, 'angry');
  assert.equal(perf.lines[1].state.characterVisuals[project.lines[1].speakerId].expression, 'angry');
  assert.equal(perf.lines[2].expression, 'smile');
});

test('0.45 persistent CharacterVisualState keeps expression and direct-manipulation transform independently', () => {
  const project = TextImporter.parse('A: one\nA: two');
  const id = project.lines[0].speakerId;
  project.lines[0].expression = 'angry';
  project.lines[0].expressionMode = 'set';
  project.lines[0].stageTransforms = { [id]: { x: 0.31, y: 0.88, scale: 1.08, facing: 'right' } };
  project.lines[1].expressionMode = 'inherit';

  const perf = compilePerformance(project);
  const visual = perf.lines[1].state.characterVisuals[id];
  assert.equal(visual.expression, 'angry');
  assert.equal(visual.facing, 'right');
  assert.equal(visual.transform.x, 0.31);
  assert.equal(visual.transform.scale, 1.08);
});

test('0.45 Auto blocking and existing custom stage motions surface as inspectable Beat changes', () => {
  const project = TextImporter.parse('A: hello\nB: hi');
  project.lines[1].stageMethod = { name: 'shake_minor', duration: 0.5 };
  const perf = compilePerformance(project);
  const secondBeat = perf.directorBeats.find(beat => beat.targetLineId === project.lines[1].id);
  assert.ok(secondBeat);
  assert.ok(secondBeat.changes.some(change => change.kind === 'auto-blocking'));
  assert.ok(secondBeat.changes.some(change => change.kind === 'motion' && /shake_minor/.test(change.label)));
  assert.equal(perf.lines[1].directorBeatId, secondBeat.id);
  assert.equal(perf.lines[1].state.characterVisuals[project.lines[1].speakerId].motion, 'shake_minor');
});


test('0.46 Beat timing is stored on source commands while the Beat remains derived', () => {
  const project = TextImporter.parse('A: first\nA: second');
  const expr = commandLine(project, '/expression A angry');
  const wait = commandLine(project, '/wait 0.2');
  project.lines.splice(1, 0, expr, wait);
  const initial = buildDirectorBeats(project)[0];
  assert.equal(initial.timingMode, 'sequence');
  assert.equal(setDirectorBeatTiming(project, initial.id, 'parallel'), true);
  const parallel = buildDirectorBeats(project)[0];
  assert.equal(parallel.timingMode, 'parallel');
  assert.equal(expr.command.beatMode, 'parallel');
  assert.equal(wait.command.beatMode, 'parallel');
});

test('0.46 parallel Beat cues existing custom motion and camera on the following visible line', () => {
  const project = TextImporter.parse('A: first\nB: second');
  const motion = commandLine(project, '/motion A shake_minor 0.5');
  const camera = commandLine(project, '/camera push');
  project.lines.splice(1, 0, motion, camera);
  const beat = buildDirectorBeats(project)[0];
  setDirectorBeatTiming(project, beat.id, 'parallel');
  const perf = compilePerformance(project);
  assert.equal(perf.directorBeats.find(item => item.id === beat.id)?.timingMode, 'parallel');
  assert.equal(perf.lines[1].duration, 0);
  assert.equal(perf.lines[2].duration, 0);
  assert.equal(perf.lines[1].start, perf.lines[3].start);
  assert.equal(perf.lines[2].start, perf.lines[3].start);
  assert.equal(perf.lines[3].camera, 'push');
  const actorA = perf.lines[3].stage.find(actor => actor.name === 'A');
  assert.equal(actorA?.motion?.name, 'shake_minor');
  assert.equal(actorA?.motion?.duration, 0.5);
});

test('0.46 sequential custom motion remains a blocking command row before dialogue', () => {
  const project = TextImporter.parse('A: first\nB: second');
  const motion = commandLine(project, '/motion A shake_minor 0.45');
  project.lines.splice(1, 0, motion);
  const perf = compilePerformance(project);
  assert.equal(buildDirectorBeats(project)[0].timingMode, 'sequence');
  assert.equal(perf.lines[1].duration, 0.45);
  assert.ok(perf.lines[2].start >= perf.lines[1].end);
  assert.equal(perf.lines[1].speakerName, 'A');
  assert.equal(perf.lines[1].stage.find(actor => actor.name === 'A')?.motion?.name, 'shake_minor');
});
