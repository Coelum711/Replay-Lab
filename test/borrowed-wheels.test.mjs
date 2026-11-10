import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { StoryScriptImporter, discoverFolderAssets, assetKindForPath, compilePerformance, createLine, parseDirectorCommand, triggeredExpression, lineMoodText } from '../dist/index.js';
import { buildAudioSchedule } from '../dist/renderers/browser-media.js';

test('files dropped into asset folders are discovered once, by folder and medium', () => {
  const project = StoryScriptImporter.parse('亚瑟：一', { title: 't' });
  project.assets.push({ id: 'a1', kind: 'sfx', name: 'old', sourcePath: 'assets/sfx/old.ogg', uri: 'project://assets/sfx/old.ogg' });
  const files = ['assets/sfx/old.ogg', 'assets/sfx/punch.ogg', 'assets/sfx/.DS_Store', 'assets/sfx/cover.png', 'assets/bgm/sea/wave.mp3',
    'assets/characters/亚瑟_怒.png', 'assets/voice/generated/x.wav', 'assets/other/readme.txt', 'project.replaylab.json'].map(path => ({ path, size: 10 }));
  const found = discoverFolderAssets(project, files);
  assert.deepEqual(found.map(a => [a.kind, a.name, a.sourcePath]), [['sfx', 'punch', 'assets/sfx/punch.ogg'], ['bgm', 'wave', 'assets/bgm/sea/wave.mp3'], ['character', '亚瑟_怒', 'assets/characters/亚瑟_怒.png']]);
  assert.equal(found[0].mime, 'audio/ogg');
  assert.equal(assetKindForPath('assets/ambient/rain.ogg'), 'ambient');
  project.assets.push(...found);
  assert.equal(discoverFolderAssets(project, files).length, 0, 'a second scan finds nothing new');
});

test('sprite states switch from a line on, and emotion words pick a sprite for one line', () => {
  const project = StoryScriptImporter.parse('亚瑟[压着火气]：你说什么\n亚瑟：算了\n弗朗西斯：哼\n亚瑟：再说一遍', { title: 't' });
  const arthur = project.characters.find(c => c.name === '亚瑟'), francis = project.characters.find(c => c.name === '弗朗西斯');
  arthur.expressions = { angry: { idle: 'a' } }; francis.expressions = { smug: { idle: 'b' } };
  arthur.expressionTriggers = { angry: ['火气', '生气'] };
  project.lines[2].scene = { ...(project.lines[2].scene ?? {}), expressions: { [francis.id]: 'smug' } };
  const lines = compilePerformance(project).lines;
  assert.equal(lines[0].state.expressions[arthur.id], 'angry', 'tagged line uses the triggered sprite');
  assert.equal(lines[0].expression, 'angry');
  assert.notEqual(lines[1].state.expressions[arthur.id], 'angry', 'the trigger does not carry over');
  assert.deepEqual([lines[1], lines[2], lines[3]].map(l => l.state.expressions[francis.id] ?? 'default'), ['default', 'smug', 'smug'], 'a state change persists');
  assert.equal(triggeredExpression({ sad: ['哭'] }, '快哭了'), 'sad');
  assert.match(lineMoodText(project.lines[0]), /压着火气/);
});

test('a line sound can start a few seconds into the line', () => {
  const project = StoryScriptImporter.parse('亚瑟：一句很长的话', { title: 't' });
  project.assets.push({ id: 's1', kind: 'sfx', name: 'punch' });
  project.lines[0].duration = 3; project.lines[0].sfxAssetId = 's1'; project.lines[0].audioMix = { sfxOffset: 1.2 };
  const performance = compilePerformance(project);
  const event = buildAudioSchedule(performance).find(e => e.assetId === 's1');
  assert.ok(Math.abs(event.start - (performance.lines[0].start + 1.2)) < 1e-6);
});

test('sound picker filters by folder, auditions and applies with volume and delay', async () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  Object.assign(globalThis, { document: dom.window.document, Audio: class { play() { return Promise.resolve(); } pause() {} } });
  const { createSoundPicker } = await import('../web/sound-picker.js');
  const project = StoryScriptImporter.parse('亚瑟：一', { title: 't' });
  project.assets.push({ id: 's1', kind: 'sfx', name: 'punch' }, { id: 's2', kind: 'sfx', name: 'bell' }, { id: 'b1', kind: 'bgm', name: 'sea' });
  const applied = [], inserted = [], beds = [];
  const picker = createSoundPicker({ getProject: () => project, resolveAsset: async () => 'blob:x', applyLineSound: (line, patch) => applied.push(patch), insertCommand: text => inserted.push(text), startBed: (line, kind, id) => beds.push([kind, id]) });
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  picker.open(project.lines[0], { lineNumber: 1 });
  assert.deepEqual($$('[data-sound-item]').map(r => r.textContent.replace(/[▶■]/g, '')), ['bell', 'punch']);
  $('[data-sound-search]').value = 'pun'; $('[data-sound-search]').dispatchEvent(new dom.window.Event('input'));
  assert.equal($$('[data-sound-item]').length, 1);
  $('[data-sound-item]').click();
  $('[data-sound-volume]').value = '60'; $('[data-sound-delay]').value = '0.8';
  $('[data-sound-apply]').click();
  assert.deepEqual(applied, [{ assetId: 's1', gain: 0.6, pan: 0, offset: 0.8 }]);
  assert.equal($('[data-sound-picker]'), null, 'closes after applying');
  picker.open(project.lines[0], { lineNumber: 1, kind: 'bgm' });
  $('[data-sound-item]').click(); $('[data-sound-bed]').click();
  assert.deepEqual(beds, [['bgm', 'b1']]);
  picker.open(project.lines[0], { lineNumber: 1, kind: 'bgm' });
  $('[data-sound-stop]').click();
  assert.deepEqual(inserted, ['/bgm stop']);
});

test('animation workbench lists the commands before a line and edits them in place', async () => {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>');
  Object.assign(globalThis, { document: dom.window.document });
  const { renderAnimationWorkbench } = await import('../web/animation-workbench.js');
  const project = StoryScriptImporter.parse('亚瑟：一\n弗朗西斯：二', { title: 't' });
  const add = (at, text) => { const line = createLine(project, 'Director', text, 'command'); line.command = parseDirectorCommand(project, text).command; project.lines.splice(at, 0, line); };
  add(1, '/shake 中 2 随机'); add(2, '/emote 弗朗西斯 汗 1.6');
  const performance = compilePerformance(project);
  const calls = [];
  const ctx = { project, line: project.lines[3], index: 3, perf: performance.lines[3], performance,
    preview: i => calls.push(['preview', i]), insertAt: (at, text) => calls.push(['insert', at, text]), setText: (at, text) => calls.push(['set', at, text]),
    move: () => {}, remove: at => calls.push(['remove', at]), jumpToSource: () => {}, openSound: () => {} };
  const host = document.querySelector('#host');
  renderAnimationWorkbench(host, ctx);
  assert.equal(host.querySelectorAll('[data-anim-command]').length, 2);
  const seconds = host.querySelector('[data-anim-shake-seconds] input') ?? host.querySelector('input[data-anim-shake-seconds]');
  seconds.value = '3'; seconds.dispatchEvent(new dom.window.Event('change'));
  assert.deepEqual(calls.at(-1), ['set', 1, '/shake 12 3 随机 14']);
  assert.equal(parseDirectorCommand(project, calls.at(-1)[2]).command.duration, 3);
  const mark = host.querySelector('select[data-anim-emote-mark]'); mark.value = '怒'; mark.dispatchEvent(new dom.window.Event('change'));
  assert.deepEqual(calls.at(-1), ['set', 2, '/emote 弗朗西斯 怒 1.6']);
  host.querySelector('[data-anim-add="闪屏"]').click();
  assert.deepEqual(calls.at(-1), ['insert', 3, '/flash white 0.3'], 'new effects land right before the line');
  renderAnimationWorkbench(host, { ...ctx, line: project.lines[1], index: 1, perf: performance.lines[1] });
  assert.equal(host.querySelectorAll('[data-anim-command]').length, 2, 'selecting a command edits its whole block');
});

test('RPG Maker export writes Ogg Vorbis with readable file names', async () => {
  const { encodeOggVorbis, rpgMakerFileName } = await import('../web/rpgmaker-export.js');
  assert.equal(rpgMakerFileName('伊万', 20, '唉～意大利不记得了吗？'), '伊万_第20行_唉意大利不记得了.ogg');
  assert.equal(rpgMakerFileName('熊二郎', 3, '{抖}你是谁{/抖}？'), '熊二郎_第3行_你是谁.ogg', 'text tags never reach file names');
  assert.equal(rpgMakerFileName('a/b', 1, ''), 'ab_第1行.ogg');
  const samples = new Float32Array(24000); for (let i = 0; i < samples.length; i++) samples[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / 24000);
  const ogg = await encodeOggVorbis([samples], 24000);
  assert.equal(String.fromCharCode(...ogg.slice(0, 4)), 'OggS');
  assert.ok(Buffer.from(ogg).includes(Buffer.from('vorbis')), 'Vorbis stream, the codec RPG Maker MZ decodes');
});

test('every web module import uses a file type the desktop protocol serves as JavaScript', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  const served = new Set([...main.match(/const mime=\{([^}]*)\}/)[1].matchAll(/'(\.[a-z0-9]+)':'(?:text\/javascript|application\/javascript)'/g)].map(m => m[1]));
  const bad = [];
  for (const name of (await readdir(new URL('../web/', import.meta.url))).filter(n => n.endsWith('.js'))) {
    const source = await readFile(new URL(`../web/${name}`, import.meta.url), 'utf8');
    for (const m of source.matchAll(/(?:import|from)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const ext = m[1].match(/\.[a-z0-9]+$/i)?.[0]?.toLowerCase();
      if (!served.has(ext)) bad.push(`${name} → ${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], 'module scripts with other extensions fail to load in the app (strict MIME check)');
});
