const FREE_ID = 'replaylab-free';

export class WorkerReplayLabFreeTtsProvider {
  constructor(options = {}) {
    this.id = FREE_ID;
    this.label = 'Replay Lab Free (Kokoro worker)';
    this.capabilities = {
      costModel: 'free-local', local: true, exportableAudio: true, listVoices: true,
      phonemeTiming: false, wordTiming: false, ssml: false,
      supportedLanguages: ['en-US', 'en-GB']
    };
    this.options = {
      moduleSpecifier: options.moduleSpecifier,
      dtype: options.dtype || 'q8',
      device: options.device || 'auto'
    };
    this.onProgress = options.onProgress;
    this.worker = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') throw new Error('当前浏览器不支持 Web Worker，无法安全后台加载本地声音模型。');
    const worker = new Worker(new URL('./kokoro-worker.js', import.meta.url), { type: 'module', name: 'replaylab-kokoro' });
    worker.onmessage = event => {
      const message = event.data || {};
      if (message.type === 'progress') { this.onProgress?.(message.event || {}); return; }
      if (message.type !== 'response') return;
      const job = this.pending.get(message.id);
      if (!job) return;
      this.pending.delete(message.id);
      if (message.ok) job.resolve(message.result);
      else {
        const error = new Error(message.error?.message || 'Kokoro Worker failed');
        error.name = message.error?.name || 'Error';
        if (message.error?.stack) error.stack = message.error.stack;
        job.reject(error);
      }
    };
    worker.onerror = event => {
      const error = new Error(event.message || 'Kokoro Worker crashed.');
      for (const job of this.pending.values()) job.reject(error);
      this.pending.clear();
      this.worker = null;
    };
    this.worker = worker;
    void this.rpc('configure', this.options).catch(() => {});
    return worker;
  }

  rpc(action, payload = {}) {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, action, payload });
    });
  }

  async warmup() { await this.rpc('warmup'); }
  async listVoices(language) { return await this.rpc('listVoices', { language }); }
  async synthesize(request) {
    const result = await this.rpc('synthesize', { request });
    return { ...result, audio: result.audio instanceof ArrayBuffer ? new Blob([result.audio], { type: result.mime || 'audio/wav' }) : result.audio };
  }

  cancel(reason = '免费声音后台加载已取消。') {
    const error = new DOMException(reason, 'AbortError');
    for (const job of this.pending.values()) job.reject(error);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  restart(options = {}) {
    this.cancel('重启免费声音 Worker。');
    this.options = { ...this.options, ...options };
  }
}
