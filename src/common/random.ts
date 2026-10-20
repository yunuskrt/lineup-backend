import type { Provider } from '@nestjs/common';

export type Random = () => number;

// Every draw goes through this; tests fix it
export const RANDOM = Symbol('RANDOM');

export const SYSTEM_RANDOM: Provider = {
  provide: RANDOM,
  useValue: Math.random satisfies Random,
};
