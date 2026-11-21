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
