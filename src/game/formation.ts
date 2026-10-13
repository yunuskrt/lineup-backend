import type { PositionGroup } from '@/contract/common.js';

// Slot 0 is the GK; lines fill defence to attack
export function positionForSlot(
  formation: string,
  slot: number,
): PositionGroup | null {
  if (slot === 0) return 'GK';
  if (!Number.isInteger(slot) || slot < 0) return null;

  const lines = formation.split('-').map(Number);
  let lineStart = 1;

  for (const [index, size] of lines.entries()) {
    if (slot < lineStart + size) {
      if (index === 0) return 'DF';
      return index === lines.length - 1 ? 'FW' : 'MF';
    }
    lineStart += size;
  }
  return null;
}
