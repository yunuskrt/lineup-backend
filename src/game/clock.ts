import { GRACE_MS, ROUND_MS } from '@/contract/constants.js';
import type { RoundTiming } from '@/contract/round.js';

export function startRound(now: number): RoundTiming {
  return { startedAt: now, endsAt: now + ROUND_MS };
}

// Grace is measured on server receipt
export function deadline(round: RoundTiming): number {
  return round.endsAt + GRACE_MS;
}

export function hasExpired(round: RoundTiming, now: number): boolean {
  return now > deadline(round);
}
