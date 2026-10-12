import type { Side } from '@/contract/common.js';
import type { Random } from '@/matches/pool-rules.js';

export type SideStrength = Readonly<{
  guessability: number;
  starPower: number;
}>;
export type SideSignals = Readonly<Record<Side, SideStrength>>;

// Shared by every fallback: frozen against a write
const NEUTRAL: SideStrength = Object.freeze({
  guessability: 0.5,
  starPower: 0.5,
});
export const NEUTRAL_SIGNALS: SideSignals = Object.freeze({
  home: NEUTRAL,
  away: NEUTRAL,
});

// Favoured, never certain: both XIs get played
export const HOME_PROBABILITY = { min: 0.3, max: 0.7 } as const;

function strength(side: SideStrength): number {
  return (side.guessability + side.starPower) / 2;
}

export function homeProbability(signals: SideSignals): number {
  const tilt = 0.5 + (strength(signals.home) - strength(signals.away)) / 2;
  return Math.min(HOME_PROBABILITY.max, Math.max(HOME_PROBABILITY.min, tilt));
}

export function pickSide(signals: SideSignals, random: Random): Side {
  return random() < homeProbability(signals) ? 'home' : 'away';
}
