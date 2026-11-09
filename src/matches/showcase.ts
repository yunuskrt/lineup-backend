import type { Side } from '@/contract/common.js';

export const SHOWCASE = Symbol('SHOWCASE');

// Slugs only; checked against the data on every read
export type ShowcaseSpec = {
  readonly matchSlug: string;
  readonly side: Side;
  // Player slugs, in the demo's reveal order
  readonly reveals: readonly string[];
  // A starter of the other side: the wrong guess
  readonly miss: string;
};

// Never served as a game (HC 2): poolWhere skips it
export const LANDING_SHOWCASE: ShowcaseSpec = {
  matchSlug: '2017-04-23-real-madrid-barcelona',
  side: 'home',
  reveals: [
    'gareth-bale',
    'cristiano-ronaldo',
    'karim-benzema',
    'luka-modric',
    'toni-kroos',
  ],
  miss: 'lionel-messi',
};
