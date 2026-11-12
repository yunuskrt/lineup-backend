import { type Tier, tierSchema } from '@/contract/common.js';

// HC 16: the switch off makes everyone Pro
export function effectiveTier(stored: Tier, proEnabled: boolean): Tier {
  return proEnabled ? stored : 'pro';
}

// Missing or unknown reads free: fails closed
export function storedTier(value: unknown): Tier {
  const parsed = tierSchema.safeParse(value);
  return parsed.success ? parsed.data : 'free';
}
