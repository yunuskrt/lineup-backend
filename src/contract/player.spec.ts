import { revealedPlayer } from '@/contract/contract.fixtures.js';
import {
  duelFoundPlayerSchema,
  duelNamedPlayerSchema,
  namedPlayerSchema,
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

  it('requires a 22-character directory key', () => {
    const { directoryKey: _, ...keyless } = revealedPlayer;
    expect(revealedPlayerSchema.safeParse(keyless).success).toBe(false);
    for (const directoryKey of [
      'short',
      'A'.repeat(23),
      'A'.repeat(21) + '/',
    ]) {
      expect(
        revealedPlayerSchema.safeParse({ ...revealedPlayer, directoryKey })
          .success,
      ).toBe(false);
    }
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

describe('elapsedMs (R14)', () => {
  const at = (elapsedMs: number) => ({
    ...revealedPlayer,
    foundBy: 'you',
    order: 1,
    elapsedMs,
  });

  it('is uncapped on a solo name, for practice', () => {
    expect(namedPlayerSchema.safeParse(at(600_000)).success).toBe(true);
    expect(namedPlayerSchema.safeParse(at(-1)).success).toBe(false);
  });

  it('stays capped at the round on a duel name', () => {
    expect(duelNamedPlayerSchema.safeParse(at(15_000)).success).toBe(true);
    expect(duelNamedPlayerSchema.safeParse(at(15_001)).success).toBe(false);
  });
});
