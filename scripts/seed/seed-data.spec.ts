import { SQUAD_SIZE } from '@/contract/constants.js';
import {
  type SeedDataInput,
  seasonIssue,
  seedDataSchema,
} from '@scripts/seed/seed-data.schema.js';
import { SEED_INPUT } from '@scripts/seed/seed.js';

const SIDES = ['home', 'away'] as const;

const data = seedDataSchema.parse(SEED_INPUT);

// A deep copy with one change applied
function edited(change: (input: SeedDataInput) => void): SeedDataInput {
  const copy = structuredClone(SEED_INPUT);
  change(copy);
  return copy;
}

function issuesOf(input: SeedDataInput): string[] {
  const result = seedDataSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe('seed data', () => {
  it('transcribes the whole web mock', () => {
    expect(data.competitions).toHaveLength(6);
    expect(data.clubs).toHaveLength(11);
    expect(data.players).toHaveLength(167);
    expect(data.matches).toHaveLength(10);
  });

  it('has four national teams', () => {
    const nations = data.clubs.filter((club) => club.id.startsWith('nat-'));
    expect(nations).toHaveLength(4);
  });

  it('starts every lineup player and only known ones', () => {
    const known = new Set(data.players.map((player) => player.id));
    const started = new Set(
      data.matches.flatMap((m) =>
        SIDES.flatMap((side) => m[side].lineup.map((e) => e.playerId)),
      ),
    );
    expect([...started].filter((id) => !known.has(id))).toEqual([]);
    expect(started.size).toBe(known.size);
  });

  it('fills 11 slots per side with the keeper in slot 0', () => {
    for (const match of data.matches) {
      for (const side of SIDES) {
        const slots = match[side].lineup
          .map((e) => e.slot)
          .sort((a, b) => a - b);
        expect(slots).toEqual([...Array(SQUAD_SIZE).keys()]);
        const keeper = match[side].lineup.find((e) => e.position === 'GK');
        expect(keeper?.slot).toBe(0);
      }
    }
  });

  it('keeps a shared surname on two players', () => {
    const harlows = data.players.filter((p) => p.aliases.includes('harlow'));
    expect(harlows).toHaveLength(2);
  });

  describe('rejects', () => {
    it.each<[string, (input: SeedDataInput) => void, string]>([
      [
        'an unknown lineup player',
        (i) => {
          i.matches[0].home.lineup[3].playerId = 'pl-nobody';
        },
        'Unknown player',
      ],
      [
        'a player on both sides',
        (i) => {
          i.matches[0].away.lineup[3].playerId =
            i.matches[0].home.lineup[3].playerId;
        },
        'A player starts for both sides',
      ],
      [
        'a duplicate slot',
        (i) => {
          i.matches[0].home.lineup[2].slot = 1;
        },
        'Slots must be unique',
      ],
      [
        'a player twice in one XI',
        (i) => {
          i.matches[0].home.lineup[2].playerId =
            i.matches[0].home.lineup[3].playerId;
        },
        'Players must be unique',
      ],
      [
        'a keeper outside slot 0',
        (i) => {
          i.matches[0].home.lineup[5].position = 'GK';
        },
        'GK belongs in slot 0 only',
      ],
      [
        'the same club on both sides',
        (i) => {
          i.matches[0].awayClubId = i.matches[0].homeClubId;
        },
        'Home and away clubs must differ',
      ],
      [
        'a duplicate player id',
        (i) => {
          i.players.push(i.players[0]);
        },
        'Duplicate id',
      ],
      [
        'an uppercase alias',
        (i) => {
          i.players[0].aliases.push('Pennock');
        },
        'Alias must be lowercase',
      ],
      [
        'a duplicate alias',
        (i) => {
          i.players[0].aliases.push(i.players[0].aliases[0]);
        },
        'Aliases must be unique',
      ],
      [
        'an unknown competition',
        (i) => {
          i.matches[0].competitionId = 'comp-nowhere';
        },
        'Unknown competition',
      ],
    ])('%s', (_, change, message) => {
      expect(issuesOf(edited(change))).toContain(message);
    });

    it.each(['double  space', ' leading', 'trailing ', ''])(
      'the alias %j',
      (alias) => {
        const input = edited((i) => {
          i.players[0].aliases.push(alias);
        });
        expect(seedDataSchema.safeParse(input).success).toBe(false);
      },
    );
  });

  describe('seasonIssue()', () => {
    it.each<[string, string, boolean, string | null]>([
      ['2002-03', '2003-05-03', false, null],
      ['2002-03', '2002-07-01', false, null],
      ['2006', '2006-07-05', true, null],
      ['2002-03', '2003-07-01', false, 'Date is outside the season'],
      ['2002-04', '2003-05-03', false, 'Season years must be consecutive'],
      ['2002', '2002-09-01', false, 'Club seasons span two years'],
      ['2006-07', '2006-07-05', true, 'Tournament seasons are a single year'],
      ['2006', '2007-01-01', true, 'Date is outside the season'],
      ['1999-00', '2000-01-01', false, 'Season is outside the covered range'],
      ['2026', '2026-06-20', true, 'Season is outside the covered range'],
    ])('%s on %s (tournament %s) → %j', (label, date, isTournament, issue) => {
      expect(seasonIssue(label, date, isTournament)).toBe(issue);
    });
  });
});
