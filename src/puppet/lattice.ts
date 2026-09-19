/**
 * Minimal regular-lattice deformation utilities.
 * The data model follows Inochi2D's LatticeDeformer concept (BSD-2-Clause):
 * a regular control lattice is the deformation basis; Replay Lab stores
 * normalized deltas so the same rig works for portrait/half/full source sizes.
 */
import type { PuppetLattice, PuppetVec2 } from '../core/types.js';

export function latticePointCount(lattice: PuppetLattice): number {
  return Math.max(2, lattice.columns) * Math.max(2, lattice.rows);
}

export function regularLatticePoints(lattice: PuppetLattice): PuppetVec2[] {
  const cols = Math.max(2, Math.floor(lattice.columns));
  const rows = Math.max(2, Math.floor(lattice.rows));
  const out: PuppetVec2[] = [];
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) out.push({ x: x / (cols - 1), y: y / (rows - 1) });
  return out;
}

export function applyLatticeOffsets(lattice: PuppetLattice, offsets?: PuppetVec2[] | null): PuppetVec2[] {
  const base = regularLatticePoints(lattice);
  return base.map((point, i) => ({ x: point.x + (offsets?.[i]?.x ?? 0), y: point.y + (offsets?.[i]?.y ?? 0) }));
}

export function zeroLatticeOffsets(lattice: PuppetLattice): PuppetVec2[] {
  return Array.from({ length: latticePointCount(lattice) }, () => ({ x: 0, y: 0 }));
}
