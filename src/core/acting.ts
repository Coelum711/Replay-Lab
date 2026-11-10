/** Emotion words of the script tag `角色[情绪]` and the voice emotion menu, with their model prompts. */
export const ACTING_PRESETS: Record<string, string> = {
  温柔: 'warm and gentle',
  压着火气: 'restrained anger, low and cold, do not shout',
  恐惧: 'frightened, breath unsteady, trying to stay quiet',
  疲惫: 'exhausted, quiet and slightly breathy',
  愉快: 'amused, with a slight smile',
  耳语: 'whisper, intimate and close'
};

/** Everything a line says about its mood, as one searchable string (Chinese preset names included). */
export function lineMoodText(line: { speech?: { acting?: { actingPreset?: string; instruct?: string }; persona?: string; segments?: Array<{ instruct?: string }> } }): string {
  const preset = line.speech?.acting?.actingPreset ?? '';
  const presetName = Object.keys(ACTING_PRESETS).find(name => ACTING_PRESETS[name] === preset) ?? '';
  return [presetName, preset, line.speech?.acting?.instruct, line.speech?.persona, ...(line.speech?.segments ?? []).map(segment => segment.instruct)].filter(Boolean).join(' ');
}

/** First sprite state whose trigger words appear in the line's mood, like CharacterPictureManager's conditions. */
export function triggeredExpression(triggers: Record<string, string[]> | undefined, mood: string): string | null {
  if (!triggers || !mood) return null;
  const text = mood.toLowerCase();
  for (const [expression, words] of Object.entries(triggers)) if (words.some(word => word.trim() && text.includes(word.trim().toLowerCase()))) return expression;
  return null;
}
