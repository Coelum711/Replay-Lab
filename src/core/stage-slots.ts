import type { StagePosition } from './types.js';

/** Normalized horizontal centre of a VN slot (shared by the compiler and the canvas renderer). */
export function stageSlotX(position: StagePosition, count: number, index = 0, positions: StagePosition[] = []): number {
  const named = positions.filter(value => value !== 'auto');
  const duplicateSlots = positions.length === count && new Set(named).size < named.length;
  if (count > 3 || duplicateSlots) {
    const left = count >= 5 ? 0.10 : 0.14, right = 1 - left;
    return count <= 1 ? 0.5 : left + (right - left) * (Math.max(0, Math.min(count - 1, index)) / (count - 1));
  }
  return position === 'left' ? 0.22 : position === 'right' ? 0.78 : 0.5;
}
