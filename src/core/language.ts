/** Language slots shared by speech and accent policy; exact locale wins. */
export function languageBase(language: string): string {
  return (language || 'auto').trim().toLowerCase().split('-')[0]!;
}

export function resolveLanguageSlot<T>(slots: Record<string, T>, language: string): T | undefined {
  const locale = language.trim().toLowerCase();
  return Object.entries(slots).find(([key]) => key.toLowerCase() === locale)?.[1]
    ?? slots[languageBase(locale)]
    ?? Object.entries(slots).find(([key]) => languageBase(key) === languageBase(locale))?.[1]
    ?? slots.auto;
}
