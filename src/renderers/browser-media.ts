import type { PerformanceDocument } from '../core/types.js';
import { CanvasStageRenderer, type BrowserAssetResolver, type BrowserAssetSource } from './canvas-stage.js';

export interface AudioScheduleEvent {
  assetId: string;
  start: number;
  end?: number;
  volume: number;
  pan: number;
  loop: boolean;
  kind: 'voice' | 'sfx' | 'bgm' | 'ambient';
  lineId?: string;
  fadeIn?: number;
  fadeOut?: number;
}

interface VoiceInterval { start: number; end: number; }

function audioSettings(performance: PerformanceDocument) {
  const legacy = performance.settings as any;
  return legacy.audioMix ?? {
    masterVolume: 1,
    voiceVolume: 1,
    bgmVolume: legacy.bgmVolume ?? 0.24,
    ambientVolume: 0.34,
    sfxVolume: legacy.sfxVolume ?? 0.70,
    bgmCrossfadeSeconds: 0.8,
    ducking: { enabled: true, bgmGain: 0.48, ambientGain: 0.72, attackSeconds: 0.12, releaseSeconds: 0.35 },
    limiter: { enabled: true, threshold: 0.95 }
  };
}

function voiceIntervals(performance: PerformanceDocument): VoiceInterval[] {
  const out: VoiceInterval[] = [];
  if(audioSettings(performance).voiceVolume<=0)return out;
  for (const line of performance.lines) {
    if (!line.audioAssetId || (line.audioMix?.voiceGain ?? 1)<=0) continue;
    const offset = Number(line.audioMix?.voiceOffset) || 0;
    const pre = Math.max(0, Number(line.audioMix?.preRoll) || 0);
    const post = Math.max(0, Number(line.audioMix?.postRoll) || 0);
    const start = Math.max(0, line.start + offset + pre);
    const end = Math.max(start, line.end - post);
    out.push({ start, end });
  }
  return out;
}

export function buildAudioSchedule(performance: PerformanceDocument): AudioScheduleEvent[] {
  const events: AudioScheduleEvent[] = [];
  const mix = audioSettings(performance);
  for (const line of performance.lines) {
    if (line.audioAssetId) {
      const start = Math.max(0, line.start + (Number(line.audioMix?.preRoll) || 0) + (Number(line.audioMix?.voiceOffset) || 0));
      events.push({
        assetId: line.audioAssetId,
        start,
        volume: mix.voiceVolume * Math.max(0, Number(line.audioMix?.voiceGain ?? 1)),
        pan: Math.max(-1, Math.min(1, Number(line.audioMix?.voicePan) || 0)),
        loop: false,
        kind: 'voice',
        lineId: line.lineId,
        ...(line.voiceClip ? { end: line.end, fadeOut: 0.04 } : {})
      });
    }
    if (line.sfxAssetId) events.push({
      assetId: line.sfxAssetId,
      start: line.start,
      volume: mix.sfxVolume * Math.max(0, Number(line.audioMix?.sfxGain ?? 1)),
      pan: Math.max(-1, Math.min(1, Number(line.audioMix?.sfxPan) || 0)),
      loop: false,
      kind: 'sfx',
      lineId: line.lineId
    });
  }

  // Long-form looped beds use state spans. BGM overlaps on changes for an actual crossfade.
  let activeBgmId: string | null = null;
  let activeBgmStart = 0;
  let activeBgmFadeIn = 0;
  let activeAmbientId: string | null = null;
  let activeAmbientStart = 0;
  for (const line of performance.lines) {
    const nextBgm = line.state.bgm;
    if (nextBgm !== activeBgmId) {
      const fade = Math.max(0, Number(line.bgmFadeSeconds ?? mix.bgmCrossfadeSeconds) || 0);
      if (activeBgmId) events.push({ assetId: activeBgmId, start: activeBgmStart, end: Math.min(performance.duration, line.start + fade), volume: mix.bgmVolume, pan: 0, loop: true, kind: 'bgm', fadeIn: activeBgmFadeIn, fadeOut: fade });
      activeBgmId = nextBgm;
      activeBgmStart = line.start;
      activeBgmFadeIn = fade;
    }
    const nextAmbient = line.state.ambient;
    if (nextAmbient !== activeAmbientId) {
      const fade = 0.5;
      if (activeAmbientId) events.push({ assetId: activeAmbientId, start: activeAmbientStart, end: Math.min(performance.duration, line.start + fade), volume: mix.ambientVolume, pan: 0, loop: true, kind: 'ambient', fadeIn: 0.35, fadeOut: fade });
      activeAmbientId = nextAmbient;
      activeAmbientStart = line.start;
    }
  }
  if (activeBgmId) events.push({ assetId: activeBgmId, start: activeBgmStart, end: performance.duration, volume: mix.bgmVolume, pan: 0, loop: true, kind: 'bgm', fadeIn: activeBgmFadeIn, fadeOut: 0 });
  if (activeAmbientId) events.push({ assetId: activeAmbientId, start: activeAmbientStart, end: performance.duration, volume: mix.ambientVolume, pan: 0, loop: true, kind: 'ambient', fadeIn: 0.35, fadeOut: 0 });
  return events.sort((a, b) => a.start - b.start || (a.kind === 'voice' ? -1 : 1));
}

/** One combined envelope prevents ducking automation from overwriting crossfades. */
export function audioEnvelopePoints(event: AudioScheduleEvent, offset: number, performance: PerformanceDocument): Array<{time:number;value:number}> {
  const start=Math.max(event.start,offset),end=Math.max(start,event.end??performance.duration);
  const fadeIn=Math.max(0,event.fadeIn??0),fadeOut=Math.max(0,event.fadeOut??0);
  const mix=audioSettings(performance),duck=mix.ducking;
  const attack=Math.max(.01,duck?.attackSeconds??.12),release=Math.max(.01,duck?.releaseSeconds??.35);
  const voices=duck?.enabled&&(event.kind==='bgm'||event.kind==='ambient')
    ?voiceIntervals(performance).filter(v=>v.end+release>start&&v.start-attack<end):[];
  const duckGain=Math.max(0,Math.min(1,event.kind==='bgm'?(duck?.bgmGain??1):(duck?.ambientGain??1)));
  const clamp=(n:number)=>Math.max(0,Math.min(1,n));
  const value=(time:number)=>{
    const fade=(fadeIn?clamp((time-event.start)/fadeIn):1)*(fadeOut&&event.end!==undefined?clamp((end-time)/fadeOut):1);
    let factor=1;
    for(const voice of voices){
      const amount=time<voice.start?clamp((time-voice.start+attack)/attack):time<=voice.end?1:clamp((voice.end+release-time)/release);
      factor=Math.min(factor,1-(1-duckGain)*amount);
    }
    return Math.max(0,event.volume)*fade*factor;
  };
  const boundaries=new Set([start,end]);
  for(const t of [event.start+fadeIn,end-fadeOut,...voices.flatMap(v=>[v.start-attack,v.start,v.end,v.end+release])]){
    if(t>start&&t<end)boundaries.add(t);
  }
  const times=[...boundaries].sort((a,b)=>a-b),points=[{time:start,value:value(start)}];
  const append=(a:number,b:number,depth=0)=>{
    const mid=(a+b)/2;
    if(depth<8&&Math.abs(value(mid)-(value(a)+value(b))/2)>.0005){append(a,mid,depth+1);append(mid,b,depth+1);}
    else points.push({time:b,value:value(b)});
  };
  for(let i=1;i<times.length;i++)append(times[i-1]!,times[i]!);
  return points;
}

function applyEnvelope(gain: AudioParam,event: AudioScheduleEvent,baseTime:number,offset:number,performance:PerformanceDocument):void {
  const points=audioEnvelopePoints(event,offset,performance);
  const first=points[0]!;
  gain.cancelScheduledValues(baseTime+first.time-offset);
  gain.setValueAtTime(first.value,baseTime+first.time-offset);
  for(const point of points.slice(1))gain.linearRampToValueAtTime(point.value,baseTime+point.time-offset);
}

async function sourceArrayBuffer(source: BrowserAssetSource): Promise<ArrayBuffer | null> {
  if (!source) return null;
  if (source instanceof Blob) return await source.arrayBuffer();
  if (source instanceof ArrayBuffer) return source;
  if (source instanceof Uint8Array) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
  if (typeof source === 'string') {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Asset fetch failed: ${response.status}`);
    return await response.arrayBuffer();
  }
  return null;
}

interface ScheduledSource { source: AudioBufferSourceNode; }

export const DEFAULT_MEDIABUNNY_MODULE = 'mediabunny';

export interface FastMp4ExportOptions {
  fps?: number;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
  /** Render/mix duration per offline chunk. Smaller chunks reduce peak memory. */
  chunkSeconds?: number;
  /** Use an installed package name or an ESM URL (for the static browser workbench). */
  moduleSpecifier?: string;
  /** When supplied, encoded MP4 bytes are streamed directly here instead of accumulated in RAM. */
  writable?: WritableStream;
  /** Approximate decoded-audio cache budget used only during offline export. */
  decodedAudioCacheBytes?: number;
  /** Abort a long export without leaving encoders or output streams open. */
  signal?: AbortSignal;
  onProgress?: (progress: number, phase: 'loading' | 'audio' | 'video' | 'finalizing') => void;
}

export interface FastMp4ExportResult {
  blob: Blob | null;
  bytesWritten: number;
  streamed: boolean;
  mimeType: 'video/mp4';
}

export function estimateEncodedBytes(
  durationSeconds: number,
  videoBitsPerSecond = 2_000_000,
  audioBitsPerSecond = 128_000
): number {
  return Math.max(0, durationSeconds) * Math.max(0, videoBitsPerSecond + audioBitsPerSecond) / 8;
}

export interface ReplayPlayerCallbacks {
  onTime?: (time: number, lineIndex: number) => void;
  onStop?: () => void;
}

export class BrowserReplayPlayer {
  private performance: PerformanceDocument;
  private renderer: CanvasStageRenderer;
  private resolveAsset: BrowserAssetResolver;
  private audioContext: AudioContext | null = null;
  private audioBuffers = new Map<string, Promise<AudioBuffer | null>>();
  private scheduled: ScheduledSource[] = [];
  private heldBeds = new Map<string, { source: AudioBufferSourceNode; gain: GainNode; base: number }>();
  private lineFinished: (() => void) | null = null;
  private raf = 0;
  private generation = 0;
  private callbacks: ReplayPlayerCallbacks;

  constructor(performance: PerformanceDocument, renderer: CanvasStageRenderer, resolveAsset: BrowserAssetResolver, callbacks: ReplayPlayerCallbacks = {}) {
    this.performance = performance; this.renderer = renderer; this.resolveAsset = resolveAsset; this.callbacks = callbacks;
  }

  setPerformance(performance: PerformanceDocument): void { this.stop(); this.performance = performance; this.renderer.setPerformance(performance); }

  private async context(): Promise<AudioContext> {
    if (!this.audioContext || this.audioContext.state === 'closed') this.audioContext = new AudioContext();
    if (this.audioContext.state === 'suspended') await this.audioContext.resume();
    return this.audioContext;
  }

  private async buffer(assetId: string, context: AudioContext): Promise<AudioBuffer | null> {
    let promise = this.audioBuffers.get(assetId);
    if (!promise) {
      promise = (async () => {
        const bytes = await sourceArrayBuffer(await this.resolveAsset(assetId));
        if (!bytes) return null;
        return await context.decodeAudioData(bytes.slice(0));
      })().catch(() => { this.audioBuffers.delete(assetId); return null; });
      this.audioBuffers.set(assetId, promise);
    }
    return promise;
  }

  clearAudioCache(): void { this.audioBuffers.clear(); }

  async dispose(): Promise<void> {
    this.stop();this.clearAudioCache();
    if(this.audioContext && this.audioContext.state!=='closed')await this.audioContext.close();
    this.audioContext=null;
  }

  stop(): void {
    this.stopLine();
    for (const bed of this.heldBeds.values()) { try { bed.source.stop(); } catch {} }
    this.heldBeds.clear();
  }

  /** Stops the current line's voice/SFX and animation; beds held for VN reading keep playing. */
  stopLine(): void {
    this.generation += 1;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const item of this.scheduled) { try { item.source.stop(); } catch {} }
    this.scheduled = [];
    this.callbacks.onStop?.();
    const finished = this.lineFinished;
    this.lineFinished = null;
    finished?.();
  }

  /** Keeps BGM/ambient continuous across reader-paced VN lines: only a changed track is restarted. */
  private async syncHeldBeds(line: PerformanceDocument['lines'][number], context: AudioContext, generation: number): Promise<void> {
    const mix = audioSettings(this.performance), master = Math.max(0, Number(mix.masterVolume) || 0);
    const ducked = Boolean(line.audioAssetId && mix.ducking?.enabled);
    const wanted = new Map<string, { assetId: string; base: number; gain: number }>();
    if (line.state.bgm) wanted.set(`bgm:${line.state.bgm}`, { assetId: line.state.bgm, base: mix.bgmVolume * master, gain: ducked ? mix.ducking.bgmGain : 1 });
    if (line.state.ambient) wanted.set(`ambient:${line.state.ambient}`, { assetId: line.state.ambient, base: mix.ambientVolume * master, gain: ducked ? mix.ducking.ambientGain : 1 });
    const fade = Math.max(0.05, Number(mix.bgmCrossfadeSeconds) || 0);
    const now = context.currentTime;
    for (const [key, bed] of this.heldBeds) {
      if (wanted.has(key)) continue;
      bed.gain.gain.cancelScheduledValues(now);
      bed.gain.gain.setTargetAtTime(0, now, fade / 3);
      try { bed.source.stop(now + fade); } catch {}
      this.heldBeds.delete(key);
    }
    for (const [key, target] of wanted) {
      let bed = this.heldBeds.get(key);
      if (!bed) {
        const buffer = await this.buffer(target.assetId, context);
        if (generation !== this.generation) return;
        if (!buffer) continue;
        const source = context.createBufferSource(), gain = context.createGain();
        source.buffer = buffer; source.loop = true; gain.gain.value = 0;
        source.connect(gain).connect(context.destination);
        source.start();
        bed = { source, gain, base: target.base };
        this.heldBeds.set(key, bed);
      }
      bed.gain.gain.setTargetAtTime(Math.max(0, target.base * target.gain), context.currentTime, 0.12);
    }
  }

  private releaseHeldBedDucking(): void {
    const context = this.audioContext;
    if (!context) return;
    for (const bed of this.heldBeds.values()) bed.gain.gain.setTargetAtTime(Math.max(0, bed.base), context.currentTime, 0.3);
  }

  private async scheduleAudio(events: AudioScheduleEvent[], offset: number, destination: AudioNode, audible = true, generation = this.generation): Promise<{ context: AudioContext; base: number }> {
    const context = await this.context();
    if(generation!==this.generation)return {context,base:context.currentTime};
    const prepared: Array<{ event: AudioScheduleEvent; buffer: AudioBuffer }> = [];
    for (const event of events) {
      if (event.end !== undefined && event.end <= offset) continue;
      const buffer = await this.buffer(event.assetId, context);
      if(generation!==this.generation)return {context,base:context.currentTime};
      if (buffer) prepared.push({ event, buffer });
    }
    const mix = audioSettings(this.performance);
    const master = context.createGain();
    master.gain.value = Math.max(0, Number(mix.masterVolume) || 0);
    let tail: AudioNode = master;
    if (mix.limiter?.enabled) {
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = 20 * Math.log10(Math.max(0.01, Math.min(1, Number(mix.limiter.threshold) || 0.95)));
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.08;
      tail.connect(limiter); tail = limiter;
    }
    tail.connect(destination);
    if (audible && destination !== context.destination) tail.connect(context.destination);
    const base = context.currentTime + 0.08;
    for (const { event, buffer } of prepared) {
      const source = context.createBufferSource();
      const gain = context.createGain();
      const panner = context.createStereoPanner();
      source.buffer = buffer; source.loop = event.loop;
      panner.pan.value = Math.max(-1, Math.min(1, Number(event.pan) || 0));
      source.connect(gain).connect(panner).connect(master);
      applyEnvelope(gain.gain, event, base, offset, this.performance);
      const eventStart = Math.max(event.start, offset);
      const seek = Math.max(0, offset - event.start);
      const when = base + (eventStart - offset);
      source.start(when, event.loop && buffer.duration ? seek % buffer.duration : seek);
      if (event.end !== undefined) { try { source.stop(base + Math.max(0, event.end - offset)); } catch {} }
      this.scheduled.push({ source });
    }
    return { context, base };
  }

  async playAll(fromTime = 0): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    const context = await this.context();
    if(generation!==this.generation)return;
    await this.scheduleAudio(buildAudioSchedule(this.performance), fromTime, context.destination, false, generation);
    if(generation!==this.generation)return;
    const wall = performance.now() / 1000 + 0.08;
    const tick = async (): Promise<void> => {
      if (generation !== this.generation) return;
      const time = fromTime + Math.max(0, performance.now() / 1000 - wall);
      if (time >= this.performance.duration) { this.stop(); return; }
      const located = await this.renderer.renderAt(time);
      if(generation!==this.generation)return;
      if (located) this.callbacks.onTime?.(time, located.index);
      this.raf = requestAnimationFrame(() => { void tick(); });
    };
    this.raf = requestAnimationFrame(() => { void tick(); });
  }

  /** Resolves once the line is started. `holdBeds` is the VN mode: BGM/ambient outlive the line. */
  async playLine(index: number, options: { holdBeds?: boolean } = {}): Promise<void> {
    const line = this.performance.lines[index]; if (!line) return;
    const holdBeds = Boolean(options.holdBeds);
    if (holdBeds) this.stopLine(); else this.stop();
    const generation = ++this.generation;
    const context = await this.context();
    if(generation!==this.generation)return;
    if(holdBeds){await this.syncHeldBeds(line,context,generation);if(generation!==this.generation)return;}
    const events = buildAudioSchedule(this.performance).filter(event => event.kind === 'bgm' || event.kind === 'ambient' ? !holdBeds : (event.start >= line.start && event.start < line.end));
    await this.scheduleAudio(events, line.start, context.destination, false,generation);
    if(generation!==this.generation)return;
    const wall = performance.now() / 1000 + 0.08;
    const tick = async (): Promise<void> => {
      if (generation !== this.generation) return;
      const local = Math.max(0, performance.now() / 1000 - wall);
      if (local >= line.duration) {
        if (holdBeds) { this.stopLine(); this.releaseHeldBedDucking(); } else this.stop();
        await this.renderer.renderLine(index, line.duration);
        return;
      }
      await this.renderer.renderLine(index, local);
      if(generation!==this.generation)return;
      this.callbacks.onTime?.(line.start + local, index);
      this.raf = requestAnimationFrame(() => { void tick(); });
    };
    this.raf = requestAnimationFrame(() => { void tick(); });
  }

  /** Like playLine, but resolves when the line has finished or was stopped. */
  async playLineUntilEnd(index: number, options: { holdBeds?: boolean } = {}): Promise<void> {
    if (!this.performance.lines[index]) return;
    const started = this.playLine(index, options);
    const finished = new Promise<void>(resolve => { this.lineFinished = resolve; });
    await started;
    await finished;
  }

  private async decodeAudioAsset(assetId: string, context: AudioContext): Promise<AudioBuffer | null> {
    try {
      const bytes = await sourceArrayBuffer(await this.resolveAsset(assetId));
      if (!bytes) return null;
      return await context.decodeAudioData(bytes.slice(0));
    } catch {
      return null;
    }
  }

  private async renderAudioChunk(
    events: AudioScheduleEvent[],
    buffers: Map<string, AudioBuffer>,
    chunkStart: number,
    chunkDuration: number,
    sampleRate = 48_000
  ): Promise<AudioBuffer> {
    const frameCount = Math.max(1, Math.ceil(chunkDuration * sampleRate));
    const mix = audioSettings(this.performance);
    // A fresh limiter outputs ~6 ms of silence and has no gain history. Render a little earlier and
    // discard that part so chunks join without a gap.
    const latencyFrames = mix.limiter?.enabled ? Math.round(0.006 * sampleRate) : 0;
    const leadFrames = mix.limiter?.enabled ? Math.round(Math.min(chunkStart, 0.1) * sampleRate) : 0;
    const renderStart = chunkStart - leadFrames / sampleRate;
    const totalFrames = leadFrames + frameCount + latencyFrames;
    const offline = new OfflineAudioContext(2, totalFrames, sampleRate);
    const master = offline.createGain();
    master.gain.value = Math.max(0, Number(mix.masterVolume) || 0);
    let tail: AudioNode = master;
    if (mix.limiter?.enabled) {
      const limiter = offline.createDynamicsCompressor();
      limiter.threshold.value = 20 * Math.log10(Math.max(0.01, Math.min(1, Number(mix.limiter.threshold) || 0.95)));
      limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.08;
      tail.connect(limiter); tail = limiter;
    }
    tail.connect(offline.destination);
    const chunkEnd = renderStart + totalFrames / sampleRate;
    for (const event of events) {
      const buffer = buffers.get(event.assetId);
      if (!buffer || buffer.duration <= 0) continue;
      const naturalEnd = event.loop ? (event.end ?? this.performance.duration) : Math.min(event.end ?? Infinity, event.start + buffer.duration);
      const overlapStart = Math.max(renderStart, event.start);
      const overlapEnd = Math.min(chunkEnd, naturalEnd);
      if (overlapEnd <= overlapStart) continue;
      const source = offline.createBufferSource();
      const gain = offline.createGain();
      const panner = offline.createStereoPanner();
      source.buffer = buffer;
      source.loop = event.loop;
      panner.pan.value = Math.max(-1, Math.min(1, Number(event.pan) || 0));
      source.connect(gain).connect(panner).connect(master);
      applyEnvelope(gain.gain, event, 0, renderStart, this.performance);
      const seek = Math.max(0, overlapStart - event.start);
      const offset = event.loop ? seek % buffer.duration : seek;
      source.start(overlapStart - renderStart, offset);
      source.stop(overlapEnd - renderStart);
    }
    const rendered = await offline.startRendering();
    if (!leadFrames && !latencyFrames) return rendered;
    const output = new AudioBuffer({ length: frameCount, numberOfChannels: 2, sampleRate });
    const skip = leadFrames + latencyFrames;
    for (let channel = 0; channel < 2; channel += 1) output.copyToChannel(rendered.getChannelData(channel).subarray(skip, skip + frameCount), channel);
    return output;
  }

  /**
   * Fast, offline MP4 export. Unlike MediaRecorder, this does not play the replay in real time:
   * Canvas frames are rendered deterministically, encoded through WebCodecs by Mediabunny,
   * and muxed directly to MP4. If `writable` is supplied the file is streamed to disk.
   */
  async exportMp4Fast(options: FastMp4ExportOptions = {}): Promise<FastMp4ExportResult> {
    this.stop();
    const throwIfAborted = () => {
      if (options.signal?.aborted) throw new DOMException('Export canceled.', 'AbortError');
    };
    throwIfAborted();
    options.onProgress?.(0, 'loading');
    const specifier = options.moduleSpecifier ?? DEFAULT_MEDIABUNNY_MODULE;
    const mb = await import(specifier) as any;
    throwIfAborted();
    const fps = Math.max(1, options.fps ?? 30);
    const videoBits = Math.max(100_000, options.videoBitsPerSecond ?? 2_000_000);
    const audioBits = Math.max(32_000, options.audioBitsPerSecond ?? 128_000);
    const chunkSeconds = Math.max(2, options.chunkSeconds ?? 10);
    const target = options.writable
      ? new mb.StreamTarget(options.writable, { chunked: true, chunkSize: 2 ** 20 })
      : new mb.BufferTarget();
    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: options.writable ? false : 'in-memory' }),
      target
    });
    let bytesWritten = 0;
    target.on?.('write', ({ end }: { end: number }) => { bytesWritten = Math.max(bytesWritten, end); });
    const videoSource = new mb.CanvasSource(this.renderer.element, {
      codec: 'avc',
      quality: new mb.Quality({ bitrate: videoBits })
    });
    output.addVideoTrack(videoSource, { frameRate: fps });

    const events = buildAudioSchedule(this.performance);
    let audioSource: any = null;
    let decodeContext: AudioContext | null = null;
    const decodedBudget = Math.max(8 * 1024 * 1024, options.decodedAudioCacheBytes ?? 96 * 1024 * 1024);
    const decoded = new Map<string, { buffer: AudioBuffer; bytes: number; usedAt: number }>();
    let decodedBytes = 0;
    let decodeTick = 0;
    const activeAudio: Array<{ event: AudioScheduleEvent; naturalEnd: number }> = [];
    let audioEventCursor = 0;
    const decodeForExport = async (assetId: string): Promise<AudioBuffer | null> => {
      const cached = decoded.get(assetId);
      if (cached) { cached.usedAt = ++decodeTick; return cached.buffer; }
      if (!decodeContext) return null;
      const buffer = await this.decodeAudioAsset(assetId, decodeContext);
      if (!buffer) return null;
      const bytes = buffer.length * Math.max(1, buffer.numberOfChannels) * 4;
      decoded.set(assetId, { buffer, bytes, usedAt: ++decodeTick });
      decodedBytes += bytes;
      return buffer;
    };
    const evictDecoded = (protectedIds: Set<string>): void => {
      if (decodedBytes <= decodedBudget) return;
      const candidates = [...decoded.entries()]
        .filter(([id]) => !protectedIds.has(id))
        .sort((a, b) => a[1].usedAt - b[1].usedAt);
      for (const [id, item] of candidates) {
        decoded.delete(id); decodedBytes -= item.bytes;
        if (decodedBytes <= decodedBudget) break;
      }
    };
    if (events.length) {
      audioSource = new mb.AudioBufferSource({ codec: 'aac', quality: new mb.Quality({ bitrate: audioBits }) });
      output.addAudioTrack(audioSource);
      decodeContext = await this.context();
    }

    try {
      await output.start();
      throwIfAborted();
      const duration = Math.max(0, this.performance.duration);
      const totalFrames = Math.max(1, Math.ceil(duration * fps));
      let frameIndex = 0;
      for (let chunkStart = 0; chunkStart < duration || (duration === 0 && chunkStart === 0); chunkStart += chunkSeconds) {
        throwIfAborted();
        const actualDuration = duration === 0 ? 1 / fps : Math.min(chunkSeconds, duration - chunkStart);
        if (audioSource) {
          options.onProgress?.(duration ? Math.min(1, chunkStart / duration) : 0, 'audio');
          const chunkEnd = chunkStart + actualDuration;
          while (audioEventCursor < events.length && events[audioEventCursor]!.start < chunkEnd) {
            const event = events[audioEventCursor++]!;
            const buffer = await decodeForExport(event.assetId);
            if (!buffer || buffer.duration <= 0) continue;
            const naturalEnd = event.loop
              ? (event.end ?? duration)
              : Math.min(event.end ?? Infinity, event.start + buffer.duration);
            if (naturalEnd > chunkStart) activeAudio.push({ event, naturalEnd });
          }
          const chunkEvents = activeAudio.filter(item => item.naturalEnd > chunkStart).map(item => item.event);
          const chunkBuffers = new Map<string, AudioBuffer>();
          for (const event of chunkEvents) {
            const buffer = await decodeForExport(event.assetId);
            if (buffer) chunkBuffers.set(event.assetId, buffer);
          }
          const mixed = await this.renderAudioChunk(chunkEvents, chunkBuffers, chunkStart, actualDuration);
          throwIfAborted();
          await audioSource.add(mixed);
          for (let index = activeAudio.length - 1; index >= 0; index -= 1) {
            if (activeAudio[index]!.naturalEnd <= chunkEnd) activeAudio.splice(index, 1);
          }
          evictDecoded(new Set(activeAudio.map(item => item.event.assetId)));
        }
        const chunkEnd = Math.min(duration, chunkStart + actualDuration);
        const chunkEndFrame = duration === 0 ? 1 : Math.min(totalFrames, Math.ceil(chunkEnd * fps));
        while (frameIndex < chunkEndFrame) {
          throwIfAborted();
          const time = duration ? Math.min(duration - 0.000001, frameIndex / fps) : 0;
          await this.renderer.renderAt(Math.max(0, time));
          await videoSource.add(frameIndex / fps, 1 / fps);
          frameIndex += 1;
          options.onProgress?.(frameIndex / totalFrames, 'video');
        }
        if (duration === 0) break;
      }
      throwIfAborted();
      audioSource?.close?.();
      videoSource.close?.();
      options.onProgress?.(1, 'finalizing');
      await output.finalize();
      if (!options.writable) {
        const buffer = target.buffer as ArrayBuffer | Uint8Array | null;
        if (!buffer) throw new Error('MP4 encoder finalized without an output buffer.');
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        bytesWritten = Math.max(bytesWritten, bytes.byteLength);
        return { blob: new Blob([bytes], { type: 'video/mp4' }), bytesWritten, streamed: false, mimeType: 'video/mp4' };
      }
      return { blob: null, bytesWritten, streamed: true, mimeType: 'video/mp4' };
    } catch (error) {
      try { await output.cancel(); } catch {}
      throw error;
    } finally {
      try{audioSource?.close?.();}catch{}try{videoSource.close?.();}catch{}decoded.clear();
    }
  }

  async exportWebM(options: { fps?: number; videoBitsPerSecond?: number; onProgress?: (progress: number) => void } = {}): Promise<Blob> {
    this.stop();
    const fps = options.fps ?? 30;
    const stream = this.renderer.element.captureStream(fps);
    const tracks=stream.getTracks();let stopRecorder=()=>{};
    try {
    const context = await this.context();
    const destination = context.createMediaStreamDestination();
    tracks.push(...destination.stream.getTracks());
    await this.scheduleAudio(buildAudioSchedule(this.performance), 0, destination, false);
    const combined = new MediaStream([...stream.getVideoTracks(), ...destination.stream.getAudioTracks()]);
    const mimeTypes = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = mimeTypes.find(type => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error('This browser does not support WebM MediaRecorder export. Use current Chrome/Edge.');
    const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: options.videoBitsPerSecond ?? 5_500_000 });
    stopRecorder=()=>{if(recorder.state!=='inactive')recorder.stop();};
    const chunks: Blob[] = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    let recorderError:unknown;
    const done = new Promise<void>((resolve, reject) => { recorder.onstop = () => resolve(); recorder.onerror = event => {recorderError=event;reject(event);}; });
    void done.catch(()=>{});
    recorder.start(500);
    const wall = performance.now() / 1000 + 0.08;
    await new Promise<void>((resolve, reject) => {
      const frame = async (): Promise<void> => {
        try {
          if(recorderError)throw recorderError;
          const t = Math.max(0, performance.now() / 1000 - wall);
          if (t >= this.performance.duration) { await this.renderer.renderAt(Math.max(0, this.performance.duration - 0.001)); options.onProgress?.(1); recorder.stop(); resolve(); return; }
          await this.renderer.renderAt(t); options.onProgress?.(this.performance.duration ? t / this.performance.duration : 1);
          requestAnimationFrame(() => { void frame(); });
        } catch (error) { reject(error); }
      };
      requestAnimationFrame(() => { void frame(); });
    });
    await done;
    return new Blob(chunks, { type: 'video/webm' });
    } finally {
      try{stopRecorder();}catch{}
      for(const track of tracks)track.stop();
      this.stop();
    }
  }
}
