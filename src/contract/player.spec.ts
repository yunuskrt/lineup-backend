import { revealedPlayer } from '@/contract/contract.fixtures.js';
import {
  duelFoundPlayerSchema,
  revealedPlayerSchema,
} from '@/contract/player.js';

describe('revealedPlayerSchema', () => {
  it.each([0, 10])('accepts slot %i', (slot) => {
    expect(
      revealedPlayerSchema.safeParse({ ...revealedPlayer, slot }).success,
    ).toBe(true);
  });

  it.each([-1, 11, 2.5])('rejects slot %s', (slot) => {
    expect(
      revealedPlayerSchema.safeParse({ ...revealedPlayer, slot }).success,
    ).toBe(false);
  });

  it('requires foundBy on a duel player', () => {
    expect(duelFoundPlayerSchema.safeParse(revealedPlayer).success).toBe(false);
    expect(
      duelFoundPlayerSchema.safeParse({
        ...revealedPlayer,
        foundBy: 'opponent',
      }).success,
    ).toBe(true);
  });
});
