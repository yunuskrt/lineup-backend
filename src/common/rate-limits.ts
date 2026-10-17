import { SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  normalizeIp,
  Throttle,
  type ThrottlerModuleOptions,
} from '@nestjs/throttler';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

export type Limit = { limit: number; ttl: number };

// Provisional: tuned once real traffic exists
export const RATE_LIMITS = {
  default: { limit: 120, ttl: MINUTE },
  guess: { limit: 12, ttl: 3 * SECOND },
  start: { limit: 20, ttl: MINUTE },
  signIn: { limit: 10, ttl: 15 * MINUTE },
  signUp: { limit: 5, ttl: 60 * MINUTE },
  guest: { limit: 10, ttl: 60 * MINUTE },
  upgrade: { limit: 5, ttl: 60 * MINUTE },
  token: { limit: 30, ttl: MINUTE },
  catalog: { limit: 60, ttl: MINUTE },
} as const satisfies Record<string, Limit>;

// Per email, beside sign-in's per-IP limit
export const ACCOUNT_LIMIT: Limit = { limit: 5, ttl: 15 * MINUTE };

export type RateLimitName = Exclude<keyof typeof RATE_LIMITS, 'default'>;

// Each route keeps its own count under this limit
export const RateLimit = (name: RateLimitName) =>
  Throttle({ default: RATE_LIMITS[name] });

const PER_ACCOUNT = 'rate-limit:per-account';

export const LimitPerAccount = () => SetMetadata(PER_ACCOUNT, true);

const reflector = new Reflector();

// The email as typed, normalised; else the IP
export function accountTracker(req: Record<string, unknown>): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email : '';
  const normalised = email.trim().toLowerCase();
  return normalised
    ? `email:${normalised}`
    : `ip:${normalizeIp(String(req.ip))}`;
}

export const THROTTLER_OPTIONS: ThrottlerModuleOptions = {
  // The guard sets Retry-After itself, only
  setHeaders: false,
  throttlers: [
    { name: 'default', ...RATE_LIMITS.default },
    {
      name: 'account',
      ...ACCOUNT_LIMIT,
      getTracker: accountTracker,
      skipIf: (context) =>
        reflector.get<boolean>(PER_ACCOUNT, context.getHandler()) !== true,
    },
  ],
};
