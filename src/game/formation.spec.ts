import type { PositionGroup } from '@/contract/common.js';
import { positionForSlot } from '@/game/formation.js';

const slots = (formation: string): (PositionGroup | null)[] =>
  Array.from({ length: 11 }, (_, slot) => positionForSlot(formation, slot));

describe('positionForSlot', () => {
  it('puts the goalkeeper in slot 0', () => {
    expect(positionForSlot('4-4-2', 0)).toBe('GK');
  });

  it('fills a 4-4-2 back to front', () => {
    expect(slots('4-4-2')).toEqual([
      'GK',
      ...Array<PositionGroup>(4).fill('DF'),
      ...Array<PositionGroup>(4).fill('MF'),
      'FW',
      'FW',
    ]);
  });

  it('treats every middle line of a 4-2-3-1 as midfield', () => {
    expect(slots('4-2-3-1')).toEqual([
      'GK',
      ...Array<PositionGroup>(4).fill('DF'),
      ...Array<PositionGroup>(5).fill('MF'),
      'FW',
    ]);
  });

  it('fills a 3-5-2 back to front', () => {
    expect(slots('3-5-2')).toEqual([
      'GK',
      ...Array<PositionGroup>(3).fill('DF'),
      ...Array<PositionGroup>(5).fill('MF'),
      'FW',
      'FW',
    ]);
  });

  it('handles a five-line 4-1-2-1-2', () => {
    expect(slots('4-1-2-1-2')).toEqual([
      'GK',
      ...Array<PositionGroup>(4).fill('DF'),
      ...Array<PositionGroup>(4).fill('MF'),
      'FW',
      'FW',
    ]);
  });

  it('returns null for a slot outside the formation', () => {
    expect(positionForSlot('4-4-2', 11)).toBeNull();
    expect(positionForSlot('4-4-2', 42)).toBeNull();
    expect(positionForSlot('4-4-2', -1)).toBeNull();
    expect(positionForSlot('4-4-2', 1.5)).toBeNull();
  });
});
