import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { StoryScriptImporter, compilePerformance, resolveLayers, layerPoseAt, anchorAt, anchorTime, normalizeLayer, WORKSPACE_DIRECTORIES, assetKindForPath } from '../dist/index.js';

function project() {
  const p = StoryScriptImporter.parse('甲：一\n乙：二\n甲：三\n乙：四', { title: '图层' });
  p.lines.forEach(line => { line.duration = 2; });
  p.assets.push({ id: 'img', kind: 'other', name: 'pip.png', uri: 'data:image/png;base64,', metadata: {} });
  const [a, b, c, d] = p.lines.map(line => line.id);
  p.layers = [normalizeLayer({ id: 'L', name: '画中画', assetId: 'img', start: { lineId: b, offset: 0.5 }, end: { lineId: c, offset: null },
    base: { x: 0.2, y: 0.3, width: 0.3, opacity: 1, rotation: 0 },
    keyframes: [{ id: 'k', at: { lineId: c, offset: 1 }, curve: 'linear', x: 0.8 }] })];
  return { p, ids: [a, b, c, d] };
}

test('layer times come from their lines, so re-rolled voice moves them along', () => {
  const { p, ids } = project();
  const check = () => {
    const perf = compilePerformance(p), [, b, c] = perf.lines, layer = perf.layers[0];
    assert.ok(Math.abs(layer.start - (b.start + 0.5)) < 1e-9); assert.ok(Math.abs(layer.end - c.end) < 1e-9); assert.ok(Math.abs(layer.keyframes[0].time - (c.start + 1)) < 1e-9);
    return layer;
  };
  const before = check();
  p.lines[0].duration = 3.5; // line 1 re-rolled longer
  const after = check();
  assert.ok(after.start - before.start > 1.4, 'the layer moved with its line');
  p.lines.splice(1, 1); // the start line is deleted
  assert.equal(compilePerformance(p).layers.length, 0, 'a layer whose line is gone is skipped, not misplaced');
  assert.equal(anchorTime({ lineId: ids[3], offset: 99 }, compilePerformance(p).lines), compilePerformance(p).lines.at(-1).end, 'offsets clamp to the line');
});

test('poses ease between keyframes with the keyframe curve and fade at the edges', () => {
  const { p } = project();
  const [layer] = compilePerformance(p).layers, s = layer.start, k = layer.keyframes[0].time;
  assert.equal(layerPoseAt(layer, s - 0.1), null);
  assert.equal(layerPoseAt(layer, s).x, 0.2);
  assert.ok(Math.abs(layerPoseAt(layer, (s + k) / 2).x - 0.5) < 1e-6, 'halfway between start and keyframe, linear');
  assert.equal(layerPoseAt(layer, k + 0.3).x, 0.8, 'holds after the last keyframe');
  assert.equal(layerPoseAt(layer, layer.end), null, 'gone at its end');
  const faded = layerPoseAt({ ...layer, fadeIn: 1 }, s + 0.5);
  assert.ok(Math.abs(faded.opacity - 0.5) < 1e-6);
  const snap = layerPoseAt({ ...layer, keyframes: [{ ...layer.keyframes[0], curve: 'snap' }] }, s + (k - s) * 0.55);
  assert.ok(snap.x > 0.8, '急停 overshoots past the keyframe on the way');
});

test('anchors snap to "line + seconds"', () => {
  const { p, ids } = project();
  const lines = compilePerformance(p).lines;
  assert.deepEqual(anchorAt(lines[2].start + 0.25, lines), { lineId: ids[2], offset: 0.25 });
  assert.deepEqual(anchorAt(-3, lines), { lineId: ids[0], offset: 0 });
  assert.equal(resolveLayers([{ ...p.layers[0], hidden: true }], lines).length, 0);
});

test('layer images live in assets/layers and the studio wires the tab and preview dragging', async () => {
  assert.ok(WORKSPACE_DIRECTORIES.includes('assets/layers'));
  assert.equal(assetKindForPath('assets/layers/a.png'), 'other');
  const html = await readFile(new URL('../web/studio.html', import.meta.url), 'utf8');
  assert.match(html, /data-workbench-tab="layers">图层</);
  assert.match(html, /id="layerStageEditor"/);
  const studio = await readFile(new URL('../web/studio.js', import.meta.url), 'utf8');
  assert.match(studio, /persistAssetFile\(workspace,project,asset,file,`assets\/layers\//);
  const src = await readFile(new URL('../src/renderers/canvas-stage.ts', import.meta.url), 'utf8');
  assert.match(src, /await this\.drawStageLayers\('characters', line\.start \+ localTime\)/);
  assert.match(src, /await this\.drawStageLayers\('top', line\.start \+ localTime\)/);
});

test('emote layers need no image, and draw order follows the track stack (top row in front)', async () => {
  const { p, ids } = project();
  const { layerTracks } = await import('../dist/index.js');
  const mk = (id, track, extra = {}) => normalizeLayer({ id, name: id, assetId: 'img', track, start: { lineId: ids[0], offset: 0 }, end: { lineId: ids[3], offset: null }, ...extra });
  p.layers = [mk('pipA', 'pip'), mk('emo', 'emote', { assetId: null, emote: 'anger', follow: p.characters[0].id }), mk('img', 'image'), mk('pipB', 'pip')];
  assert.deepEqual(compilePerformance(p).layers.map(l => l.id), ['img', 'pipA', 'pipB', 'emo'], 'default stack: 漫符 on top, then 画中画, then 图片');
  p.layerTracks = [{ key: 'pip', label: '画中画' }, { key: 'emote', label: '漫符' }, { key: 'image', label: '图片' }];
  assert.deepEqual(compilePerformance(p).layers.map(l => l.id), ['img', 'emo', 'pipA', 'pipB'], 'moving 画中画 up puts it in front of the emote');
  const emote = compilePerformance(p).layers.find(l => l.id === 'emo');
  assert.equal(emote.emote, 'anger'); assert.equal(emote.follow, p.characters[0].id);
  p.layers.push(mk('custom', 'myTrack'));
  assert.ok(layerTracks(p).some(t => t.key === 'myTrack'), 'a track a layer still uses is never lost');
  assert.equal(normalizeLayer({ id: 'x', emote: 'not-a-mark' }).emote, undefined);
});

test('the renderer follows heads in screen space and draws built-in emotes', async () => {
  const src = await readFile(new URL('../src/renderers/canvas-stage.ts', import.meta.url), 'utf8');
  assert.match(src, /this\.screenHeads = new Map\(\[\.\.\.heads\]\.map/);
  assert.match(src, /if \(layer\.follow\) \{ const head = this\.screenHeads\.get\(layer\.follow\); if \(!head\) continue;/);
  assert.match(src, /drawEmote\(ctx, layer\.emote as EmoteKind/);
});

test('animated images pick frames by time: loop, speed and stop-on-last', async () => {
  const { animatedFrameAt, animatedImageType } = await import('../dist/index.js');
  const d = [0.2, 0.2, 0.2];
  assert.deepEqual([0, 0.25, 0.45, 0.65].map(t => animatedFrameAt(d, t)), [0, 1, 2, 0]);
  assert.equal(animatedFrameAt(d, 0.25, 2), 2, 'double speed');
  assert.equal(animatedFrameAt(d, 5, 1, false), 2, 'no loop holds the last frame');
  assert.equal(animatedFrameAt([0.1], 3), 0);
  assert.equal(animatedFrameAt([0, 0, 0], 0.15), 1, 'zero delays count as 0.1s like browsers do');
  const bytes = s => Uint8Array.from(s, c => c.charCodeAt(0));
  assert.equal(animatedImageType(bytes('GIF89a......')), 'image/gif');
  assert.equal(animatedImageType(bytes('RIFF\0\0\0\0WEBPVP8X')), 'image/webp');
  const png = head => Uint8Array.from([0x89, ...bytes(`PNG\r\n\x1a\n${head}`)]);
  assert.equal(animatedImageType(png('....IHDR....acTL....IDAT')), 'image/png', 'APNG');
  assert.equal(animatedImageType(png('....IHDR....IDAT')), null, 'a still PNG');
  assert.equal(normalizeLayer({ id: 'g', speed: 2, loop: false }).speed, 2);
  assert.equal(normalizeLayer({ id: 'g', speed: 1 }).speed, undefined);
});
