export const VOICEBOX_LOCAL_TTS_ID = 'voicebox-local';

function normalizeBaseUrl(value) {
  const raw = String(value || '/__voicebox').trim();
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

function languageBase(language = '') {
  const value = String(language || '').trim().toLowerCase();
  if (!value || value === 'auto') return '';
  return value.split(/[-_]/)[0];
}

function errorText(payload, fallback) {
  if (!payload) return fallback;
  if (typeof payload === 'string') return payload;
  return payload.detail || payload.error || payload.message || fallback;
}

async function readError(response) {
  try {
    const type = response.headers?.get?.('content-type') || '';
    if (type.includes('json')) return errorText(await response.json(), `HTTP ${response.status}`);
    return (await response.text()) || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export class VoiceboxLocalTtsProvider {
  constructor(options = {}) {
    this.id = VOICEBOX_LOCAL_TTS_ID;
    this.label = 'Voicebox Local';
    this.capabilities = {
      costModel: 'free-local',
      local: true,
      exportableAudio: true,
      listVoices: true,
      phonemeTiming: false,
      wordTiming: false
    };
    this.baseUrl = normalizeBaseUrl(options.baseUrl || '/__voicebox');
    // Browser implementations are allowed to require Window as the receiver.
    // Bind it once here so passing fetch around never causes “Illegal invocation”.
    const nativeFetch = globalThis.fetch;
    this.fetchImpl = options.fetchImpl || (typeof nativeFetch === 'function' ? nativeFetch.bind(globalThis) : null);
    this.pollIntervalMs = Math.max(150, Number(options.pollIntervalMs) || 900);
    this.timeoutMs = Math.max(10_000, Number(options.timeoutMs) || 30 * 60_000);
    this.profileCache = new Map();
  }

  ensureFetch() {
    if (!this.fetchImpl) throw new Error('当前浏览器没有可用的 fetch。');
  }

  async request(path, options = {}) {
    this.ensureFetch();
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { cache: 'no-store', ...options });
    if (!response.ok) throw new Error(await readError(response));
    return response;
  }

  async health() {
    const response = await this.request('/health');
    return response.json();
  }

  async profiles() {
    const response = await this.request('/profiles');
    const profiles = await response.json();
    this.profileCache.clear();
    for (const profile of Array.isArray(profiles) ? profiles : []) this.profileCache.set(String(profile.id), profile);
    return Array.isArray(profiles) ? profiles : [];
  }

  async listVoices(language) {
    const wanted = languageBase(language);
    const profiles = await this.profiles();
    const mapped = profiles.map(profile => {
      const profileLanguage = languageBase(profile.language);
      const engine = profile.default_engine || profile.preset_engine || undefined;
      return {
        id: String(profile.id),
        label: profile.name || String(profile.id),
        languages: profile.language ? [profile.language] : [],
        tags: [engine, profile.voice_type].filter(Boolean),
        quality: profile.voice_type === 'cloned' ? '克隆' : profile.voice_type === 'preset' ? '预设' : undefined,
        metadata: { ...profile, engine }
      };
    });
    // Do not hide multilingual/cloned profiles just because their stored default
    // language differs. Matching language is only a ranking hint.
    return mapped.sort((a, b) => {
      const am = wanted && a.languages.some(item => languageBase(item) === wanted) ? 1 : 0;
      const bm = wanted && b.languages.some(item => languageBase(item) === wanted) ? 1 : 0;
      return bm - am || a.label.localeCompare(b.label);
    });
  }

  async getProfile(profileId) {
    const key = String(profileId || '');
    if (!key) return null;
    if (this.profileCache.has(key)) return this.profileCache.get(key);
    await this.profiles();
    return this.profileCache.get(key) || null;
  }

  async synthesize(request) {
    const profileId = String(request?.voiceId || '').trim();
    if (!profileId) throw new Error('请先为这个角色选择一个 Voicebox Profile。');
    const profile = await this.getProfile(profileId);
    if (!profile) throw new Error('Voicebox 中找不到所选 Profile；请刷新 Profile 列表。');

    const profileLanguage = languageBase(profile.language);
    const requestedLanguage = languageBase(request.language);
    const language = requestedLanguage || profileLanguage || 'en';
    const engine = profile.default_engine || profile.preset_engine || undefined;
    const payload = {
      text: String(request.text || ''),
      profile_id: profileId,
      language
    };
    if (engine) payload.engine = engine;

    const response = await this.request('/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const generation = await response.json();
    const id = String(generation?.id || '');
    if (!id) throw new Error('Voicebox 没有返回 generation id。');

    const started = Date.now();
    let state = generation;
    while (!['completed', 'failed'].includes(String(state?.status || '').toLowerCase())) {
      if (Date.now() - started > this.timeoutMs) throw new Error('Voicebox 生成超时；可以在 Voicebox 中查看模型下载/生成状态。');
      await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      const statusResponse = await this.request(`/history/${encodeURIComponent(id)}`);
      state = await statusResponse.json();
    }
    if (String(state.status).toLowerCase() === 'failed') {
      throw new Error(state.error || 'Voicebox 生成失败。');
    }

    const audioResponse = await this.request(`/audio/${encodeURIComponent(id)}`);
    const audio = await audioResponse.blob();
    return {
      audio,
      mime: audio.type || audioResponse.headers?.get?.('content-type') || 'audio/wav',
      duration: Number(state.duration) || undefined
    };
  }
}
