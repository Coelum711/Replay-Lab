import type { TtsProvider, TtsRequest, TtsResult, TtsVoiceInfo } from './types.js';
import { planSpeechPauses } from '../speech/pause.js';

export const REPLAYLAB_FREE_TTS_ID = 'replaylab-free';
export const DEFAULT_KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export type KokoroDevice = 'auto' | 'wasm' | 'webgpu' | 'cpu';
export type KokoroDtype = 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16';

export interface KokoroProgressEvent {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
  [key: string]: unknown;
}

interface KokoroRawAudio {
  data: Float32Array;
  sampling_rate?: number;
  toBlob(): Blob;
}

interface KokoroVoiceMetadata {
  name?: string;
  language?: string;
  gender?: string;
  traits?: string;
  overallGrade?: string;
  targetQuality?: string;
  [key: string]: unknown;
}

export interface KokoroInstance {
  voices?: Record<string, KokoroVoiceMetadata>;
  generate(text: string, options?: { voice?: string; speed?: number }): Promise<KokoroRawAudio>;
}

export interface KokoroLoaderOptions {
  modelId: string;
  /** Module specifier or URL used by the default loader. Browser workbenches may pass an ESM CDN URL. */
  moduleSpecifier?: string;
  dtype: KokoroDtype;
  device: Exclude<KokoroDevice, 'auto'> | null;
  onProgress?: (event: KokoroProgressEvent) => void;
}

export type KokoroLoader = (options: KokoroLoaderOptions) => Promise<KokoroInstance>;

function monoFloat32ToWavBlob(data: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + data.length * bytesPerSample);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + data.length * bytesPerSample, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * bytesPerSample, true); view.setUint16(32, bytesPerSample, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, data.length * bytesPerSample, true);
  let offset = 44;
  for (let i = 0; i < data.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, data[i] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true); offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function concatFloat32(parts: Float32Array[]): Float32Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(length); let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

async function defaultKokoroLoader(options: KokoroLoaderOptions): Promise<KokoroInstance> {
  // Keep kokoro-js optional: the core library still compiles/works for users who only import audio
  // or bind another TTS provider. App bundles that expose Replay Lab Free should include kokoro-js.
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
  let mod: any;
  try {
    mod = await dynamicImport(options.moduleSpecifier || 'kokoro-js');
  } catch (error) {
    throw new Error(`Replay Lab Free TTS requires optional dependency "kokoro-js". Install/bundle it before synthesis. (${String(error)})`);
  }
  return mod.KokoroTTS.from_pretrained(options.modelId, {
    dtype: options.dtype,
    device: options.device,
    progress_callback: options.onProgress ?? null
  });
}

const PREFIX_LANGUAGE: Record<string, string> = {
  a: 'en-US', b: 'en-GB', j: 'ja-JP', z: 'zh-CN', e: 'es-ES', f: 'fr-FR',
  h: 'hi-IN', i: 'it-IT', p: 'pt-BR'
};

function normalizeLanguage(language?: string): string {
  return (language || '').trim().toLowerCase();
}

function languageBase(language?: string): string {
  return normalizeLanguage(language).split('-')[0] || '';
}

function voiceLanguage(id: string, meta?: KokoroVoiceMetadata): string {
  const declared = typeof meta?.language === 'string' ? meta.language : '';
  if (declared) return declared;
  return PREFIX_LANGUAGE[id[0]?.toLowerCase() || ''] || '';
}

function voiceMatchesLanguage(id: string, meta: KokoroVoiceMetadata | undefined, language?: string): boolean {
  if (!language || language === 'auto') return true;
  const target = normalizeLanguage(language);
  const voice = normalizeLanguage(voiceLanguage(id, meta));
  if (!voice) return false;
  if (voice === target) return true;
  if (target.includes('-') && voice.includes('-')) return false;
  return languageBase(voice) === languageBase(target);
}

export interface ReplayLabFreeTtsOptions {
  modelId?: string;
  /** Optional ESM package specifier/URL for kokoro-js. Defaults to the installed package name. */
  moduleSpecifier?: string;
  dtype?: KokoroDtype;
  device?: KokoroDevice;
  loader?: KokoroLoader;
  onProgress?: (event: KokoroProgressEvent) => void;
}

/**
 * Built-in zero-metered-cost TTS. The model runs on the user's machine via Kokoro/Transformers.js.
 * Model files are downloaded on first use and then may be cached by the browser/runtime.
 */
export class ReplayLabFreeTtsProvider implements TtsProvider {
  readonly id = REPLAYLAB_FREE_TTS_ID;
  readonly label = 'Replay Lab Free (Kokoro local)';
  readonly capabilities = {
    costModel: 'free-local' as const,
    local: true,
    exportableAudio: true,
    listVoices: true,
    phonemeTiming: false,
    wordTiming: false,
    ssml: false,
    supportedLanguages: ['en-US', 'en-GB']
  };

  private readonly modelId: string;
  private readonly moduleSpecifier?: string;
  private readonly dtype: KokoroDtype;
  private readonly device: KokoroDevice;
  private readonly loader: KokoroLoader;
  private readonly onProgress?: (event: KokoroProgressEvent) => void;
  private instancePromise?: Promise<KokoroInstance>;

  constructor(options: ReplayLabFreeTtsOptions = {}) {
    this.modelId = options.modelId ?? DEFAULT_KOKORO_MODEL;
    this.moduleSpecifier = options.moduleSpecifier;
    this.dtype = options.dtype ?? 'q8';
    this.device = options.device ?? 'auto';
    this.loader = options.loader ?? defaultKokoroLoader;
    this.onProgress = options.onProgress;
  }

  private resolvedDevice(): Exclude<KokoroDevice, 'auto'> | null {
    if (this.device !== 'auto') return this.device;
    const nav = globalThis.navigator as Navigator & { gpu?: unknown } | undefined;
    return nav?.gpu ? 'webgpu' : 'wasm';
  }

  async warmup(): Promise<void> { await this.instance(); }

  private instance(): Promise<KokoroInstance> {
    this.instancePromise ??= this.loader({
      modelId: this.modelId,
      moduleSpecifier: this.moduleSpecifier,
      dtype: this.dtype,
      device: this.resolvedDevice(),
      onProgress: this.onProgress
    });
    return this.instancePromise;
  }

  async listVoices(language?: string): Promise<TtsVoiceInfo[]> {
    const tts = await this.instance();
    const voices = Object.entries(tts.voices ?? {});
    return voices
      .filter(([id, meta]) => voiceMatchesLanguage(id, meta, language))
      .map(([id, meta]) => ({
        id,
        label: meta.name ? `${meta.name} (${id})` : id,
        languages: [voiceLanguage(id, meta)].filter(Boolean),
        gender: meta.gender,
        tags: [meta.traits].filter((x): x is string => !!x),
        quality: meta.overallGrade || meta.targetQuality,
        metadata: { ...meta }
      }));
  }

  private async chooseVoice(request: TtsRequest): Promise<string> {
    const tts = await this.instance();
    const voices = tts.voices ?? {};
    if (request.voiceId) {
      if (Object.keys(voices).length && !voices[request.voiceId]) throw new Error(`Kokoro voice not found: ${request.voiceId}`);
      return request.voiceId;
    }
    const entries = Object.entries(voices).filter(([id, meta]) => voiceMatchesLanguage(id, meta, request.language));
    if (!entries.length) throw new Error(`Replay Lab Free has no Kokoro voice matching language ${request.language || '(unspecified)'}. Choose a supported built-in voice or bind an external TTS.`);
    // Prefer higher-quality documented grades where present, while preserving catalog order as fallback.
    const rank = (grade?: string) => ({'A+':9,'A':8,'A-':7,'B+':6,'B':5,'B-':4,'C+':3,'C':2,'C-':1}[grade || ''] ?? 0);
    entries.sort((a,b) => rank(b[1].overallGrade) - rank(a[1].overallGrade));
    return entries[0]![0];
  }

  async synthesize(request: TtsRequest): Promise<TtsResult> {
    if (request.language && request.language !== 'auto') {
      const supported = this.capabilities.supportedLanguages.some(language => normalizeLanguage(language) === normalizeLanguage(request.language));
      if (!supported) throw new Error(`Replay Lab Free Kokoro currently supports en-US/en-GB in the browser runtime, not ${request.language}. Bind another local/external provider for this language.`);
    }
    const tts = await this.instance();
    const voice = await this.chooseVoice(request);
    const speed = request.rate && request.rate > 0 ? request.rate : 1;
    const pausePlan = planSpeechPauses(request.text, request.pauseScale ?? 1, request.punctuationPauses);
    const needsStructuredPause = pausePlan.some(segment => segment.pauseAfter > 0 || segment.kind === 'manual');
    if (!needsStructuredPause) {
      const audio = await tts.generate(request.text, { voice, speed });
      const blob = audio.toBlob();
      const sampleRate = audio.sampling_rate || 24000;
      return { audio: blob, mime: blob.type || 'audio/wav', duration: audio.data.length / sampleRate };
    }

    const pieces: Float32Array[] = [];
    let sampleRate = 24000;
    for (const segment of pausePlan) {
      const spoken = segment.text.trim();
      if (spoken) {
        const audio = await tts.generate(spoken, { voice, speed });
        sampleRate = audio.sampling_rate || sampleRate;
        pieces.push(audio.data);
      }
      const silenceFrames = Math.max(0, Math.round(segment.pauseAfter * sampleRate));
      if (silenceFrames) pieces.push(new Float32Array(silenceFrames));
    }
    const data = concatFloat32(pieces);
    const blob = monoFloat32ToWavBlob(data, sampleRate);
    return { audio: blob, mime: 'audio/wav', duration: data.length / sampleRate };
  }
}
