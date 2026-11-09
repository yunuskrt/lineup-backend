import type { ShowcaseRow } from '@/catalog/showcase-view.js';
import type { Side } from '@/contract/common.js';
import { positionForSlot } from '@/game/formation.js';

type Team = ShowcaseRow['teams'][number];

// As the real 4-3-3: forwards 8–10, midfield 5–7
export const HOME_SLUGS: Record<number, string> = {
  5: 'toni-kroos',
  6: 'luka-modric',
  8: 'gareth-bale',
  9: 'karim-benzema',
  10: 'cristiano-ronaldo',
};
export const AWAY_SLUGS: Record<number, string> = { 10: 'lionel-messi' };

export function showcaseTeam(
  side: Side,
  slugs: Record<number, string>,
  starters = 11,
): Team {
  const formation = '4-3-3';
  return {
    side,
    goals: side === 'home' ? 2 : 3,
    club: { id: `club-${side}`, name: side, shortName: 'CLB', crestKey: null },
    formation,
    lineups: Array.from({ length: starters }, (_, slot) => ({
      slot,
      position: positionForSlot(formation, slot) ?? 'GK',
      player: {
        id: `${side}-${slot}`,
        slug: slugs[slot] ?? `${side}-player-${slot}`,
        name: `${side} starter ${slot}`,
        imageKey: slot === 0 ? `players/${side}-0/a.webp` : null,
        _count: { aliases: 2 },
      },
    })),
  };
}

export function showcaseRow(
  teams: Team[] = [
    showcaseTeam('home', HOME_SLUGS),
    showcaseTeam('away', AWAY_SLUGS),
  ],
): ShowcaseRow {
  return {
    id: 'match-1',
    date: new Date('2017-04-23T00:00:00Z'),
    stage: 'Matchday 33',
    nickname: null,
    season: {
      label: '2016-17',
      competition: {
        id: 'comp-1',
        kind: 'league',
        name: 'La Liga',
        logoKey: null,
      },
    },
    teams,
  };
}
