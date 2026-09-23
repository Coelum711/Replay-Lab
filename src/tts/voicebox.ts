import type { TtsProvider, TtsRequest, TtsResult, TtsVoiceInfo } from './types.js';

export const VOICEBOX_LOCAL_TTS_ID = 'voicebox-local';

export interface VoiceboxLocalTtsOptions {
  baseUrl?: string;
  bridgeUrl?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

function trimBaseUrl(value: string): string { return value.replace(/\/+$/, ''); }
function delay(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);
    signal.addEventListener('abort',abort,{once:true});
  });
}
function generationStatus(row: Record<string, any>): string {
  const status=String(row?.status || '').toLowerCase();
  if(!status)throw new Error('Voicebox 返回的生成记录缺少 status 状态，请检查服务版本。');
  if(status==='failed'||status==='cancelled'||status==='canceled')throw new Error(`Voicebox generation ${status}${row.error ? `: ${row.error}` : ''}`);
  return status;
}
function baseLanguage(language?: string): string | undefined {
  const value = (language || '').trim().toLowerCase();
  if (!value || value === 'auto') return undefined;
  return value.split('-')[0] || undefined;
}
function languageMatches(profileLanguage: string | undefined, requested?: string): boolean {
  const a = baseLanguage(profileLanguage), b = baseLanguage(requested);
  return !!a && !!b && a === b;
}
function experimentalInstruct(request: TtsRequest): string {
  const accent = request.accent;
  const accentParts = accent && accent.strength !== 'off' ? [
    accent.label || accent.query || accent.id,
    accent.strength && `${accent.strength} accent strength`,
    ...(accent.pronunciationHints || []),
    ...(accent.prosodyHints || [])
  ].filter(Boolean) : [];
  return [request.instruct, accentParts.length ? `Accent and pronunciation: ${accentParts.join('; ')}` : ''].filter(Boolean).join('. ');
}

export class VoiceboxLocalTtsProvider implements TtsProvider {
  readonly id = VOICEBOX_LOCAL_TTS_ID;
  readonly label = 'Voicebox Local';
  readonly capabilities = { costModel: 'free-local' as const, local: true, exportableAudio: true, listVoices: true };
  private readonly baseUrl: string;
  private readonly bridgeUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(options: VoiceboxLocalTtsOptions = {}) {
    this.baseUrl = trimBaseUrl(options.baseUrl || 'http://127.0.0.1:17493');
    this.bridgeUrl = trimBaseUrl(options.bridgeUrl || 'http://127.0.0.1:17494');
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
    this.pollIntervalMs = options.pollIntervalMs ?? 700;
    this.timeoutMs = options.timeoutMs ?? 5 * 60_000;
  }

  async health(): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}/health`,{signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error(`Voicebox health check failed: HTTP ${response.status}`);
    return response.json();
  }

  async listVoices(language?: string): Promise<TtsVoiceInfo[]> {
    const response = await this.fetchImpl(`${this.baseUrl}/profiles`,{signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error(`Voicebox profiles failed: HTTP ${response.status}`);
    const profiles = await response.json() as Array<Record<string, any>>;
    return profiles.map((profile, index) => ({
      id: String(profile.id),
      label: String(profile.name || profile.id),
      languages: profile.language ? [String(profile.language)] : [],
      tags: [profile.voice_type, profile.default_engine || profile.preset_engine].filter(Boolean).map(String),
      metadata: { ...profile, languageMatch: languageMatches(profile.language, language), originalIndex: index }
    })).sort((a, b) => Number(Boolean(b.metadata?.languageMatch)) - Number(Boolean(a.metadata?.languageMatch)) || Number(a.metadata?.originalIndex ?? 0) - Number(b.metadata?.originalIndex ?? 0));
  }

  async bridgeHealth(signal?: AbortSignal): Promise<Record<string, any>> {
    const endpoint = new URL(this.bridgeUrl);
    if (endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
        || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') {
      throw new Error('实验情绪桥只允许无账号的本机 HTTP 地址。');
    }
    const response = await this.fetchImpl(`${this.bridgeUrl}/health`, { signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`情绪桥检查失败：HTTP ${response.status}`);
    const row = await response.json() as Record<string, any>;
    if (row.service !== 'replaylab-mlx-clone-bridge' || row.protocol !== 1 || row.capabilities?.clone_instruct !== true) {
      throw new Error('此地址没有兼容的 Replay Lab 情绪桥；原版 Voicebox 不能执行声纹注入。');
    }
    // The profile ID namespace must refer to exactly the connected Voicebox.
    const normalize = (value: string) => { const u = new URL(value); if (u.hostname === 'localhost') u.hostname = '127.0.0.1'; return u.href.replace(/\/$/, ''); };
    if (typeof row.voicebox_url !== 'string' || normalize(row.voicebox_url) !== normalize(this.baseUrl)) {
      throw new Error('情绪桥连接的是另一台 Voicebox；请统一两端地址，避免 Profile 错配。');
    }
    return row;
  }

  private async synthesizeExperimental(request: TtsRequest): Promise<TtsResult> {
    if (request.modelSize !== '1.7B') throw new Error('当前 MLX 文字情绪桥需要 1.7B Base + CustomVoice；0.6B 请保留稳定克隆模式。');
    const instructions=experimentalInstruct(request);
    if(instructions.length>2000)throw new Error('曲线、情绪和口音的合并指令超过 2000 字符，请缩短补充表演指令。');
    request.signal?.throwIfAborted();
    const status = await this.bridgeHealth(request.signal);
    if (!status.ready) throw new Error('情绪桥运行环境或 1.7B 模型缓存未就绪。打开桥状态页检查；没有自动下载，也没有退回其他声音。');
    if (!status.capabilities.model_sizes?.includes(request.modelSize)) throw new Error('情绪桥不支持所选模型尺寸。');
    const response = await this.fetchImpl(`${this.bridgeUrl}/synthesize`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ReplayLab-Bridge': '1' },
      signal: request.signal ? AbortSignal.any([request.signal,AbortSignal.timeout(20*60_000)]) : AbortSignal.timeout(20 * 60_000),
      body: JSON.stringify({ profile_id: request.voiceId, text: request.text, language: baseLanguage(request.language),
        model_size: request.modelSize, instruct: instructions, seed: request.seed })
    });
    if (!response.ok) throw new Error(`情绪桥生成失败：${(await response.text()).slice(0, 1200)}`);
    if (response.headers.get('X-ReplayLab-Profile') !== request.voiceId || response.headers.get('X-ReplayLab-Injected') !== '1') {
      throw new Error('情绪桥未确认该 Profile 的声纹注入；拒绝采用返回音频。');
    }
    if (!response.headers.get('content-type')?.includes('audio/wav')) throw new Error('情绪桥返回了非 WAV 数据。');
    const audio = await response.arrayBuffer();
    const header = new TextDecoder('ascii').decode(audio.slice(0, 12));
    if (audio.byteLength <= 44 || !header.startsWith('RIFF') || header.slice(8) !== 'WAVE') throw new Error('情绪桥返回了空音频或无效 WAV。');
    const duration = Number(response.headers.get('X-ReplayLab-Duration'));
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('情绪桥未返回有效音频时长。');
    return { audio, mime: 'audio/wav', duration };
  }

  private async waitForGeneration(id: string, signal: AbortSignal): Promise<Record<string, any>> {
    while (true) {
      signal.throwIfAborted();
      const response = await this.fetchImpl(`${this.baseUrl}/history/${encodeURIComponent(id)}`,{signal});
      if (!response.ok) throw new Error(`Voicebox generation status failed: HTTP ${response.status}`);
      const row = await response.json() as Record<string, any>;
      signal.throwIfAborted();
      const status = generationStatus(row);
      if (status === 'completed') return row;
      await delay(this.pollIntervalMs,signal);
    }
  }

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    request.signal?.throwIfAborted();
    if (!request.voiceId) throw new Error('尚未绑定 Voicebox Profile。请在这个角色的声音设置中，选择一个已建立的 Voicebox 声音。');
    if (request.experimentalCloneInstruct) return this.synthesizeExperimental(request);
    const deadline=AbortSignal.timeout(this.timeoutMs);
    const signal=request.signal ? AbortSignal.any([request.signal,deadline]) : deadline;
    const language = baseLanguage(request.language);
    const payload: Record<string, unknown> = { profile_id: request.voiceId, text: request.text };
    if (language) payload.language = language;
    if (Number.isInteger(request.seed)) payload.seed = request.seed;
    payload.model_size = request.modelSize || '0.6B';
    const response = await this.fetchImpl(`${this.baseUrl}/generate`, {
      signal,
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`Voicebox generation request failed: HTTP ${response.status}${await response.text().then(x => x ? ` · ${x.slice(0, 240)}` : '').catch(() => '')}`);
    const generation = await response.json() as Record<string, any>;
    signal.throwIfAborted();
    const id = String(generation.id || generation.generation_id || '');
    if (!id) throw new Error('Voicebox did not return a generation id.');
    const complete = generation.status && generationStatus(generation) === 'completed' ? generation : await this.waitForGeneration(id,signal);
    signal.throwIfAborted();
    const audioResponse = await this.fetchImpl(`${this.baseUrl}/audio/${encodeURIComponent(id)}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
    if (!audioResponse.ok) throw new Error(`Voicebox audio download failed: HTTP ${audioResponse.status}`);
    const audio = await audioResponse.arrayBuffer();
    signal.throwIfAborted();
    return { audio, mime: audioResponse.headers.get('content-type') || 'audio/wav', duration: Number(complete.duration) || undefined };
  }
}
