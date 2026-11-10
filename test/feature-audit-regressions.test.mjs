import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultImporterRegistry, importVirtualFolder, parsePlainTextLog, RplGenImporter, createProject, createLine, ensureCharacter, compilePerformance, normalizeReplayProject, syncDirectorCommandLine, deleteLinesStructureAware, buildAudioSchedule } from '../dist/index.js';

const registry = createDefaultImporterRegistry();
const file = (relativePath, body, type = 'text/plain') => ({ relativePath, name: relativePath.split('/').pop(), type, text: async () => body });
const names = (project, ids) => ids.map(id => project.characters.find(c => c.id === id)?.name);
const add = (project, speaker, text, type) => { const line = createLine(project, speaker, text, type); project.lines.push(line); return line; };

test('Chinese RGL is recognized from a file and from pasted text', () => {
  const rgl = '[张三]:你好\n[李四.开心]<replace=0>:世界\n';
  assert.equal(registry.choose(rgl, { sourceName: 'a.rgl' })?.id, 'rplgen-rgl');
  assert.equal(registry.choose(rgl)?.id, 'rplgen-rgl');
});

test('classic Cocofolia HTML is not imported as plain text', () => {
  const html = '<!DOCTYPE html>\n<html>\n<body>\n<p style="color:#888;">\n  <span> [main]</span>\n  <span>Alice</span> :\n  <span>hello</span>\n</p>\n</body></html>';
  assert.equal(registry.choose(html, { sourceName: 'log.html' })?.id, 'ccfolia-html');
});

test('folder import ignores manifests and non-log JSON, and remaps multi-actor rows', async () => {
  const result = await importVirtualFolder([file('r/project.replaylab.json', '{\n "format": "ReplayLabProject"\n}'), file('r/config.json', '{\n "width": 1\n}'), file('r/a.rgl', '[Alice,Bob]:hi\n')], registry);
  assert.deepEqual(result.ignored.sort(), ['r/config.json', 'r/project.replaylab.json']);
  assert.equal(result.project.lines.length, 1);
  assert.deepEqual(names(result.project, compilePerformance(normalizeReplayProject(result.project)).lines[0].state.roster), ['Alice', 'Bob']);
});

test('folder import classifies by path words, not substrings', async () => {
  const paths = { 'r/characters/house.png': 'character', 'r/背景/城市.png': 'background', 'r/bg_01.png': 'background', 'r/语音/1.wav': 'voice', 'r/音乐/a.mp3': 'bgm' };
  const { project } = await importVirtualFolder(Object.keys(paths).map(p => file(p, '', 'image/png')), registry);
  for (const asset of project.assets) assert.equal(asset.kind, paths[asset.sourcePath], asset.sourcePath);
});

test('RGL expression applies and wait is in frames', () => {
  const project = normalizeReplayProject(RplGenImporter.parse('[Alice.happy]:hi\n<wait>:30\n', {}));
  const doc = compilePerformance(project);
  assert.equal(doc.lines[0].expression, 'happy');
  assert.equal(doc.lines[0].duration, 1);
});

test('plain text keeps [Name] speakers and URLs stay in the message', () => {
  assert.deepEqual(parsePlainTextLog('[Alice] hello\n[12:30] Bob: hi'), [{ speaker: 'Alice', text: 'hello' }, { speaker: 'Bob', text: 'hi' }]);
  assert.deepEqual(parsePlainTextLog('张三：看\nhttps://a.example/b'), [{ speaker: '张三', text: '看\nhttps://a.example/b' }]);
});

test('explicit stage honours exit, dismiss and new speakers', () => {
  const project = createProject('t');
  const a = ensureCharacter(project, 'A'), b = ensureCharacter(project, 'B');
  const first = add(project, 'A', '1'); first.scene.enterIds = [a.id, b.id];
  const leave = add(project, '导演', '/dismiss B', 'command'); syncDirectorCommandLine(project, leave);
  add(project, 'A', '2');
  add(project, 'C', '3');
  const solo = add(project, 'A', '4'); solo.scene.exitIds = [a.id];
  const rosters = compilePerformance(project).lines.map(line => names(project, line.state.roster));
  assert.deepEqual(rosters, [['A', 'B'], ['A'], ['A'], ['A', 'C'], ['C']]);
});

test('/move with a position changes the slot', () => {
  const project = createProject('t');
  add(project, 'A', '1'); add(project, 'B', '2');
  const move = add(project, '导演', '/move A right', 'command'); syncDirectorCommandLine(project, move);
  add(project, 'A', '3');
  const doc = compilePerformance(project);
  assert.equal(doc.lines[1].stage.find(s => s.name === 'A').position, 'left');
  assert.equal(doc.lines[3].stage.find(s => s.name === 'A').position, 'right');
});

test('custom staging keeps the established sides', () => {
  const project = createProject('t');
  const a = ensureCharacter(project, 'A'), b = ensureCharacter(project, 'B');
  add(project, 'A', '1').stagePositions = { [a.id]: 'right' };
  add(project, 'B', '2');
  const custom = add(project, 'A', '3'); custom.stageMode = 'custom'; custom.stageIds = [a.id, b.id];
  assert.equal(compilePerformance(project).lines[2].stage.find(s => s.name === 'A').position, 'right');
});

test('deleting a row hands its background to the next row without overriding it', () => {
  const project = createProject('t');
  const first = add(project, 'A', '1'); first.scene.background = 'bg1';
  const second = add(project, 'A', '2');
  deleteLinesStructureAware(project, new Set([first.id]));
  assert.equal(second.scene.background, 'bg1');
});

test('voice only clips at line end when the author fixed the duration', () => {
  const project = createProject('t');
  project.assets.push({ id: 'v', kind: 'voice', name: 'v', metadata: { duration: 5 } });
  const fixed = add(project, 'A', '1'); fixed.audioAssetId = 'v'; fixed.duration = 1;
  const natural = add(project, 'A', '2'); natural.audioAssetId = 'v';
  const [a, b] = buildAudioSchedule(compilePerformance(project)).filter(e => e.kind === 'voice');
  assert.equal(a.end, 1);
  assert.equal(b.end, undefined);
});
