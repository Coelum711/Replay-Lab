import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDialogueLayout, formatDialogueLayout, resolveDialogueLayout, dialogueSkinActive, findDialogueSkinFiles, DEFAULT_DIALOGUE_LAYOUT,
  discoverFolderAssets, assetKindForPath, parseTextTags, createProject, WORKSPACE_DIRECTORIES } from '../dist/index.js';

test('对话框.json takes Chinese or English keys, clamps numbers and reports bad values', () => {
  const { layout, warnings } = parseDialogueLayout('﻿{"字号": 30, "textColor": "#112233", "高度": 9999, "显示名字": false, "说明": "随便写", "怪东西": 1, "名字颜色": "red"}');
  assert.deepEqual(layout, { fontSize: 30, textColor: '#112233', height: 600, showName: false });
  assert.equal(warnings.length, 2);
  assert.match(parseDialogueLayout('{oops').warnings[0], /不是有效的 JSON/);
});

test('formatting writes only what differs from the default, and reads back the same', () => {
  const text = formatDialogueLayout({ fontSize: 30, marginX: DEFAULT_DIALOGUE_LAYOUT.marginX, nameTint: false });
  assert.deepEqual(JSON.parse(text), { 字号: 30, 名字框用代表色: false });
  assert.deepEqual(parseDialogueLayout(text).layout, { fontSize: 30, nameTint: false });
  assert.equal(resolveDialogueLayout({ layout: { fontSize: 30 } }).fontSize, 30);
  assert.equal(resolveDialogueLayout(null).fontSize, DEFAULT_DIALOGUE_LAYOUT.fontSize);
});

test('an empty skin keeps the original textbox drawing', () => {
  assert.equal(dialogueSkinActive(null), false);
  assert.equal(dialogueSkinActive({ box: null, name: null, window: null, layout: {} }), false);
  assert.equal(dialogueSkinActive({ layout: { fontSize: 30 } }), true);
  assert.equal(dialogueSkinActive({ window: 'asset_1' }), true);
});

test('assets/system files are found by name and discovered as images', () => {
  const files = [
    { path: 'assets/system/对话框.png', size: 10, modifiedAt: 1 }, { path: 'assets/system/NameBox.webp', size: 5 },
    { path: 'assets/system/Window.png' }, { path: 'assets/system/对话框.json', size: 2 },
    { path: 'assets/system/old/对话框.png' }, { path: 'assets/system/bgm.ogg' }];
  const found = findDialogueSkinFiles(files);
  assert.equal(found.box, 'assets/system/对话框.png');
  assert.equal(found.name, 'assets/system/NameBox.webp');
  assert.equal(found.window, 'assets/system/Window.png');
  assert.equal(found.layoutPath, 'assets/system/对话框.json');
  assert.notEqual(findDialogueSkinFiles([{ ...files[0], modifiedAt: 2 }]).revision, findDialogueSkinFiles([files[0]]).revision, 'replacing a file changes the revision');
  assert.ok(WORKSPACE_DIRECTORIES.includes('assets/system'));
  assert.equal(assetKindForPath('assets/system/Window.png'), 'other');
  const discovered = discoverFolderAssets(createProject('皮肤'), files);
  assert.deepEqual(discovered.map(a => a.sourcePath).sort(), ['assets/system/NameBox.webp', 'assets/system/Window.png', 'assets/system/old/对话框.png', 'assets/system/对话框.png'].sort());
});

test('RPG Maker \\C[n] and {色n} colour text from the window skin palette', () => {
  assert.deepEqual(parseTextTags('普通\\C[2]橙\\C[0]普通\\C[3]绿'), { plain: '普通橙普通绿', ranges: [
    { from: 2, to: 3, kind: 'color', color: 'palette:2' }, { from: 5, to: 6, kind: 'color', color: 'palette:3' }] });
  assert.deepEqual(parseTextTags('{色4}蓝{/色4}{c31}紫{/}').ranges.map(r => r.color), ['palette:4', 'palette:31']);
  assert.equal(parseTextTags('{色40}不是').plain, '{色40}不是', 'out of range stays literal');
});

test('the studio rescans the skin on focus and stores skin images by asset id', async () => {
  const studio = await readFile(new URL('../web/studio.js', import.meta.url), 'utf8');
  assert.match(studio, /window\.addEventListener\('focus',\(\)=>\{if\(workspace&&!workspaceConnecting\)void scanAssetFolders\(\{quiet:true\}\)\}\)/);
  assert.match(studio, /const idFor=path=>path\?owner\.assets\.find\(a=>a\.sourcePath===path\)\?\.id/);
  assert.match(studio, /if\(workspace===chosen\)\{void scanAssetFolders/, 'opening a folder scans it, even when it replaces the current project');
  assert.match(studio, /data-character-color type="color"/);
});
