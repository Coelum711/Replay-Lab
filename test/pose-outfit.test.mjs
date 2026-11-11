import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createProject, createLine, compilePerformance, parseDirectorCommand, formatDirectorCommand,
  resolveBody, characterOutfits, characterPoses, parseBodyLayerName
} from '../dist/index.js';

const L = asset => ({ layers: [{ asset }] });

function arthurProject() {
  const project = createProject('pose');
  const first = createLine(project, '亚瑟', '开始');
  const arthur = project.characters.find(c => c.name === '亚瑟');
  arthur.bodies = {
    '外套/垂手': L('j-down'),
    '外套/抱臂': { layers: [{ asset: 'j-cross-line' }, { asset: 'j-cross-shadow', blend: 'multiply' }] },
    '外套/托腮': { layers: [{ asset: 'j-chin' }, { asset: 'j-chin-hand', front: true }] },
    '衬衫/垂手': L('s-down'),
    '衬衫/抱臂': L('s-cross')
  };
  const cmd = text => { const line = createLine(project, '亚瑟', text); line.type = 'command'; line.command = parseDirectorCommand(project, text).command; return line; };
  return { project, arthur, first, cmd };
}

test('outfit × pose resolves with fallbacks to the outfit default, then the default body', () => {
  const { arthur } = arthurProject();
  assert.deepEqual(characterOutfits(arthur), ['外套', '衬衫']);
  assert.deepEqual(characterPoses(arthur, '衬衫'), ['垂手', '抱臂']);
  assert.equal(resolveBody(arthur).key, '外套/垂手');
  assert.equal(resolveBody(arthur, '衬衫', '抱臂').key, '衬衫/抱臂');
  const missing = resolveBody(arthur, '衬衫', '托腮');
  assert.equal(missing.key, '衬衫/垂手');
  assert.equal(missing.fallback, true);
  assert.equal(resolveBody(arthur, '不存在', '抱臂').key, '外套/抱臂');
  const chin = resolveBody(arthur, '外套', '托腮');
  assert.deepEqual(chin.back.map(l => l.asset), ['j-chin']);
  assert.deepEqual(chin.front.map(l => l.asset), ['j-chin-hand']);
  arthur.defaultOutfit = '衬衫'; arthur.defaultPose = '抱臂';
  assert.equal(resolveBody(arthur).key, '衬衫/抱臂');
  assert.equal(resolveBody({ ...arthur, bodies: {} }), null);
});

test('/pose and /outfit persist like /expression; default clears; expressions stay independent', () => {
  const { project, arthur, first, cmd } = arthurProject();
  const pose = cmd('/pose 亚瑟 抱臂');
  assert.deepEqual(pose.command, { kind: 'pose', target: '亚瑟', characterId: arthur.id, value: '抱臂' });
  assert.equal(formatDirectorCommand(project, pose.command), '/pose 亚瑟 抱臂');
  assert.match(parseDirectorCommand(project, '/outfit 亚瑟').error, /服装名字/);
  const second = createLine(project, '亚瑟', '第二句');
  const outfit = cmd('/outfit 亚瑟 衬衫');
  const expr = cmd('/expression 亚瑟 惊讶');
  const third = createLine(project, '亚瑟', '第三句');
  const reset = cmd('/pose 亚瑟 default');
  const fourth = createLine(project, '亚瑟', '第四句');
  project.lines = [first, pose, second, outfit, expr, third, reset, fourth];
  const perf = compilePerformance(project);
  const at = i => perf.lines[i].state;
  assert.equal(at(0).poses, undefined);
  assert.equal(at(2).poses[arthur.id], '抱臂');
  assert.equal(at(5).poses[arthur.id], '抱臂');
  assert.equal(at(5).outfits[arthur.id], '衬衫');
  assert.equal(at(5).expressions[arthur.id], '惊讶');
  assert.equal(at(7).poses?.[arthur.id], undefined);
  assert.equal(at(7).outfits[arthur.id], '衬衫');
});

test('pose precedence: line pose, then trigger words (this line only), then persistent state', () => {
  const { project, arthur, first, cmd } = arthurProject();
  arthur.poseTriggers = { 托腮: ['讲解'] };
  const pose = cmd('/pose 亚瑟 抱臂');
  const explain = createLine(project, '亚瑟', '我来讲解一下');
  explain.speech = { ...(explain.speech ?? {}), acting: { instruct: '讲解的语气' } };
  const after = createLine(project, '亚瑟', '好了');
  const explicit = createLine(project, '亚瑟', '讲解完毕');
  explicit.speech = { ...(explicit.speech ?? {}), acting: { instruct: '讲解' } };
  explicit.pose = '垂手';
  const last = createLine(project, '亚瑟', '最后');
  project.lines = [first, pose, explain, after, explicit, last];
  const perf = compilePerformance(project);
  const poses = perf.lines.map(l => l.state.poses?.[arthur.id] ?? null);
  assert.equal(poses[1], '抱臂');
  assert.equal(poses[2], '托腮', 'trigger words pick the pose for this line');
  assert.equal(poses[3], '抱臂', 'trigger poses do not persist');
  assert.equal(poses[4], '垂手', 'an explicit line pose wins over a trigger');
  assert.equal(poses[5], '垂手', 'an explicit line pose persists');
});

test('instant director commands take no time, so the textbox never drops between lines', () => {
  const { project, first, cmd } = arthurProject();
  const rows = [cmd('/pose 亚瑟 抱臂'), cmd('/expression 亚瑟 惊讶'), cmd('/emote 亚瑟 怒')];
  const next = createLine(project, '亚瑟', '下一句');
  project.lines = [first, ...rows.filter(r => r.command), next];
  const perf = compilePerformance(project);
  for (const line of perf.lines.filter(l => l.type === 'command')) assert.equal(line.duration, 0);
  const nextLine = perf.lines.at(-1);
  assert.equal(nextLine.start, perf.lines.find(l => l.type === 'command').start);
});

test('layer names map to outfit, pose, blend and front', () => {
  assert.deepEqual(parseBodyLayerName('服装_外套'), { outfit: '外套' });
  assert.deepEqual(parseBodyLayerName('手_抱臂'), { pose: '抱臂' });
  assert.deepEqual(parseBodyLayerName('手_托腮_前'), { pose: '托腮', front: true });
  assert.deepEqual(parseBodyLayerName('阴影_手_抱臂'), { pose: '抱臂', blend: 'multiply' });
  assert.deepEqual(parseBodyLayerName('外套/抱臂'), { outfit: '外套', pose: '抱臂' });
  assert.equal(parseBodyLayerName('脸'), null);
});

test('PSD planning: shared body, outfit groups, pose groups, multiply shadow, front hand, face skipped', async () => {
  const { planBodyImport } = await import('../dist/index.js');
  const leaf = (name, extra = {}) => ({ name, ref: name, ...extra });
  // ag-psd order: children bottom → top.
  const tree = [
    leaf('后发'), leaf('身体'), leaf('衬衫'),
    { name: '服装_外套', children: [
      leaf('外套'),
      { name: '手_垂手', children: [leaf('手臂A')] },
      { name: '手_抱臂', children: [leaf('手臂B'), leaf('手臂B线'), leaf('阴影', { blendMode: 'multiply', opacity: 0.6 })] },
      { name: '手_托腮', children: [leaf('手臂C')] },
      { name: '手_托腮_前', children: [leaf('拳头')] }
    ] },
    { name: '服装_衬衫', children: [
      { name: '手_垂手', children: [leaf('袖子A')] },
      { name: '手_抱臂', children: [leaf('袖子B')] }
    ] },
    { name: '脸', children: [leaf('眼睛'), leaf('嘴')] },
    leaf('隐藏', { hidden: true }),
    leaf('前发')
  ];
  const plan = planBodyImport(tree);
  assert.deepEqual(plan.outfits, ['外套', '衬衫']);
  assert.deepEqual(plan.poses, { 外套: ['垂手', '抱臂', '托腮'], 衬衫: ['垂手', '抱臂'] });
  assert.deepEqual(plan.skippedFace, ['眼睛', '嘴']);
  const names = key => plan.bodies[key].map(i => plan.slices[i].sources.map(s => s.ref).join('+'));
  assert.deepEqual(names('外套/抱臂'), ['后发+身体+衬衫', '外套', '手臂B+手臂B线', '阴影', '前发']);
  assert.deepEqual(names('衬衫/抱臂'), ['后发+身体+衬衫', '袖子B', '前发']);
  const shadow = plan.slices.find(s => s.sources[0].ref === '阴影');
  assert.equal(shadow.blend, 'multiply');
  assert.equal(shadow.opacity, 0.6);
  const fist = plan.slices.find(s => s.sources[0].ref === '拳头');
  assert.equal(fist.front, true);
  assert.deepEqual(fist.keys, ['外套/托腮']);
  assert.ok(!plan.slices.some(s => s.sources.some(x => x.ref === '隐藏')));
  // No tags at all: one default body made of everything except the face.
  const flat = planBodyImport([leaf('身体'), { name: '表情', children: [leaf('眼')] }, leaf('影子', { clipping: true })]);
  assert.deepEqual(Object.keys(flat.bodies), ['默认/默认']);
  assert.equal(flat.slices.at(-1).blend, 'clip');
});

test('studio wires the pose / outfit panel, PSD import and the line pose field', () => {
  const html = fs.readFileSync(new URL('../web/studio.html', import.meta.url), 'utf8');
  const js = fs.readFileSync(new URL('../web/studio.js', import.meta.url), 'utf8');
  const panel = fs.readFileSync(new URL('../web/pose-outfit-panel.js', import.meta.url), 'utf8');
  assert.match(html, /id="poseEdit"/);
  assert.match(html, /data-insert-command="pose"/);
  assert.match(html, /data-insert-command="outfit"/);
  assert.match(js, /mountPoseOutfitPanel\(/);
  assert.match(panel, /data-body-import-psd/);
  assert.ok(fs.existsSync(new URL('../web/vendor/ag-psd/bundle.js', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../web/vendor/ag-psd/LICENSE', import.meta.url)));
});
