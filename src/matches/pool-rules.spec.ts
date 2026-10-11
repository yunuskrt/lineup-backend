import type { Filters } from '@/contract/match.js';
import {
  emptyReason,
  eraBucketOf,
  matchesFilters,
  type PoolCandidate,
  poolCoverage,
  type Random,
  sampleStratified,
  selectFrom,
} from '@/matches/pool-rules.js';

const ALL: Filters = {
  competitionIds: [],
  clubIds: [],
  era: { from: 2000, to: 2025 },
};

function candidate(
  matchId: string,
  overrides: Partial<PoolCandidate> = {},
): PoolCandidate {
  return {
    matchId,
    competitionId: 'comp-a',
    seasonStart: 2010,
    clubIds: ['club-a', 'club-b'],
    ...overrides,
  };
}

// mulberry32: a seeded, repeatable random
function seeded(seed: number): Random {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('matchesFilters', () => {
  it('lets empty filters match everything', () => {
    expect(matchesFilters(candidate('m1'), ALL)).toBe(true);
  });

  it('filters by competition', () => {
    const filters = { ...ALL, competitionIds: ['comp-b'] };
    expect(matchesFilters(candidate('m1'), filters)).toBe(false);
    const other = candidate('m2', { competitionId: 'comp-b' });
    expect(matchesFilters(other, filters)).toBe(true);
  });

  it.each([
    ['home', 'club-a'],
    ['away', 'club-b'],
  ])('lets a club filter match the %s side', (_, clubId) => {
    const filters = { ...ALL, clubIds: [clubId] };
    expect(matchesFilters(candidate('m1'), filters)).toBe(true);
  });

  it('drops a match with neither filtered club', () => {
    const filters = { ...ALL, clubIds: ['club-z'] };
    expect(matchesFilters(candidate('m1'), filters)).toBe(false);
  });

  it.each([
    [2010, true],
    [2012, true],
    [2014, true],
    [2009, false],
    [2015, false],
  ])('treats era bounds as inclusive (%i)', (seasonStart, expected) => {
    const filters = { ...ALL, era: { from: 2010, to: 2014 } };
    const match = candidate('m1', { seasonStart });
    expect(matchesFilters(match, filters)).toBe(expected);
  });
});

describe('emptyReason', () => {
  const pool = [
    candidate('m1'),
    candidate('m2', {
      competitionId: 'comp-b',
      clubIds: ['club-c', 'club-d'],
      seasonStart: 2020,
    }),
  ];

  it('is null when something matches', () => {
    expect(emptyReason(pool, ALL)).toBeNull();
  });

  it('reports an empty pool', () => {
    expect(emptyReason([], ALL)).toBe('combination');
  });

  it.each<[string, Filters]>([
    [
      'competition',
      { ...ALL, competitionIds: ['comp-z'], clubIds: ['club-a'] },
    ],
    ['club', { ...ALL, clubIds: ['club-z'] }],
    ['era', { ...ALL, era: { from: 2000, to: 2005 } }],
  ])('blames %s', (reason, filters) => {
    expect(emptyReason(pool, filters)).toBe(reason);
  });

  it('blames competition before club and era', () => {
    // Removing any one of the three refills it
    const filters = {
      competitionIds: ['comp-b'],
      clubIds: ['club-a'],
      era: { from: 2010, to: 2010 },
    };
    expect(emptyReason([candidate('m1')], filters)).toBe('competition');
  });

  it('blames the combination when no single filter refills it', () => {
    // Each match fails two of the three filters
    const filters = {
      competitionIds: ['comp-a'],
      clubIds: ['club-c'],
      era: { from: 2015, to: 2015 },
    };
    expect(emptyReason(pool, filters)).toBe('combination');
  });
});

describe('eraBucketOf', () => {
  it.each([
    [2000, 0],
    [2007, 0],
    [2008, 1],
    [2015, 1],
    [2016, 2],
    [2025, 2],
  ])('puts %i in bucket %i', (seasonStart, bucket) => {
    expect(eraBucketOf(seasonStart)).toBe(bucket);
  });
});

describe('sampleStratified', () => {
  it('returns null for an empty pool', () => {
    expect(sampleStratified([], Math.random)).toBeNull();
  });

  it('returns the only match', () => {
    const only = candidate('m1');
    expect(sampleStratified([only], () => 0.99)).toBe(only);
  });

  it('stays in range when random hits its upper edge', () => {
    const pool = [
      candidate('m1'),
      candidate('m2', { competitionId: 'comp-b' }),
      candidate('m3', { competitionId: 'comp-b', seasonStart: 2020 }),
    ];
    // Out of contract, as rounding can approach it
    expect(sampleStratified(pool, () => 1)?.matchId).toBe('m3');
  });

  it('is repeatable with the same random', () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      candidate(`m${i}`, { seasonStart: 2000 + i }),
    );
    const run = (random: Random) =>
      Array.from({ length: 10 }, () => sampleStratified(pool, random)?.matchId);
    expect(run(seeded(7))).toEqual(run(seeded(7)));
  });

  it('lifts a small club far above its raw share', () => {
    const big = Array.from({ length: 90 }, (_, i) =>
      candidate(`big-${i}`, { clubIds: ['club-a', 'club-c'] }),
    );
    const small = Array.from({ length: 10 }, (_, i) =>
      candidate(`small-${i}`, { clubIds: ['club-b', 'club-d'] }),
    );
    const random = seeded(42);
    const draws = 4000;
    let smallPicks = 0;
    for (let i = 0; i < draws; i++) {
      if (
        sampleStratified([...big, ...small], random)?.matchId.startsWith(
          'small',
        )
      ) {
        smallPicks++;
      }
    }
    // sqrt weights give 25%; raw share is 10%
    expect(smallPicks / draws).toBeGreaterThan(0.2);
    expect(smallPicks / draws).toBeLessThan(0.3);
  });

  it('balances competitions before matches', () => {
    const crowded = Array.from({ length: 100 }, (_, i) =>
      candidate(`a-${i}`, { competitionId: 'comp-a' }),
    );
    const thin = [candidate('b-0', { competitionId: 'comp-b' })];
    const random = seeded(3);
    let thinPicks = 0;
    for (let i = 0; i < 2000; i++) {
      if (sampleStratified([...crowded, ...thin], random)?.matchId === 'b-0') {
        thinPicks++;
      }
    }
    // sqrt(1) / (sqrt(100) + sqrt(1)) ≈ 9%
    expect(thinPicks / 2000).toBeGreaterThan(0.06);
    expect(thinPicks / 2000).toBeLessThan(0.12);
  });

  it('reaches every match in the pool', () => {
    const pool = [
      candidate('m1'),
      candidate('m2', { seasonStart: 2003 }),
      candidate('m3', { seasonStart: 2020, clubIds: ['club-c', 'club-d'] }),
      candidate('m4', { competitionId: 'comp-b' }),
    ];
    const random = seeded(11);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(sampleStratified(pool, random)?.matchId ?? '');
    }
    expect([...seen].sort()).toEqual(['m1', 'm2', 'm3', 'm4']);
  });
});

describe('selectFrom', () => {
  const pool = [
    candidate('m1'),
    candidate('m2', { competitionId: 'comp-b', clubIds: ['club-c', 'club-d'] }),
  ];

  it('picks only from matches that pass the filters', () => {
    const filters = { ...ALL, competitionIds: ['comp-b'] };
    const random = seeded(5);
    for (let i = 0; i < 50; i++) {
      expect(selectFrom(pool, filters, random)).toEqual({ matchId: 'm2' });
    }
  });

  it('returns the blamed filter when nothing passes', () => {
    const filters = { ...ALL, clubIds: ['club-z'] };
    expect(selectFrom(pool, filters, Math.random)).toEqual({
      emptyBecause: 'club',
    });
  });
});

describe('poolCoverage', () => {
  it('falls back to the full range for an empty pool', () => {
    expect(poolCoverage([])).toEqual({
      competitionIds: [],
      clubIds: [],
      era: { from: 2000, to: 2025 },
    });
  });

  it('lists each competition and club once, both sides included', () => {
    const coverage = poolCoverage([
      candidate('m1'),
      candidate('m2', { clubIds: ['club-b', 'club-c'] }),
      candidate('m3', { competitionId: 'comp-b' }),
    ]);
    expect(coverage.competitionIds).toEqual(['comp-a', 'comp-b']);
    expect(coverage.clubIds).toEqual(['club-a', 'club-b', 'club-c']);
  });

  it('spans the lowest and highest season start', () => {
    const coverage = poolCoverage([
      candidate('m1', { seasonStart: 2012 }),
      candidate('m2', { seasonStart: 2003 }),
      candidate('m3', { seasonStart: 2019 }),
    ]);
    expect(coverage.era).toEqual({ from: 2003, to: 2019 });
  });

  it('gives a one-season era for a one-season pool', () => {
    expect(poolCoverage([candidate('m1')]).era).toEqual({
      from: 2010,
      to: 2010,
    });
  });
});
