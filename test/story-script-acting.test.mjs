import test from 'node:test';
import assert from 'node:assert/strict';
import { StoryScriptImporter } from '../dist/index.js';

const parse = text => StoryScriptImporter.parse(text, { title: 't' });
const name = (p, line) => p.characters.find(c => c.id === line.speakerId)?.name;

test('story script emotion tags stay off the speaker name and land on the line', () => {
  const p = parse('当前场景：港口\n角色：亚瑟\n亚瑟[压着火气|强]：滚吧\n亚瑟：普通台词');
  assert.deepEqual(p.characters.filter(c => c.name.includes('亚瑟')).map(c => c.name), ['亚瑟']);
  const [tagged, plain] = p.lines;
  assert.equal(name(p, tagged), '亚瑟');
  assert.equal(tagged.text, '滚吧');
  assert.equal(tagged.speech.acting.actingPreset, 'restrained anger, low and cold, do not shout');
  assert.equal(tagged.speech.acting.actingStrength, 'strong');
  assert.equal(plain.speech?.acting, undefined);
});

test('unknown emotion words and extra notes go to the model as instructions', () => {
  const [line] = parse('亚瑟［愤怒大喊｜最后一句破音］：等一下').lines;
  assert.equal(line.speech.acting.instruct, '愤怒大喊；最后一句破音');
  assert.equal(line.speech.acting.actingPreset, '');
});

test('the voice page shows and saves the imported per-line emotion', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="lineActingPreset"/);
  assert.match(html, /id="lineActingStrength"/);
  assert.match(html, /value="restrained anger, low and cold, do not shout">压着火气/);
  assert.match(app, /actingPreset: \$\('#lineActingPreset'\)\.value, actingStrength: \$\('#lineActingStrength'\)\.value/);
});

test('narration and bracketed dialogue text are left alone', () => {
  const p = parse('[一段旁白]\n【另一段旁白】\n路德维希：【好丢人……】');
  assert.equal(p.lines[0].type, 'narration');
  assert.equal(p.lines[1].type, 'narration');
  assert.equal(p.lines[2].text, '【好丢人……】');
  assert.equal(p.lines[2].speech?.acting, undefined);
});

test('表里 scripts show the first part and speak the second', () => {
  const [both, plain] = parse('亚瑟[压着火气]：滚吧 ||| 失せろ\n亚瑟：只有表文').lines;
  assert.equal(both.text, '滚吧');
  assert.equal(both.speech.textOverride, '失せろ');
  assert.ok(both.speech.acting);
  assert.equal(plain.text, '只有表文');
  assert.equal(plain.speech?.textOverride, undefined);
});
