import type { ReplayCharacter } from './types.js';

export type CharacterNameResolutionKind = 'primary' | 'alias' | 'ambiguous' | 'none';

export interface CharacterNameResolution {
  kind: CharacterNameResolutionKind;
  character: ReplayCharacter | null;
  matches: ReplayCharacter[];
}

export function normalizeCharacterNameKey(value: string): string {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s_.·・—–\-‐‑'"“”‘’()[\]{}（）【】《》<>:：;,，。!?！？/\\]+/g, '');
}

export function characterNameVariants(character: Pick<ReplayCharacter, 'name' | 'aliases'>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of [character.name, ...(character.aliases ?? [])]) {
    const clean = String(value ?? '').trim();
    const key = normalizeCharacterNameKey(clean);
    if (!clean || !key || seen.has(key)) continue;
    seen.add(key); out.push(clean);
  }
  return out;
}

export function characterMatchesName(character: Pick<ReplayCharacter, 'name' | 'aliases'>, candidate: string): boolean {
  const key = normalizeCharacterNameKey(candidate);
  if (!key) return false;
  return characterNameVariants(character).some(value => normalizeCharacterNameKey(value) === key);
}

/**
 * Resolve an imported/display name conservatively.
 *
 * Priority is intentionally asymmetric:
 * 1. one exact primary display-name match;
 * 2. one normalized primary-name match;
 * 3. one confirmed alias match;
 * 4. ambiguity is returned instead of choosing by array order.
 *
 * This prevents two characters sharing an alias from silently stealing each
 * other's newly imported dialogue. Callers may surface the ambiguity or create
 * a visible duplicate that the user can merge explicitly later.
 */
export function resolveCharacterName(characters: ReplayCharacter[], candidate: string): CharacterNameResolution {
  const clean = String(candidate ?? '').trim();
  const key = normalizeCharacterNameKey(clean);
  if (!key) return { kind: 'none', character: null, matches: [] };

  const exactPrimary = characters.filter(character => String(character.name ?? '').trim() === clean);
  if (exactPrimary.length === 1) return { kind: 'primary', character: exactPrimary[0]!, matches: exactPrimary };
  if (exactPrimary.length > 1) return { kind: 'ambiguous', character: null, matches: exactPrimary };

  const normalizedPrimary = characters.filter(character => normalizeCharacterNameKey(character.name) === key);
  if (normalizedPrimary.length === 1) return { kind: 'primary', character: normalizedPrimary[0]!, matches: normalizedPrimary };
  if (normalizedPrimary.length > 1) return { kind: 'ambiguous', character: null, matches: normalizedPrimary };

  const aliasMatches = characters.filter(character => (character.aliases ?? []).some(alias => normalizeCharacterNameKey(alias) === key));
  if (aliasMatches.length === 1) return { kind: 'alias', character: aliasMatches[0]!, matches: aliasMatches };
  if (aliasMatches.length > 1) return { kind: 'ambiguous', character: null, matches: aliasMatches };
  return { kind: 'none', character: null, matches: [] };
}

export function addCharacterAlias(character: ReplayCharacter, alias: string): boolean {
  const clean = alias.trim();
  const key = normalizeCharacterNameKey(clean);
  if (!key || key === normalizeCharacterNameKey(character.name)) return false;
  character.aliases ??= [];
  if (character.aliases.some(value => normalizeCharacterNameKey(value) === key)) return false;
  character.aliases.push(clean);
  return true;
}
