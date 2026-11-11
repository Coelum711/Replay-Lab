import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { StoryScriptImporter, compilePerformance, createLine, parseDirectorCommand, buildEditBundle } from '../dist/index.js';

function sample() {
  const project = StoryScriptImporter.parse('亚瑟：第一句 ||| 一言目\n王耀：第二句\n亚瑟：第三句', { title: '测试 & 剪辑' });
  project.assets.push(
    { id: 'v1', kind: 'voice', name: 'v1', sourcePath: 'assets/voice/generated/a.wav', metadata: { duration: 1.5 } },
    { id: 'b1', kind: 'bgm', name: '海边.ogg', sourcePath: 'assets/bgm/海边.ogg', metadata: { duration: 2 } },
    { id: 's1', kind: 'sfx', name: 'pop', sourcePath: 'assets/sfx/pop.mp3', metadata: { duration: 0.3 } });
  project.lines[0].audioAssetId = 'v1';
  project.lines[0].scene = { ...(project.lines[0].scene ?? {}), bgm: 'b1' };
  project.lines[1].sfxAssetId = 's1';
  project.characters.find(c => c.name === '王耀').textBlip = { pitch: 560, wave: 'square' };
  for (const line of project.lines.slice(1)) line.duration = 2;
  const cmd = createLine(project, 'Director', '/shake 中 1 随机', 'command'); cmd.command = parseDirectorCommand(project, cmd.text).command; project.lines.splice(1, 0, cmd);
  return compilePerformance(project);
}

test('the FCP7 XML timeline lays out video, textbox stills and audio stems', () => {
  const performance = sample();
  const bundle = buildEditBundle(performance, { fps: 30, width: 1280, height: 720, absoluteRoot: '/Users/me/工程/exports/AEPR_x' });
  const doc = new JSDOM(bundle.xml, { contentType: 'text/xml' }).window.document;
  assert.equal(doc.querySelector('parsererror'), null, 'well-formed XML');
  assert.equal(doc.querySelector('sequence > name').textContent, '测试 & 剪辑');
  const [v1, v2] = [...doc.querySelectorAll('media > video > track')];
  assert.equal(v1.querySelectorAll('clipitem').length, 1);
  assert.equal(v1.querySelector('clipitem > end').textContent, String(Math.round(performance.duration * 30)));
  assert.equal(v2.querySelectorAll('clipitem').length, 3, 'one still per text line, none for the command');
  const [voice, sfx, bgm, ambient] = [...doc.querySelectorAll('media > audio > track')];
  assert.equal(voice.querySelectorAll('clipitem').length, 1);
  assert.equal(voice.querySelector('clipitem > start').textContent, String(Math.round(performance.lines[0].start * 30)));
  assert.equal(sfx.querySelectorAll('clipitem').length, 1);
  assert.ok(bgm.querySelectorAll('clipitem').length >= 2, 'a looping bed becomes back-to-back clips');
  assert.equal(ambient.querySelectorAll('clipitem').length, 0);
  const paths = [...doc.querySelectorAll('pathurl')].map(n => decodeURI(n.textContent));
  assert.ok(paths.every(p => p.startsWith('file://localhost/Users/me/工程/exports/AEPR_x/')));
  assert.ok(paths.some(p => p.endsWith('音频/BGM/海边.ogg')) && paths.some(p => p.endsWith('音频/配音/0001_亚瑟.wav')));
  assert.ok(!bundle.files.some(f => String(f.assetId).startsWith('blip:')), 'typing blips stay in the mixed video');
  const defined = [...doc.querySelectorAll('file')].filter(n => n.querySelector('pathurl')).map(n => n.getAttribute('id'));
  assert.equal(new Set(defined).size, defined.length, 'each file is fully defined only once');
  const referenced = [...doc.querySelectorAll('file')].filter(n => !n.querySelector('pathurl')).map(n => n.getAttribute('id'));
  assert.ok(referenced.length > 0 && referenced.every(id => defined.includes(id)), 'later clips point back to a defined file');
});

test('subtitles carry display text and spoken text separately', () => {
  const bundle = buildEditBundle(sample(), { width: 1280, height: 720 });
  const first = bundle.srt.split('\n\n')[0].split('\n');
  assert.equal(first[0], '1');
  assert.match(first[1], /^00:00:00,000 --> 00:00:0\d,\d{3}$/);
  assert.equal(first[2], '亚瑟：第一句');
  assert.match(bundle.srtSpoken, /亚瑟：一言目/);
  assert.equal(bundle.srt.split('\n\n').filter(Boolean).length, 3);
  assert.ok(bundle.xml.includes('<pathurl>%E7%94%BB%E9%9D%A2'), 'relative paths when no absolute root is known');
  assert.match(bundle.readme, /Premiere/);
});
