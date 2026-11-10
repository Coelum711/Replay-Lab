import type { ReplayProject, ReplayLine } from '../core/types.js';
import { resolveSpeechPolicy } from './policy.js';
import { resolveSpeechPauseScale, resolvePunctuationPauseTiming } from './pause.js';

export class StaleSpeechError extends Error {
  readonly code = 'stale-speech';
  constructor(message = '台词、角色或声音设置已改变；旧请求结果没有写回，请按最新设置重新生成。') {
    super(message); this.name = 'StaleSpeechError';
  }
}

/** Excludes generated caches. Changes to any effective synthesis input invalidate a job. */
export function speechInputFingerprint(project: ReplayProject, line: ReplayLine): string {
  return JSON.stringify({ text: line.text, speakerId: line.speakerId, type: line.type,
    textOverride: line.speech?.textOverride, segments: line.speech?.segments ?? null, policy: resolveSpeechPolicy(project, line),
    pauseScale: resolveSpeechPauseScale(project, line), pauses: resolvePunctuationPauseTiming(project, line) });
}

export function captureSpeechGuard(project: ReplayProject, line: ReplayLine): () => void {
  const fingerprint = speechInputFingerprint(project, line), audioId = line.audioAssetId;
  return () => {
    if (!project.lines.includes(line) || line.audioAssetId !== audioId || speechInputFingerprint(project, line) !== fingerprint) {
      throw new StaleSpeechError();
    }
  };
}
