import type { Tier } from '@/contract/common.js';
import { SOLO_DAILY_RUNS } from '@/contract/constants.js';
import type { SoloAllowance } from '@/contract/solo.js';

const DAY_MS = 24 * 60 * 60 * 1_000;

// UTC for everyone: no client time zone
export function utcDayStart(now: number): number {
  return now - (((now % DAY_MS) + DAY_MS) % DAY_MS);
}

export function nextUtcMidnight(now: number): number {
  return utcDayStart(now) + DAY_MS;
}

export function soloAllowance(
  tier: Tier,
  used: number,
  now: number,
): SoloAllowance {
  return {
    limit: tier === 'free' ? SOLO_DAILY_RUNS : null,
    used,
    resetsAt: nextUtcMidnight(now),
  };
}

export function isCapped({ limit, used }: SoloAllowance): boolean {
  return limit !== null && used >= limit;
}
