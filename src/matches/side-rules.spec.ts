import {
  HOME_PROBABILITY,
  homeProbability,
  NEUTRAL_SIGNALS,
  pickSide,
  type SideSignals,
  type SideStrength,
} from '@/matches/side-rules.js';

const even = (value: number): SideStrength => ({
  guessability: value,
  starPower: value,
});
const signals = (home: SideStrength, away: SideStrength): SideSignals => ({
  home,
  away,
});

describe('homeProbability', () => {
  it('is an even split for neutral signals', () => {
    expect(homeProbability(NEUTRAL_SIGNALS)).toBe(0.5);
  });

  it('tilts toward the stronger side by half the gap', () => {
    expect(homeProbability(signals(even(0.7), even(0.5)))).toBeCloseTo(0.6);
    expect(homeProbability(signals(even(0.5), even(0.7)))).toBeCloseTo(0.4);
  });

  it('averages guessability and star power', () => {
    const home = { guessability: 0.9, starPower: 0.5 };
    expect(homeProbability(signals(home, even(0.5)))).toBeCloseTo(0.6);
  });

  it.each([
    [even(1), even(0), HOME_PROBABILITY.max],
    [even(0), even(1), HOME_PROBABILITY.min],
    [even(0.9), even(0.4), HOME_PROBABILITY.max],
  ])('clamps a lopsided match to [0.3, 0.7]', (home, away, bound) => {
    expect(homeProbability(signals(home, away))).toBe(bound);
  });

  it('is symmetric when the sides swap', () => {
    const home = { guessability: 0.8, starPower: 0.3 };
    const away = { guessability: 0.4, starPower: 0.6 };
    expect(homeProbability(signals(home, away))).toBeCloseTo(
      1 - homeProbability(signals(away, home)),
    );
  });

  it('freezes the shared neutral signals', () => {
    expect(Object.isFrozen(NEUTRAL_SIGNALS)).toBe(true);
    expect(Object.isFrozen(NEUTRAL_SIGNALS.home)).toBe(true);
    expect(Object.isFrozen(NEUTRAL_SIGNALS.away)).toBe(true);
  });

  it('keeps the bounds at 0.3 and 0.7', () => {
    expect(HOME_PROBABILITY).toEqual({ min: 0.3, max: 0.7 });
  });
});

describe('pickSide', () => {
  it.each([
    [0, 'home'],
    [0.49, 'home'],
    [0.5, 'away'],
    [0.99, 'away'],
  ])('splits neutral signals at 0.5 (random %d)', (value, side) => {
    expect(pickSide(NEUTRAL_SIGNALS, () => value)).toBe(side);
  });

  it('serves the weaker side below the bound', () => {
    const tilted = signals(even(1), even(0));
    expect(pickSide(tilted, () => 0.69)).toBe('home');
    expect(pickSide(tilted, () => 0.7)).toBe('away');
  });

  it('hits both sides over a seeded run', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16_807) % 2_147_483_647;
      return seed / 2_147_483_647;
    };
    const tilted = signals(even(0.9), even(0.1));
    const picks = Array.from({ length: 1_000 }, () => pickSide(tilted, random));
    const homeShare = picks.filter((side) => side === 'home').length / 1_000;
    expect(homeShare).toBeGreaterThan(0.65);
    expect(homeShare).toBeLessThan(0.75);
  });
});
