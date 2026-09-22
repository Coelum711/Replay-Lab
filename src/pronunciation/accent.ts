import type { AccentSelection, ReplayCharacter, ReplayLine } from '../core/types.js';
import { getAccentProfile } from './catalog.js';
import { languageBase, resolveLanguageSlot } from '../core/language.js';
import type { AccentSynthesisHint, AccentTranslationHint, AccentVoiceMatch, ResolvedAccent, VoiceAccentCapability } from './types.js';

export function resolveCharacterAccent(character: ReplayCharacter | undefined, targetLanguage: string, line?: ReplayLine): ResolvedAccent | undefined {
  const override = line?.speech?.accentOverride;
  let selection: AccentSelection | undefined | null = override;
  if (override === undefined) {
    const accents = character?.speech?.accents ?? {};
    selection = resolveLanguageSlot(accents, targetLanguage) ?? null;
  }
  if (!selection || (!selection.accentId && !selection.query)) return undefined;
  const profile = getAccentProfile(selection.accentId);
  return {
    selection,
    profile,
    language: targetLanguage,
    strength: selection.strength ?? 'natural',
    localeFallback: profile?.localeFallback
  };
}

export function accentSynthesisHint(resolved?: ResolvedAccent): AccentSynthesisHint | undefined {
  if (!resolved || resolved.strength === 'off') return undefined;
  const rules = resolved.profile?.rules ?? [];
  const enabled = Array.isArray(resolved.selection.enabledRuleIds)
    ? rules.filter(rule => resolved.selection.enabledRuleIds!.includes(rule.id))
    : rules.filter(rule => rule.defaultEnabled !== false);
  return {
    id: resolved.profile?.id,
    label: resolved.profile?.label,
    query: resolved.selection.query,
    strength: resolved.strength,
    localeFallback: resolved.localeFallback,
    tags: resolved.profile?.tags,
    pronunciationHints: enabled.filter(rule => rule.category === 'pronunciation').map(rule => rule.description),
    prosodyHints: enabled.filter(rule => rule.category === 'prosody').map(rule => rule.description)
  };
}

export function accentTranslationHint(resolved?: ResolvedAccent): AccentTranslationHint | undefined {
  if (!resolved) return undefined;
  const useRegionalVocabulary = !!resolved.selection.useRegionalVocabulary;
  const vocabularyHints = useRegionalVocabulary
    ? (resolved.profile?.rules ?? []).filter(rule => rule.category === 'vocabulary'
      && (Array.isArray(resolved.selection.enabledRuleIds) ? resolved.selection.enabledRuleIds.includes(rule.id) : rule.defaultEnabled !== false)).map(rule => rule.description)
    : [];
  return { id: resolved.profile?.id, label: resolved.profile?.label, useRegionalVocabulary, vocabularyHints };
}

export function accentTranslationStyleKey(resolved?: ResolvedAccent): string {
  if (!resolved?.selection.useRegionalVocabulary) return '';
  const ruleIds = resolved.selection.enabledRuleIds?.slice().sort().join(',') ?? '';
  return [resolved.profile?.id ?? resolved.selection.query ?? '', resolved.strength, 'regional-vocab', ruleIds].join('|');
}

export function matchVoiceAccent(resolved: ResolvedAccent | undefined, voice: VoiceAccentCapability): AccentVoiceMatch {
  if (!resolved) return { voiceId: voice.voiceId, support: 'unknown', reason: 'No accent intent selected.' };
  const languageOk = voice.languages.some(language => languageBase(language) === languageBase(resolved.language));
  if (!languageOk) return { voiceId: voice.voiceId, support: 'unknown', reason: 'Voice language does not match accent language.' };
  if (resolved.profile?.id && voice.accentIds?.includes(resolved.profile.id)) return { voiceId: voice.voiceId, support: 'native', reason: 'Voice declares this exact Accent Catalog id.' };
  const tags = new Set((voice.accentTags ?? []).map(x=>x.toLowerCase()));
  if (resolved.profile?.tags.some(tag => tags.has(tag.toLowerCase()))) return { voiceId: voice.voiceId, support: 'approximate', reason: 'Voice shares regional/accent tags.' };
  if (resolved.localeFallback && voice.locales?.some(locale => locale.toLowerCase() === resolved.localeFallback!.toLowerCase())) return { voiceId: voice.voiceId, support: 'locale-fallback', reason: `Voice supports fallback locale ${resolved.localeFallback}.` };
  return { voiceId: voice.voiceId, support: 'unknown', reason: 'No explicit accent or locale match declared.' };
}
