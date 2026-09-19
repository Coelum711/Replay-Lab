import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseStoryScript,
  createDefaultImporterRegistry,
  createProject,
  wheelEventFromHistoryRecord,
  appendWheelHistoryToProject,
  compilePerformance,
  VNReplayRuntime
} from '../dist/index.js';

test('0.28 story-script importer turns prose, scene/cast declarations, actions and dialogue into Replay lines', () => {
  const project = parseStoryScript(`意识体总是收到各种奇怪的邀请。\n当前场景：候车厅\n角色：安东尼奥 罗维诺 费里西安诺\n安东尼奥：呜哇——这么热闹啊？\n【罗维诺躲到了费里西安诺身后】\n罗维诺：谁会想你啊！`, '恋综');
  assert.equal(project.lines.length, 4);
  assert.equal(project.lines[0].type, 'narration');
  assert.equal(project.lines[0].text, '意识体总是收到各种奇怪的邀请。');
  assert.equal(project.lines[1].sceneTitle, '候车厅');
  assert.equal(project.lines[2].sceneTitle, '', 'scene title is a boundary, not repeated on every line');
  assert.equal(project.lines[2].type, 'narration');
  assert.equal(project.lines[2].text, '【罗维诺躲到了费里西安诺身后】');
  assert.equal(project.lines[1].stageMode, 'auto', '角色：声明场景角色表，不应强制所有人同时上镜');
  assert.deepEqual(project.lines[1].stageIds, []);
  assert.deepEqual(project.lines[1].scene.enterIds, []);
  assert.deepEqual(project.lines[1].metadata.declaredCastNames, ['安东尼奥','罗维诺','费里西安诺']);
  const perf = compilePerformance(project);
  assert.ok(perf.lines.every(line => line.stage.length <= project.settings.maxOnStage), '自动舞台不会把整个角色表叠到同一画面');
  assert.equal(project.characters.find(c => c.id === project.lines[1].speakerId)?.name, '安东尼奥');
});


test('0.28 default importer auto-detection prefers story scripts over generic speaker logs', () => {
  const input = `意识体总是收到各种奇怪的邀请。
当前场景：候车厅
角色：安东尼奥 罗维诺 费里西安诺
安东尼奥：呜哇——这么热闹啊？
【罗维诺躲到了费里西安诺身后】`;
  const registry = createDefaultImporterRegistry();
  const importer = registry.choose(input, { sourceName: '恋综第一幕.txt' });
  assert.equal(importer?.id, 'story-script');
  const project = importer.parse(input, { title: '恋综第一幕', sourceName: '恋综第一幕.txt' });
  assert.equal(project.lines[0].type, 'narration');
  assert.equal(project.lines[1].sceneTitle, '候车厅');
  assert.ok(!project.characters.some(c => c.name === '当前场景' || c.name === '角色'));
});

const wheelArchive = {
  chars: [
    { id:'a', name:'亚瑟', status:'存活' },
    { id:'m', name:'马修', status:'存活' },
    { id:'f', name:'弗朗西斯', status:'存活' }
  ],
  singleWeights: { a:2, m:1, f:1 },
  events: [{ id:'date', name:'一日情侣', slotA:'A位', slotB:'B位', allowSame:false, members:{ a:{mode:'both',weightA:2,weightB:1}, m:{mode:'both',weightA:1,weightB:2}, f:{mode:'both',weightA:1,weightB:1} } }],
  settings: { partySourceEventId:'date' },
  history: [
    { id:'h3', type:'party', timestamp:'2026-09-03T00:00:00Z', group:'主线', day:1, round:3, eventId:'date', title:'亚瑟 × 马修 × 弗朗西斯 → 一日情侣', detail:'多人事件 · 3 人', participantIds:['a','m','f'] },
    { id:'h2', type:'draw', timestamp:'2026-09-02T00:00:00Z', group:'主线', day:1, round:2, eventId:'date', title:'亚瑟 → 马修', detail:'一日情侣 · A位/B位', aId:'a', bId:'m' },
    { id:'h1', type:'single', timestamp:'2026-09-01T00:00:00Z', group:'主线', day:1, round:1, title:'当前视角：亚瑟 × 马修', detail:'普通人物盘 · 2 人', participantIds:['a','m'] }
  ]
};

test('0.28 wheel history reproduces recorded results and reveals multi-person draws one by one', () => {
  const event = wheelEventFromHistoryRecord(wheelArchive, wheelArchive.history[2]);
  assert.equal(event.mode, 'history');
  assert.equal(event.steps.length, 2);
  assert.deepEqual(event.steps.map(s => s.resultId), ['a','m']);
  assert.ok(event.steps[0].options.some(o => o.id === 'a' && o.weight === 2));
  assert.ok(!event.steps[1].options.some(o => o.id === 'a'), 'without-replacement replay removes the first result from the next wheel');
  const party = wheelEventFromHistoryRecord(wheelArchive, wheelArchive.history[0]);
  assert.equal(party.steps.length, 3, 'party event is not faked as a one-option final wheel');
  assert.deepEqual(party.steps.map(s => s.resultId), ['a','m','f']);
});

test('0.28 wheel archive appends chronological wheel lines and compiler preserves provenance', () => {
  const project = createProject('wheel');
  const summary = appendWheelHistoryToProject(project, wheelArchive);
  assert.equal(summary.imported, 3);
  assert.equal(project.lines[0].wheel.source.recordId, 'h1');
  assert.equal(project.lines[1].wheel.source.recordId, 'h2');
  assert.equal(project.lines[2].wheel.source.recordId, 'h3');
  assert.ok(project.lines.every(line => line.type === 'wheel' && line.mouth === 'off'));
  const perf = compilePerformance(project);
  assert.equal(perf.version, '0.53');
  assert.equal(perf.lines[1].wheel.steps[0].resultLabel, '亚瑟');
});

test('0.28 VN runtime separates playback state from rendering and blocks AUTO on interactive events', async () => {
  const perf = {
    format:'ReplayLabPerformance', version:'0.28', title:'test', settings:{}, characters:[], assets:[], mediaDefinitions:[], duration:2,
    lines:[
      { speakerName:'旁白', text:'one', type:'narration', duration:1, wheel:null },
      { speakerName:'系统', text:'pick', type:'wheel', duration:1, wheel:{mode:'interactive',blockingAuto:true,steps:[]} }
    ]
  };
  const shown=[];
  const renderer={ async renderLine(i,t){shown.push([i,t])} };
  const player={ stop(){}, async playLine(i){shown.push(['play',i])} };
  const runtime=new VNReplayRuntime(perf,renderer,player,{}, {autoDelayMs:0,skipDelayMs:35});
  await runtime.start(0);
  await runtime.next();
  runtime.setAuto(true);
  await new Promise(r=>setTimeout(r,60));
  assert.equal(runtime.index,1,'interactive wheel blocks automatic advance');
  assert.deepEqual(runtime.backlog().map(e=>e.index),[0,1]);
  runtime.stop();
});

test('0.28 Studio exposes in-place VN playtest, wheel history import and playable-web publishing', async () => {
  const html=await readFile(new URL('../web/studio.html', import.meta.url),'utf8');
  const js=await readFile(new URL('../web/studio.js', import.meta.url),'utf8');
  const player=await readFile(new URL('../web/player.js', import.meta.url),'utf8');
  assert.match(html,/id="playtestHere"/);assert.match(html,/id="playtestScene"/);assert.match(html,/id="playtestStart"/);
  assert.match(html,/id="playtestAuto"/);assert.match(html,/id="playtestSkip"/);assert.match(html,/id="playtestBacklog"/);
  assert.match(html,/id="importWheelHistory"/);assert.match(html,/id="exportPlayable"/);
  assert.match(js,/new VNReplayRuntime/);assert.match(js,/appendWheelHistoryToProject/);assert.match(js,/runtime-files\.json/);
  assert.match(player,/new VNReplayRuntime/);assert.match(player,/performance\.json/);assert.match(player,/runtime\.start\(0\)/);
});
