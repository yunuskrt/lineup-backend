import type { MatchInPlay } from '@/contract/match.js';
import type { DuelFoundPlayer, RevealedPlayer } from '@/contract/player.js';
import type { DuelPlayer } from '@/contract/duel.js';

export const club = (id: string) => ({
  id,
  name: `Club ${id}`,
  shortName: id.slice(0, 3).toUpperCase(),
  crestUrl: `https://cdn.lineup.gg/crests/${id}.svg`,
});

export const matchInPlay: MatchInPlay = {
  id: 'm-1',
  competition: { id: 'c-ucl', kind: 'ucl', name: 'Champions League' },
  season: '2004-05',
  date: '2005-05-25',
  stage: 'Final',
  home: club('mil'),
  away: club('liv'),
  score: { home: 3, away: 3 },
  nickname: 'Miracle of Istanbul',
  side: 'home',
  formation: '4-4-2',
};

export const revealedPlayer: RevealedPlayer = {
  id: 'p-1',
  name: 'Oğuzhan Şimşek',
  slot: 0,
  position: 'GK',
  imageUrl: null,
};

export const duelFoundPlayer: DuelFoundPlayer = {
  ...revealedPlayer,
  foundBy: 'you',
};

export const duelPlayer = (id: string): DuelPlayer => ({
  id,
  handle: `player-${id}`,
  lives: 3,
});

export const roundTiming = { startedAt: 1_000, endsAt: 16_000 };
