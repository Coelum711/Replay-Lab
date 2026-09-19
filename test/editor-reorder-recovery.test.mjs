import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TextImporter,
  moveSelectedLines,
  moveLinesBefore,
  moveOutlineGroup,
  outlineGroupRange,
  MemoryProjectRecoveryStore
} from '../dist/index.js';

function names(project){ return project.lines.map(line => line.text); }

test('multi-line move preserves relative order', () => {
  const project = TextImporter.parse('A: one\nA: two\nA: three\nA: four');
  const ids = [project.lines[1].id, project.lines[2].id];
  assert.equal(moveSelectedLines(project, ids, -1), true);
  assert.deepEqual(names(project), ['two','three','one','four']);
  assert.equal(moveSelectedLines(project, ids, 1), true);
  assert.deepEqual(names(project), ['one','two','three','four']);
});

test('drag-style move packs selected lines before target', () => {
  const project = TextImporter.parse('A: one\nA: two\nA: three\nA: four\nA: five');
  const ids = [project.lines[1].id, project.lines[3].id];
  const target = project.lines[0].id;
  assert.equal(moveLinesBefore(project, ids, target), true);
  assert.deepEqual(names(project), ['two','four','one','three','five']);
});

test('scene groups move only within their chapter', () => {
  const project = TextImporter.parse('A: a1\nA: a2\nA: b1\nA: b2\nA: c1');
  project.lines[0].chapterTitle='Chapter 1';
  project.lines[0].sceneTitle='Scene A';
  project.lines[2].sceneTitle='Scene B';
  project.lines[4].chapterTitle='Chapter 2';
  project.lines[4].sceneTitle='Scene C';
  assert.deepEqual(outlineGroupRange(project, 0, 'scene'), {start:0,end:1});
  assert.equal(moveOutlineGroup(project, 0, 'scene', 1), true);
  assert.deepEqual(names(project), ['b1','b2','a1','a2','c1']);
  assert.equal(moveOutlineGroup(project, 2, 'scene', 1), false, 'scene cannot cross chapter boundary');
});

test('chapter groups move as complete blocks', () => {
  const project = TextImporter.parse('A: a1\nA: a2\nA: b1\nA: b2');
  project.lines[0].chapterTitle='A';
  project.lines[2].chapterTitle='B';
  assert.equal(moveOutlineGroup(project, 0, 'chapter', 1), true);
  assert.deepEqual(names(project), ['b1','b2','a1','a2']);
  assert.equal(project.lines[0].chapterTitle, 'B');
  assert.equal(project.lines[2].chapterTitle, 'A');
});

test('memory recovery store snapshots project without aliasing', async () => {
  const store = new MemoryProjectRecoveryStore();
  const project = TextImporter.parse('A: original');
  await store.save(project,{label:'临时工程'});
  project.lines[0].text='mutated';
  const recovered = await store.latest();
  assert.equal(recovered.project.lines[0].text,'original');
  recovered.project.lines[0].text='changed again';
  const recovered2 = await store.latest();
  assert.equal(recovered2.project.lines[0].text,'original');
  await store.clear();
  assert.equal(await store.latest(),null);
});

import { buildScriptRenderRows } from '../dist/index.js';

test('script render rows flatten outline and respect collapsed groups', () => {
  const project = TextImporter.parse('A: one\nA: two\nA: three');
  project.lines[0].chapterTitle='C1';
  project.lines[0].sceneTitle='S1';
  project.lines[2].sceneTitle='S2';
  const all = buildScriptRenderRows(project,{activeIndex:1,selectedLineIds:[project.lines[1].id]});
  assert.deepEqual(all.map(r=>r.kind), ['chapter','scene','line','line','scene','line']);
  const s1 = all.find(r=>r.kind==='scene'&&r.label==='S1');
  const collapsed = buildScriptRenderRows(project,{collapsedGroups:[s1.key]});
  assert.deepEqual(collapsed.map(r=>r.kind), ['chapter','scene','scene','line']);
});

import {
  renameChapter,
  renameScene,
  splitChapterAt,
  splitSceneAt,
  mergeSceneWithPrevious,
  mergeChapterWithPrevious,
  moveLinesBeforeStructureAware,
  moveSceneToChapter,
  buildScriptOutline
} from '../dist/index.js';

test('renaming effective chapter/scene edits group boundary instead of creating a split', () => {
  const project = TextImporter.parse('A: one\nA: two\nA: three');
  project.lines[0].chapterTitle='Chapter A';
  project.lines[0].sceneTitle='Scene A';
  assert.equal(renameChapter(project,1,'Chapter Renamed'),true);
  assert.equal(renameScene(project,1,'Scene Renamed'),true);
  assert.equal(project.lines[0].chapterTitle,'Chapter Renamed');
  assert.equal(project.lines[0].sceneTitle,'Scene Renamed');
  assert.ok(!project.lines[1].chapterTitle);
  assert.ok(!project.lines[1].sceneTitle);
});

test('splitting chapter preserves current effective scene name', () => {
  const project = TextImporter.parse('A: one\nA: two\nA: three');
  project.lines[0].chapterTitle='C1';
  project.lines[0].sceneTitle='Warehouse';
  assert.equal(splitChapterAt(project,1,'C2'),true);
  assert.equal(project.lines[1].chapterTitle,'C2');
  assert.equal(project.lines[1].sceneTitle,'Warehouse');
  const outline=buildScriptOutline(project.lines);
  assert.equal(outline[1].chapter,'C2');
  assert.equal(outline[1].scene,'Warehouse');
});

test('scene split and merge preserve neighboring chapter structure', () => {
  const project = TextImporter.parse('A: one\nA: two\nA: three');
  project.lines[0].chapterTitle='C1';
  project.lines[0].sceneTitle='S1';
  assert.equal(splitSceneAt(project,1,'S2'),true);
  assert.equal(buildScriptOutline(project.lines)[2].scene,'S2');
  assert.equal(mergeSceneWithPrevious(project,2),true);
  assert.equal(buildScriptOutline(project.lines)[1].scene,'S1');
  assert.equal(buildScriptOutline(project.lines)[2].scene,'S1');
});

test('chapter merge removes only the chapter boundary', () => {
  const project = TextImporter.parse('A: one\nA: two\nA: three');
  project.lines[0].chapterTitle='C1';
  project.lines[0].sceneTitle='S1';
  project.lines[2].chapterTitle='C2';
  project.lines[2].sceneTitle='S2';
  assert.equal(mergeChapterWithPrevious(project,2),true);
  const outline=buildScriptOutline(project.lines);
  assert.equal(outline[2].chapter,'C1');
  assert.equal(outline[2].scene,'S2');
});

test('line drag into another scene rehomes lines and transfers source marker safely', () => {
  const project = TextImporter.parse('A: a1\nA: a2\nA: b1\nA: b2');
  project.lines[0].chapterTitle='C1';
  project.lines[0].sceneTitle='A';
  project.lines[2].sceneTitle='B';
  const movedId=project.lines[0].id;
  const before=project.lines[3].id;
  assert.equal(moveLinesBeforeStructureAware(project,[movedId],before),true);
  const outline=buildScriptOutline(project.lines);
  assert.deepEqual(project.lines.map(l=>l.text),['a2','b1','a1','b2']);
  assert.equal(outline[0].scene,'A','source scene marker transfers to remaining first line');
  assert.equal(outline[2].scene,'B','moved line adopts destination scene');
});

test('scene can move across chapters without losing its own scene identity', () => {
  const project = TextImporter.parse('A: a1\nA: a2\nA: b1\nA: b2\nA: c1');
  project.lines[0].chapterTitle='C1';
  project.lines[0].sceneTitle='A';
  project.lines[2].sceneTitle='B';
  project.lines[4].chapterTitle='C2';
  project.lines[4].sceneTitle='C';
  assert.equal(moveSceneToChapter(project,2,4),true);
  const outline=buildScriptOutline(project.lines);
  const bIndex=project.lines.findIndex(l=>l.text==='b1');
  assert.equal(outline[bIndex].chapter,'C2');
  assert.equal(outline[bIndex].scene,'B');
  assert.deepEqual(project.lines.map(l=>l.text),['a1','a2','c1','b1','b2']);
});

import { moveLinesOneStepStructureAware, deleteLinesStructureAware } from '../dist/index.js';

test('one-step line movement across a scene boundary adopts destination scene without losing source marker', () => {
  const project = TextImporter.parse('A: a1\nA: a2\nA: b1\nA: b2');
  project.lines[0].chapterTitle='C1';
  project.lines[0].sceneTitle='A';
  project.lines[2].sceneTitle='B';
  const id=project.lines[1].id;
  assert.equal(moveLinesOneStepStructureAware(project,[id],1),true);
  assert.deepEqual(project.lines.map(l=>l.text),['a1','b1','a2','b2']);
  const outline=buildScriptOutline(project.lines);
  assert.equal(outline[2].scene,'B');
  assert.equal(outline[0].scene,'A');
});

test('deleting a scene anchor transfers the boundary to the next surviving line', () => {
  const project = TextImporter.parse('A: a1\nA: a2\nA: b1\nA: b2');
  project.lines[0].chapterTitle='C1';
  project.lines[0].sceneTitle='A';
  project.lines[2].sceneTitle='B';
  assert.equal(deleteLinesStructureAware(project,[project.lines[2].id]),true);
  assert.deepEqual(project.lines.map(l=>l.text),['a1','a2','b2']);
  const outline=buildScriptOutline(project.lines);
  assert.equal(outline[2].scene,'B');
});

test('chapter merge preserves an implicit default scene as a separate scene boundary', () => {
  const project = TextImporter.parse('A: one\nA: two\nA: three\nA: four');
  project.lines[0].chapterTitle='C1';
  project.lines[0].sceneTitle='S1';
  project.lines[2].chapterTitle='C2';
  assert.equal(mergeChapterWithPrevious(project,2),true);
  const outline=buildScriptOutline(project.lines);
  assert.equal(outline[2].chapter,'C1');
  assert.equal(outline[2].scene,'默认 Scene');
  assert.notEqual(outline[1].sceneKey,outline[2].sceneKey);
});
