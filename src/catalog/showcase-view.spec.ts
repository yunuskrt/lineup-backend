import {
  AWAY_SLUGS,
  HOME_SLUGS,
  showcaseRow as row,
  showcaseTeam as team,
} from '@/catalog/showcase.fixtures.js';
import { type ShowcaseView, toShowcase } from '@/catalog/showcase-view.js';
import { LANDING_SHOWCASE } from '@/matches/showcase.js';

const BASE = 'https://bucket.example.com/images';
const keyOf = (id: string) => id.padEnd(22, 'k');

const reasonOf = (view: ShowcaseView) =>
  'reason' in view ? view.reason : null;

describe('toShowcase', () => {
  it('builds the real constant: 11 players, eight reveals, the miss', () => {
    const view = toShowcase(LANDING_SHOWCASE, row(), undefined, keyOf);
    if (!('showcase' in view)) throw new Error(view.reason);
    const { match, players, demo } = view.showcase;

    expect(match).toMatchObject({
      id: 'match-1',
      side: 'home',
      formation: '4-3-3',
      score: { home: 2, away: 3 },
    });
    expect(players.map((p) => p.slot)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(players[8]).toEqual({
      id: 'home-8',
      name: 'home starter 8',
      slot: 8,
      position: 'FW',
      imageUrl: null,
      directoryKey: keyOf('home-8'),
    });
    expect(demo.reveals).toEqual([8, 10, 9, 7, 5, 2, 0, 4]);
    expect(demo.miss).toEqual({
      name: 'away starter 10',
      imageUrl: null,
      directoryKey: keyOf('away-10'),
    });
  });

  it('sends image URLs under the asset base', () => {
    const view = toShowcase(LANDING_SHOWCASE, row(), BASE, keyOf);
    if (!('showcase' in view)) throw new Error(view.reason);
    expect(view.showcase.players[0].imageUrl).toBe(
      `${BASE}/players/home-0/a.webp`,
    );
  });

  it('names no player of the other XI but the miss', () => {
    const view = toShowcase(LANDING_SHOWCASE, row(), undefined, keyOf);
    const text = JSON.stringify(view);
    expect(text).not.toContain('away-player');
    expect(text.match(/away starter/g)).toHaveLength(1);
  });

  it.each([
    [
      'a missing match',
      null,
      'match 2017-04-23-real-madrid-barcelona is not loaded',
    ],
    [
      '10 starters',
      row([team('home', HOME_SLUGS, 10), team('away', AWAY_SLUGS)]),
      'home XI has 10 starters',
    ],
    [
      'a reveal from the other side',
      row([
        team('home', { ...HOME_SLUGS, 8: 'someone-else' }),
        team('away', { ...AWAY_SLUGS, 8: 'gareth-bale' }),
      ]),
      'reveal gareth-bale is not in the home XI',
    ],
    [
      'a miss from the named side',
      row([
        team('home', { ...HOME_SLUGS, 1: 'lionel-messi' }),
        team('away', {}),
      ]),
      'miss lionel-messi is not in the away XI',
    ],
    [
      'no opponent',
      row([team('home', HOME_SLUGS)]),
      'home side has no formation or no opponent',
    ],
  ])('gives a reason for %s', (_, input, reason) => {
    expect(
      reasonOf(toShowcase(LANDING_SHOWCASE, input, undefined, keyOf)),
    ).toBe(reason);
  });

  it('gives a reason for a slot that breaks the formation', () => {
    const home = team('home', HOME_SLUGS);
    home.lineups[1] = { ...home.lineups[1], position: 'FW' };
    const view = toShowcase(
      LANDING_SHOWCASE,
      row([home, team('away', AWAY_SLUGS)]),
      undefined,
      keyOf,
    );
    expect(reasonOf(view)).toBe('home slot 1 breaks 4-3-3');
  });

  it('gives a reason for a starter with no alias', () => {
    const home = team('home', HOME_SLUGS);
    home.lineups[3].player._count.aliases = 0;
    const view = toShowcase(
      LANDING_SHOWCASE,
      row([home, team('away', AWAY_SLUGS)]),
      undefined,
      keyOf,
    );
    expect(reasonOf(view)).toBe('home slot 3 has no alias');
  });

  it('gives a reason for a named side with no formation', () => {
    const home = { ...team('home', HOME_SLUGS), formation: null };
    const view = toShowcase(
      LANDING_SHOWCASE,
      row([home, team('away', AWAY_SLUGS)]),
      undefined,
      keyOf,
    );
    expect(reasonOf(view)).toBe('home side has no formation or no opponent');
  });

  it('gives a reason when an R8 reveal leaves the XI', () => {
    const home = team('home', { ...HOME_SLUGS, 4: 'someone-else' });
    const view = toShowcase(
      LANDING_SHOWCASE,
      row([home, team('away', AWAY_SLUGS)]),
      undefined,
      keyOf,
    );
    expect(reasonOf(view)).toBe('reveal marcelo is not in the home XI');
  });

  it('gives a reason for a repeated reveal', () => {
    const spec = {
      ...LANDING_SHOWCASE,
      reveals: ['gareth-bale', 'gareth-bale'],
    };
    expect(reasonOf(toShowcase(spec, row(), undefined, keyOf))).toBe(
      'reveal gareth-bale repeats',
    );
  });

  it('gives a reason instead of an off-contract showcase', () => {
    const view = toShowcase(LANDING_SHOWCASE, row(), undefined, () => 'short');
    expect(reasonOf(view)).toBe('it fails the Showcase schema');
  });

  it('shows the away XI for an away spec', () => {
    const spec = {
      matchSlug: 'm',
      side: 'away' as const,
      reveals: ['lionel-messi'],
      miss: 'gareth-bale',
    };
    const view = toShowcase(spec, row(), undefined, keyOf);
    if (!('showcase' in view)) throw new Error(view.reason);
    expect(view.showcase.match.side).toBe('away');
    expect(view.showcase.players[0].id).toBe('away-0');
    expect(view.showcase.demo.reveals).toEqual([10]);
  });
});
