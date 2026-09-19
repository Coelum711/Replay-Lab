let counter = 0;
export function makeId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function stableColor(input: string): string {
  const palette = ['#8b7cf0','#57b8a9','#d08a62','#6e9bd1','#c46fa6','#b2a35d','#6fb276','#d06f78','#4fc3f7','#9ccc65'];
  let hash = 2166136261;
  for (const ch of input) {
    hash ^= ch.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return palette[(hash >>> 0) % palette.length]!;
}
