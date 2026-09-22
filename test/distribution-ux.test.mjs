import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const studioHtml = await readFile(new URL('../web/studio.html', import.meta.url), 'utf8');
const studioJs = await readFile(new URL('../web/studio.js', import.meta.url), 'utf8');
const voiceHtml = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
const voiceJs = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const workerTtsJs = await readFile(new URL('../web/worker-tts-provider.js', import.meta.url), 'utf8');
const kokoroWorkerJs = await readFile(new URL('../web/kokoro-worker.js', import.meta.url), 'utf8');
const prosodyUiJs = await readFile(new URL('../web/prosody-editor.js', import.meta.url), 'utf8');
const desktopUiJs = await readFile(new URL('../web/desktop-ui.js', import.meta.url), 'utf8');

function buttonIds(html) {
  return [...html.matchAll(/<button\b[^>]*\bid="([^"]+)"/g)].map(match => match[1]);
}

function assertButtonsReferenced(html, js, label) {
  js+=desktopUiJs+prosodyUiJs;
  const missing = buttonIds(html).filter(id => !js.includes(`#${id}`) && !js.includes(`getElementById('${id}')`) && !js.includes(`getElementById("${id}")`) && !js.includes(`$('${id}')`));
  assert.deepEqual(missing, [], `${label} static buttons must have binding evidence`);
}

test('0.34.1 distribution exposes launchers instead of relying on direct file:// Studio opening', async () => {
  for (const file of ['../launch_replay_lab.py','../START_REPLAY_LAB.bat','../START_REPLAY_LAB.command','../START_REPLAY_LAB.sh','../OPEN_REPLAY_LAB.html','../START_HERE.txt']) {
    await access(new URL(file, import.meta.url));
  }
  assert.match(studioHtml, /不能直接双击/);
  assert.match(studioHtml, /id="bootGuard"/);
  assert.match(studioJs, /__replayLabMarkBootReady/);
  assert.match(voiceHtml, /id="bootGuard"/);
  assert.match(voiceJs, /__replayLabMarkBootReady/);
});

test('0.34.1 every static Studio and Voice button has script binding evidence', () => {
  assertButtonsReferenced(studioHtml, studioJs, 'Studio');
  assertButtonsReferenced(voiceHtml, voiceJs, 'Voice');
});


test('0.35 Replay Lab Free loads and synthesizes through a cancellable Worker proxy', () => {
  assert.match(voiceJs, /WorkerReplayLabFreeTtsProvider/);
  assert.match(voiceHtml, /后台加载免费声音/);
  assert.match(voiceHtml, /id="cancelFreeModel"/);
  assert.match(voiceHtml, /id="retryFreeModelWasm"/);
  assert.match(workerTtsJs, /new Worker\(/);
  assert.match(workerTtsJs, /terminate\(\)/);
  assert.match(kokoroWorkerJs, /ReplayLabFreeTtsProvider/);
  assert.match(kokoroWorkerJs, /action === 'synthesize'/);
});


test('0.36 Voice keeps long-running local work alive across normal return-to-Studio navigation and downloads persisted audio', () => {
  assert.match(studioHtml, /target="replaylab-voice"/);
  assert.match(voiceHtml, /target="replaylab-studio"/);
  assert.match(voiceJs, /beforeunload/);
  assert.match(voiceJs, /voiceTaskBusy/);
  assert.match(voiceHtml, /id="retryFreeModel"/);
  assert.match(voiceHtml, /id="checkFreeModelNetwork"/);
  assert.match(voiceJs, /currentLineAudioBlob/);
  assert.match(voiceJs, /workspace\.read\(asset\.sourcePath\)/);
  assert.match(voiceJs, /showSaveFilePicker/);
});

test('0.38 published runtime manifest includes every compiled JS module', async () => {
  const { readdir } = await import('node:fs/promises');
  const { join, relative, sep } = await import('node:path');
  const dist = new URL('../dist/', import.meta.url);
  async function walk(dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await walk(full));
      else if (entry.isFile() && entry.name.endsWith('.js')) out.push(relative(dist.pathname, full).split(sep).join('/'));
    }
    return out;
  }
  const manifest = JSON.parse(await readFile(new URL('../web/runtime-files.json', import.meta.url), 'utf8'));
  const actual = (await walk(dist.pathname)).sort();
  assert.deepEqual([...manifest.files].sort(), actual);
  assert.equal(manifest.version, '0.57');
});
