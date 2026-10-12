import { classifyGuess, squadCollisions } from '@/game/collisions.js';
import {
  FUZZY_THRESHOLD,
  resolveGuess,
  type SquadEntry,
} from '@/game/matcher.js';
import { normalizeName } from '@/game/normalize.js';
import { MATCHES } from '@scripts/seed/data/matches.js';
import { PLAYERS } from '@scripts/seed/data/players.js';

// The B28 tuning check over every seeded XI
const PLAYER_BY_ID = new Map(PLAYERS.map((player) => [player.id, player]));

type Xi = { label: string; squad: SquadEntry[] };

// As stored: normalized = normalizeName(alias)
const XIS: Xi[] = MATCHES.flatMap((match) =>
  (['home', 'away'] as const).map((side) => ({
    label: `${match.id} ${side}`,
    squad: match[side].lineup.map((entry) => ({
      playerId: entry.playerId,
      aliases: (PLAYER_BY_ID.get(entry.playerId)?.aliases ?? []).map(
        normalizeName,
      ),
    })),
  })),
);

describe('matcher over the seeded XIs', () => {
  it('runs at the recorded threshold', () => {
    expect(FUZZY_THRESHOLD).toBe(0.82);
    expect(XIS).toHaveLength(20);
  });

  it.each(XIS)('recalls every alias in $label', ({ squad }) => {
    const wrong: string[] = [];
    for (const entry of squad) {
      for (const alias of entry.aliases) {
        const sharers = squad.filter((other) => other.aliases.includes(alias));
        const result = resolveGuess(alias, squad);
        const isRight =
          sharers.length > 1
            ? result.kind === 'ambiguous' &&
              result.playerIds.includes(entry.playerId)
            : result.kind === 'hit' && result.playerId === entry.playerId;
        if (!isRight) wrong.push(entry.playerId);
      }
    }
    // Ids only: never a name in the output
    expect(wrong).toEqual([]);
  });

  it.each(XIS)('never hits an outsider in $label', ({ squad }) => {
    const inXi = new Set(squad.map((entry) => entry.playerId));
    const falseHits = PLAYERS.filter((player) => !inXi.has(player.id))
      .filter((player) => resolveGuess(player.name, squad).kind !== 'miss')
      .map((player) => player.id);
    expect(falseHits).toEqual([]);
  });
});

describe('collisions over the seeded XIs', () => {
  it('holds only the two deliberate Harlow collisions', () => {
    const collisions = XIS.flatMap(({ label, squad }) =>
      squadCollisions(squad).map(({ playerIds }) => ({ label, playerIds })),
    );
    const harlows = ['pl-dean-harlow', 'pl-rhys-harlow'];
    expect(collisions).toEqual([
      { label: 'match-crown-2003 home', playerIds: harlows },
      { label: 'match-continental-2005-final away', playerIds: harlows },
    ]);
  });

  it.each(XIS)('clears $label by full names', ({ squad }) => {
    const found: string[] = [];
    for (const entry of squad) {
      const name = PLAYER_BY_ID.get(entry.playerId)?.name ?? '';
      const verdict = classifyGuess(name, squad, found);
      if (verdict.kind === 'correct_new') found.push(verdict.playerId);
    }
    // Ids only: never a name in the output
    expect(found).toEqual(squad.map((entry) => entry.playerId));
    expect(found).toHaveLength(11);
  });
});
