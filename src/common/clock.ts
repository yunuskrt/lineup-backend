import type { Provider } from '@nestjs/common';

export type Clock = { now(): number };

// The rules' only time source; tests swap it
export const CLOCK = Symbol('CLOCK');

export const SYSTEM_CLOCK: Provider = {
  provide: CLOCK,
  useValue: { now: () => Date.now() } satisfies Clock,
};
