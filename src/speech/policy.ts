import type { ReplayCharacter, ReplayLine, ReplayProject, VoicePreset } from '../core/types.js';
import type { ResolvedAccent } from '../pronunciation/types.js';
import { resolveCharacterAccent, accentTranslationStyleKey } from '../pronunciation/accent.js';

export interface ResolvedSpeechPolicy {
  sourceLanguage: string;
  targetLanguage: string;
  shouldTranslate: boolean;
  translationProvider?: string;
  ttsProvider?: string;
  voice: VoicePreset;
  accent?: ResolvedAccent;
}

export function languageBase(language: string): string {
  return (language || 'auto').toLowerCase().split('-')[0]!;
}

export function sameLanguage(a: string, b: string): boolean {
  if (!a || !b || a === 'auto' || b === 'auto') return a === b;
  return languageBase(a) === languageBase(b);
}

export function resolveSpeechTargetLanguage(project: ReplayProject, line: ReplayLine): string {
  const character = project.characters.find(c => c.id === line.speakerId);
  return line.speech?.languageOverride
    || character?.speech?.defaultLanguage
    || project.settings.logLanguage
    || 'auto';
}

export function resolveSpeechSourceLanguage(project: ReplayProject, line: ReplayLine): string {
  return line.speech?.sourceLanguage || project.settings.logLanguage || 'auto';
}

export function resolveVoice(character: ReplayCharacter | undefined, targetLanguage: string, line: ReplayLine): VoicePreset {
  const lineVoice = line.speech?.voice;
  if (lineVoice) return { ...lineVoice };

  const perLanguage = character?.speech?.voices ?? {};
  const exact = perLanguage[targetLanguage];
  if (exact) return { ...exact };
  const base = languageBase(targetLanguage);
  const baseMatch = Object.entries(perLanguage).find(([key]) => languageBase(key) === base)?.[1];
  if (baseMatch) return { ...baseMatch };

  return { ...(character?.voice ?? {}) };
}

export function resolveSpeechPolicy(project: ReplayProject, line: ReplayLine): ResolvedSpeechPolicy {
  const character = project.characters.find(c => c.id === line.speakerId);
  const sourceLanguage = resolveSpeechSourceLanguage(project, line);
  const targetLanguage = resolveSpeechTargetLanguage(project, line);
  const shouldTranslate = !!targetLanguage
    && targetLanguage !== 'auto'
    && (sourceLanguage === 'auto' || !sameLanguage(sourceLanguage, targetLanguage));
  return {
    sourceLanguage,
    targetLanguage,
    shouldTranslate,
    translationProvider: line.speech?.translationProvider || character?.speech?.translationProvider || project.settings.translationProvider,
    ttsProvider: line.speech?.ttsProvider || resolveVoice(character, targetLanguage, line).provider || character?.speech?.ttsProvider || project.settings.ttsProvider || 'replaylab-free',
    voice: resolveVoice(character, targetLanguage, line),
    accent: resolveCharacterAccent(character, targetLanguage, line)
  };
}

export function resolveCachedSpeech(project: ReplayProject, line: ReplayLine): { text: string; language: string; translationPending: boolean } {
  const policy = resolveSpeechPolicy(project, line);
  if (line.speech?.textOverride) return { text: line.speech.textOverride, language: policy.targetLanguage, translationPending: false };
  const cache = line.speech?.translationCache;
  const validCache = !!cache
    && cache.sourceText === line.text
    && cache.sourceLanguage === policy.sourceLanguage
    && cache.targetLanguage === policy.targetLanguage
    && (cache.styleKey ?? '') === accentTranslationStyleKey(policy.accent);
  if (policy.shouldTranslate && validCache) return { text: cache!.text, language: policy.targetLanguage, translationPending: false };
  return { text: line.text, language: policy.targetLanguage, translationPending: policy.shouldTranslate };
}
