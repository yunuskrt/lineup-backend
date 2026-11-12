import { SOLO_DAILY_RUNS } from '@/contract/constants.js';
import {
  isCapped,
  nextUtcMidnight,
  soloAllowance,
  utcDayStart,
} from '@/solo/daily-cap.js';

const MIDNIGHT = Date.UTC(2026, 10, 12);
const DAY_MS = 86_400_000;

describe('utcDayStart and nextUtcMidnight', () => {
  it.each([
    ['at midnight', MIDNIGHT, MIDNIGHT],
    ['a millisecond after', MIDNIGHT + 1, MIDNIGHT],
    ['a millisecond before the next', MIDNIGHT + DAY_MS - 1, MIDNIGHT],
  ])('%s', (_, now, start) => {
    expect(utcDayStart(now)).toBe(start);
    expect(nextUtcMidnight(now)).toBe(start + DAY_MS);
  });

  it('reads the day in UTC, whatever the local zone', () => {
    const lateInIstanbul = Date.UTC(2026, 10, 12, 22, 30);
    expect(utcDayStart(lateInIstanbul)).toBe(MIDNIGHT);
  });
});

describe('soloAllowance', () => {
  it('caps Free at the daily runs', () => {
    expect(soloAllowance('free', 2, MIDNIGHT + 5)).toEqual({
      limit: SOLO_DAILY_RUNS,
      used: 2,
      resetsAt: MIDNIGHT + DAY_MS,
    });
  });

  it('leaves Pro unlimited, still counting', () => {
    expect(soloAllowance('pro', 7, MIDNIGHT)).toEqual({
      limit: null,
      used: 7,
      resetsAt: MIDNIGHT + DAY_MS,
    });
  });

  it('is capped only at the limit, for Free', () => {
    expect(isCapped(soloAllowance('free', 4, MIDNIGHT))).toBe(false);
    expect(isCapped(soloAllowance('free', 5, MIDNIGHT))).toBe(true);
    expect(isCapped(soloAllowance('pro', 50, MIDNIGHT))).toBe(false);
  });
});
