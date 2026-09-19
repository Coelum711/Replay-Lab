/*
 * LAB timing handling follows KuchiPaku's public MIT implementation:
 * start/end/phoneme triples and 100 ns tick timing used by common TTS .lab files.
 */
import type { TimedPhoneme } from './types.js';

export function parseLab(input: string): TimedPhoneme[] {
  const rows = input
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split(/\s+/))
    .filter(parts => parts.length >= 3)
    .map(parts => ({ from: Number(parts[0]), to: Number(parts[1]), phoneme: parts[2]! }))
    .filter(row => Number.isFinite(row.from) && Number.isFinite(row.to) && row.to >= row.from);

  const max = rows.reduce((m, r) => Math.max(m, r.to), 0);
  const divisor = max > 10000 ? 10_000_000 : 1;
  return rows.map(row => ({ start: row.from / divisor, end: row.to / divisor, phoneme: row.phoneme }));
}

export function splitLabSentences(lines: TimedPhoneme[], thresholdSeconds: number): TimedPhoneme[][] {
  const voiced = lines.filter(line => line.phoneme !== 'pau' && line.phoneme !== 'sil');
  const result: TimedPhoneme[][] = [];
  let current: TimedPhoneme[] = [];
  voiced.forEach((line, index) => {
    const previous = voiced[index - 1];
    if (previous && line.start - previous.end >= thresholdSeconds && current.length) {
      result.push(current);
      current = [];
    }
    current.push(line);
  });
  if (current.length) result.push(current);
  return result;
}
