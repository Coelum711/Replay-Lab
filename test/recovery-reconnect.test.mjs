import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MemoryProjectRecoveryStore, createProject } from '../dist/index.js';

test('recovery snapshots keep the restart-stable recent-project id', async () => {
  const store = new MemoryProjectRecoveryStore();
  await store.save(createProject('恢复'), { workspaceId: 'grant-1', workspaceLabel: '小海岛', workspaceRecentId: 'recent-1' });
  const latest = await store.latest();
  assert.equal(latest.workspaceRecentId, 'recent-1');
});

test('"继续上次编辑" reconnects the original folder instead of leaving placeholder art', async () => {
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /return \{\.\.\.grant,recentId:/, 'choose reports the recent id, not only the per-launch grant id');
  const studio = await readFile(new URL('../web/studio.js', import.meta.url), 'utf8');
  assert.match(studio, /workspaceRecentId:workspace\?\.recentId/, 'snapshots record the stable id');
  assert.match(studio, /const recentId=await recoveryRecentId\(recoverySnapshot\);if\(recentId&&recoveryConnection\)await chooseWorkspace\(recentId\)/, 'restore reconnects automatically');
});
