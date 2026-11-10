import type { TtsProvider, TtsRequest, TtsResult, TtsVoiceInfo } from './types.js';

export const VOICEBOX_LOCAL_TTS_ID = 'voicebox-local';

export interface VoiceboxLocalTtsOptions {
  baseUrl?: string;
  bridgeUrl?: string;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
  /** How long to wait while the bridge is rendering a line for someone else. */
  bridgeBusyWaitMs?: number;
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
  if(status==='cancelled'||status==='canceled')throw new Error('这句生成已在 Voicebox 中被取消。需要的话请重新生成。');
  if(status==='failed'){
    if(/shut\s*down/i.test(String(row.error||'')))throw new Error('Voicebox 在生成途中被关闭了。请重新打开 Voicebox，并在生成期间保持它运行，然后重试。');
    throw new Error(`Voicebox 生成失败${row.error ? `：${row.error}` : '，服务没有返回原因。'}`);
  }
  return status;
}
function isAbortError(error: unknown): boolean {
  const name=(error as { name?: string } | null)?.name;
  return name==='AbortError'||name==='TimeoutError';
}
async function errorDetail(response: Response): Promise<string> {
  const text=await response.text().catch(()=>'');
  try{
    const detail=JSON.parse(text)?.detail;
    if(typeof detail==='string')return detail.slice(0,240);
    if(Array.isArray(detail))return detail.map(item=>item?.msg).filter(Boolean).join('；').slice(0,240);
  }catch{}
  return text.slice(0,240);
}
function baseLanguage(language?: string): string | undefined {
  const value = (language || '').trim().toLowerCase();
  if (!value || value === 'auto') return undefined;
  return value.split('-')[0] || undefined;
}
// Mirrors the language pattern of Voicebox 0.5 GenerationRequest.
const VOICEBOX_LANGUAGES=new Set(['zh','en','ja','ko','de','fr','ru','pt','es','it','he','ar','da','el','fi','hi','ms','nl','no','pl','sv','sw','tr']);
const VOICEBOX_LANGUAGE_ALIASES: Record<string,string>={nb:'no',nn:'no',iw:'he',cmn:'zh'};
function voiceboxLanguage(language?: string): string | undefined {
  const base=baseLanguage(language);
  if(!base)return undefined;
  const mapped=VOICEBOX_LANGUAGE_ALIASES[base]||base;
  if(!VOICEBOX_LANGUAGES.has(mapped))throw new Error(`Voicebox 不支持朗读语言「${language}」。请换一种朗读语言，或让这个角色改用 Replay Lab Free。`);
  return mapped;
}
const VOICEBOX_CUT_OFF_ATTEMPTS=3;
// The model can stop early without reporting an error. Thresholds sit well below
// measured normal speech (CJK 0.10+ s/char, cut-offs under 0.065; Latin about 0.07 s/char).
function looksCutOff(text: string, duration?: number): boolean {
  if(!duration)return false;
  const spoken=text.match(/[\p{L}\p{N}]/gu)||[];
  if(spoken.length<12)return false;
  const cjk=text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)||[];
  return duration/spoken.length<(cjk.length*2>=spoken.length?0.08:0.02);
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
  private readonly bridgeBusyWaitMs: number;

  constructor(options: VoiceboxLocalTtsOptions = {}) {
    this.baseUrl = trimBaseUrl(options.baseUrl || 'http://127.0.0.1:17493');
    this.bridgeUrl = trimBaseUrl(options.bridgeUrl || 'http://127.0.0.1:17494');
    this.fetchImpl = options.fetchImpl || globalThis.fetch.bind(globalThis);
    this.pollIntervalMs = options.pollIntervalMs ?? 700;
    this.timeoutMs = options.timeoutMs ?? 20 * 60_000;
    this.bridgeBusyWaitMs = options.bridgeBusyWaitMs ?? 10 * 60_000;
  }

  private async callVoicebox(url: string, init: RequestInit): Promise<Response> {
    try{return await this.fetchImpl(url,init);}
    catch(error){
      if(init.signal?.aborted||isAbortError(error))throw error;
      throw new Error(`连不上 Voicebox（${this.baseUrl}）。请确认 Voicebox 已打开并保持运行，再重试。原始错误：${(error as Error)?.message||error}`);
    }
  }

  private async callBridge(url: string, init: RequestInit): Promise<Response> {
    try{return await this.fetchImpl(url,init);}
    catch(error){
      if(init.signal?.aborted||isAbortError(error))throw error;
      throw new Error(`情绪桥没有启动（${this.bridgeUrl}）。请先运行 START_VOICE_BRIDGE.command；只有“实验：克隆 + 情绪”模式需要它。原始错误：${(error as Error)?.message||error}`);
    }
  }

  private cancelGeneration(id: string): void {
    void (async()=>{
      try{await this.fetchImpl(`${this.baseUrl}/generate/${encodeURIComponent(id)}/cancel`,{method:'POST',signal:AbortSignal.timeout(3000)});}
      catch{}
    })();
  }

  private async findProfile(id: string, signal: AbortSignal): Promise<Record<string, any> | undefined> {
    const response=await this.callVoicebox(`${this.baseUrl}/profiles`,{signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
    if(!response.ok)return undefined;
    const profiles=await response.json().catch(()=>null) as Array<Record<string, any>> | null;
    if(!Array.isArray(profiles))return undefined;
    const profile=profiles.find(row=>String(row.id)===id);
    if(!profile)throw new Error('这个角色绑定的 Voicebox Profile 已不存在，可能已在 Voicebox 中删除。请在角色声音设置里重新选择。');
    return profile;
  }

  async health(): Promise<unknown> {
    const response = await this.callVoicebox(`${this.baseUrl}/health`,{signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error(`Voicebox health check failed: HTTP ${response.status}`);
    return response.json();
  }

  async listVoices(language?: string): Promise<TtsVoiceInfo[]> {
    const response = await this.callVoicebox(`${this.baseUrl}/profiles`,{signal:AbortSignal.timeout(8000)});
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
    const response = await this.callBridge(`${this.bridgeUrl}/health`, { signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
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
    // The bridge renders one line at a time and refuses others; another window may be using it, so wait instead of failing.
    const waitUntil = Date.now() + this.bridgeBusyWaitMs;
    let response: Response;
    for (;;) {
      response = await this.callBridge(`${this.bridgeUrl}/synthesize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ReplayLab-Bridge': '1' },
        signal: request.signal ? AbortSignal.any([request.signal,AbortSignal.timeout(20*60_000)]) : AbortSignal.timeout(20 * 60_000),
        body: JSON.stringify({ profile_id: request.voiceId, text: request.text, language: baseLanguage(request.language),
          model_size: request.modelSize, instruct: instructions, seed: request.seed })
      });
      if (response.ok) break;
      const detail = (await response.text()).slice(0, 1200);
      if (!/正在生成另一句/.test(detail) || Date.now() > waitUntil) throw new Error(`情绪桥生成失败：${detail}`);
      await delay(this.pollIntervalMs * 4, request.signal ?? AbortSignal.timeout(60_000));
    }
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
      const response = await this.callVoicebox(`${this.baseUrl}/history/${encodeURIComponent(id)}`,{signal});
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
    let id = '';
    try {
      const requestedLanguage = voiceboxLanguage(request.language);
      const profile = await this.findProfile(request.voiceId,signal);
      // Omitting language makes Voicebox assume English, so "auto" follows the profile.
      const language = requestedLanguage ?? voiceboxLanguage(profile?.language);
      const payload: Record<string, unknown> = { profile_id: request.voiceId, text: request.text };
      if (language) payload.language = language;
      if (Number.isInteger(request.seed)) payload.seed = request.seed;
      payload.model_size = request.modelSize || '0.6B';
      // Preset voices only exist on their own engine; Voicebox would otherwise default to qwen.
      const engine = request.engine || profile?.preset_engine;
      if (engine) payload.engine = engine;
      for (let attempt = 1; ; attempt += 1) {
        id = '';
        const response = await this.callVoicebox(`${this.baseUrl}/generate`, {
          signal,
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const detail = await errorDetail(response);
          throw new Error(`Voicebox 拒绝了这句生成（HTTP ${response.status}）${detail ? `：${detail}` : ''}`);
        }
        const generation = await response.json() as Record<string, any>;
        signal.throwIfAborted();
        id = String(generation.id || generation.generation_id || '');
        if (!id) throw new Error('Voicebox did not return a generation id.');
        const complete = generation.status && generationStatus(generation) === 'completed' ? generation : await this.waitForGeneration(id,signal);
        signal.throwIfAborted();
        const duration = Number(complete.duration) || undefined;
        if (looksCutOff(request.text,duration)) {
          // A fixed seed would repeat the same cut-off, so only unseeded lines retry.
          if (!Number.isInteger(request.seed) && attempt < VOICEBOX_CUT_OFF_ATTEMPTS) continue;
          const advice = Number(profile?.sample_count) > 1
            ? `这个声音有 ${profile?.sample_count} 段参考样本，合并后过长会让模型提前结束。请在 Voicebox 中只保留一段 30 秒以内的干净样本。`
            : Number.isInteger(request.seed) ? '当前固定了 Seed，换一个或清空 Seed 后重试。' : '请重试，或把这句拆短。';
          throw new Error(`Voicebox 只生成了 ${duration?.toFixed(1)} 秒音频，这句很可能没读完，已拒绝采用。${advice}`);
        }
        const audioResponse = await this.callVoicebox(`${this.baseUrl}/audio/${encodeURIComponent(id)}`,{signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
        if (!audioResponse.ok) throw new Error(`Voicebox audio download failed: HTTP ${audioResponse.status}`);
        const audio = await audioResponse.arrayBuffer();
        signal.throwIfAborted();
        return { audio, mime: audioResponse.headers.get('content-type') || 'audio/wav', duration };
      }
    } catch (error) {
      // Without this, an abandoned job keeps occupying Voicebox's serial queue.
      if (id && signal.aborted) this.cancelGeneration(id);
      if (deadline.aborted && !request.signal?.aborted) throw new Error(`Voicebox 超过 ${Math.round(this.timeoutMs/60_000)} 分钟仍未完成这句，已取消。可能在下载模型或队列卡住，请到 Voicebox 中查看后重试。`);
      throw error;
    }
  }
}
