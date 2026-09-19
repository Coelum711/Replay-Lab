import { ReplayLabFreeTtsProvider } from '../dist/index.js';

let config = {
  moduleSpecifier: 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm',
  dtype: 'q8',
  device: 'auto'
};
let provider = null;

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack || ''
  };
}

function ensureProvider() {
  if (!provider) {
    provider = new ReplayLabFreeTtsProvider({
      ...config,
      onProgress(event) {
        postMessage({ type: 'progress', event });
      }
    });
  }
  return provider;
}

async function serializableTtsResult(result) {
  let audio = result.audio;
  if (audio instanceof Blob) audio = await audio.arrayBuffer();
  else if (audio instanceof Uint8Array) audio = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);
  return {
    ...result,
    audio
  };
}

self.onmessage = async event => {
  const { id, action, payload } = event.data || {};
  try {
    if (action === 'configure') {
      config = { ...config, ...(payload || {}) };
      provider = null;
      postMessage({ type: 'response', id, ok: true, result: true });
      return;
    }
    const tts = ensureProvider();
    if (action === 'warmup') {
      await tts.warmup();
      postMessage({ type: 'response', id, ok: true, result: true });
      return;
    }
    if (action === 'listVoices') {
      const result = await tts.listVoices(payload?.language);
      postMessage({ type: 'response', id, ok: true, result });
      return;
    }
    if (action === 'synthesize') {
      const result = await serializableTtsResult(await tts.synthesize(payload?.request || {}));
      const transfer = result.audio instanceof ArrayBuffer ? [result.audio] : [];
      postMessage({ type: 'response', id, ok: true, result }, transfer);
      return;
    }
    throw new Error(`Unknown worker action: ${action}`);
  } catch (error) {
    postMessage({ type: 'response', id, ok: false, error: serializeError(error) });
  }
};
