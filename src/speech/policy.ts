import type { ReplayCharacter, ReplayLine, ReplayProject, VoicePreset } from '../core/types.js';
import type { ResolvedAccent } from '../pronunciation/types.js';
import { resolveCharacterAccent, accentTranslationStyleKey } from '../pronunciation/accent.js';
import { languageBase, resolveLanguageSlot } from '../core/language.js';
export { languageBase } from '../core/language.js';

export interface ResolvedSpeechPolicy {
  sourceLanguage: string;
  targetLanguage: string;
  shouldTranslate: boolean;
  translationProvider?: string;
  ttsProvider?: string;
  voice: VoicePreset;
  accent?: ResolvedAccent;
}

export function sameLanguage(a: string, b: string): boolean {
  if (!a || !b || a === 'auto' || b === 'auto') return a === b;
  return languageBase(a) === languageBase(b);
}

export function resolveSpeechTargetLanguage(project: ReplayProject, line: ReplayLine): string {
  const character = project.characters.find(c => c.id === line.speakerId);
  const projectSpeechLanguage = project.settings.speechLanguage && project.settings.speechLanguage !== 'auto'
    ? project.settings.speechLanguage
    : null;
  return [line.speech?.languageOverride, character?.speech?.defaultLanguage,
    projectSpeechLanguage, project.settings.logLanguage].map(x => x?.trim())
    .find(x => x && x.toLowerCase() !== 'auto') || 'auto';
}

export function resolveSpeechSourceLanguage(project: ReplayProject, line: ReplayLine): string {
  return line.speech?.sourceLanguage || project.settings.logLanguage || 'auto';
}

export function resolveVoice(character: ReplayCharacter | undefined, targetLanguage: string, line: ReplayLine): VoicePreset {
  const inherited = resolveLanguageSlot(character?.speech?.voices ?? {}, targetLanguage) ?? character?.voice ?? {};
  return { ...inherited, ...line.speech?.voice, ...line.speech?.acting };
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
  const validCache = isTranslationCacheValid(line, policy);
  if (policy.shouldTranslate && validCache) return { text: cache!.text, language: policy.targetLanguage, translationPending: false };
  return { text: line.text, language: policy.targetLanguage, translationPending: policy.shouldTranslate };
}

export function isTranslationCacheValid(line: ReplayLine, policy: ResolvedSpeechPolicy): boolean {
  const cache = line.speech?.translationCache;
  return !!cache && cache.sourceText === line.text
    && cache.sourceLanguage === policy.sourceLanguage
    && cache.targetLanguage === policy.targetLanguage
    && cache.provider === policy.translationProvider
    && (cache.styleKey ?? '') === accentTranslationStyleKey(policy.accent);
}
