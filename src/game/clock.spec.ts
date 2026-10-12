import { deadline, hasExpired, startRound } from '@/game/clock.js';

const T0 = 1_000_000;

describe('clock', () => {
  it('starts a 15 s round at now', () => {
    expect(startRound(T0)).toEqual({ startedAt: T0, endsAt: T0 + 15_000 });
  });

  it('puts the deadline 400 ms after the end', () => {
    expect(deadline(startRound(T0))).toBe(T0 + 15_400);
  });

  it.each([
    [T0 + 15_000, false],
    [T0 + 15_400, false],
    [T0 + 15_401, true],
  ])('at %i, expired is %s', (now, expired) => {
    expect(hasExpired(startRound(T0), now)).toBe(expired);
  });
});
