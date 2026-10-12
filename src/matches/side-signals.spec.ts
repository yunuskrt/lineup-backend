import { NEUTRAL_SIGNALS } from '@/matches/side-rules.js';
import { readSideSignals } from '@/matches/side-signals.js';

const SIDES = {
  home: { guessability: 0.8, starPower: 0.6 },
  away: { guessability: 0.5, starPower: 0.9 },
};

describe('readSideSignals', () => {
  it('reads a valid sides block', () => {
    expect(readSideSignals({ sides: SIDES })).toEqual(SIDES);
  });

  it('ignores the rest of the breakdown and extra keys', () => {
    const signals = {
      drama: 0.7,
      sides: {
        home: { ...SIDES.home, caps: 400 },
        away: SIDES.away,
        note: 'x',
      },
    };
    expect(readSideSignals(signals)).toEqual(SIDES);
  });

  it.each([
    ['an empty breakdown', {}],
    ['no sides block', { drama: 0.7 }],
    ['a missing side', { sides: { home: SIDES.home } }],
    ['a missing signal', { sides: { ...SIDES, away: { starPower: 0.9 } } }],
    [
      'a value above 1',
      { sides: { ...SIDES, home: { ...SIDES.home, starPower: 1.2 } } },
    ],
    [
      'a negative value',
      { sides: { ...SIDES, away: { ...SIDES.away, guessability: -0.1 } } },
    ],
    [
      'a string value',
      { sides: { ...SIDES, home: { ...SIDES.home, starPower: '0.6' } } },
    ],
    ['null', null],
    ['undefined', undefined],
    ['an array', [SIDES]],
    ['a number', 42],
  ])('falls back to neutral on %s', (_, signals) => {
    expect(readSideSignals(signals)).toBe(NEUTRAL_SIGNALS);
  });
});
