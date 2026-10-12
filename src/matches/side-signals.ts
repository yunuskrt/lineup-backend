import { z } from 'zod';
import { NEUTRAL_SIGNALS, type SideSignals } from '@/matches/side-rules.js';

const unitSchema = z.number().min(0).max(1);
const strengthSchema = z.object({
  guessability: unitSchema,
  starPower: unitSchema,
});

// Written into signals by B19 and B21
export const sideSignalsBlockSchema = z.object({
  sides: z.object({ home: strengthSchema, away: strengthSchema }),
});

export function readSideSignals(signals: unknown): SideSignals {
  const parsed = sideSignalsBlockSchema.safeParse(signals);
  return parsed.success ? parsed.data.sides : NEUTRAL_SIGNALS;
}
