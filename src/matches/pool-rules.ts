import type { CompetitionKind } from '@/contract/common.js';
import { FIRST_SEASON_START, LAST_SEASON_START } from '@/contract/constants.js';
import type { EmptyPoolReason } from '@/contract/envelope.js';
import type { EraRange, Filters } from '@/contract/match.js';

// By season start year
export const ERA_BUCKETS = [
  { from: 2000, to: 2007 },
  { from: 2008, to: 2015 },
  { from: 2016, to: 2026 },
] as const;

export const TOURNAMENT_KINDS: readonly CompetitionKind[] = [
  'world_cup',
  'euro',
  'ucl',
];

// Provisional: retuned by B19 and B22
export const POOL_THRESHOLD = { league: 60, tournament: 45 } as const;

export type PoolCandidate = {
  matchId: string;
  competitionId: string;
  seasonStart: number;
  clubIds: readonly [string, string];
};

export type MatchSelection =
  { matchId: string } | { emptyBecause: EmptyPoolReason };

export type Random = () => number;

export type PoolCoverage = {
  competitionIds: string[];
  clubIds: string[];
  era: EraRange;
};

type FilterKey = Exclude<EmptyPoolReason, 'combination'>;

const FILTER_ORDER: readonly FilterKey[] = ['competition', 'club', 'era'];

const PASSES: Record<
  FilterKey,
  (candidate: PoolCandidate, filters: Filters) => boolean
> = {
  competition: (candidate, filters) =>
    filters.competitionIds.length === 0 ||
    filters.competitionIds.includes(candidate.competitionId),
  club: (candidate, filters) =>
    filters.clubIds.length === 0 ||
    candidate.clubIds.some((id) => filters.clubIds.includes(id)),
  era: (candidate, filters) =>
    candidate.seasonStart >= filters.era.from &&
    candidate.seasonStart <= filters.era.to,
};

export function matchesFilters(
  candidate: PoolCandidate,
  filters: Filters,
  ignored: FilterKey | null = null,
): boolean {
  return FILTER_ORDER.every(
    (key) => key === ignored || PASSES[key](candidate, filters),
  );
}

// Blame the first filter whose removal refills it
function blame(
  candidates: readonly PoolCandidate[],
  filters: Filters,
): EmptyPoolReason {
  const culprit = FILTER_ORDER.find((key) =>
    candidates.some((candidate) => matchesFilters(candidate, filters, key)),
  );
  return culprit ?? 'combination';
}

export function emptyReason(
  candidates: readonly PoolCandidate[],
  filters: Filters,
): EmptyPoolReason | null {
  const hasMatch = candidates.some((candidate) =>
    matchesFilters(candidate, filters),
  );
  return hasMatch ? null : blame(candidates, filters);
}

export function eraBucketOf(seasonStart: number): number {
  return ERA_BUCKETS.findIndex(
    (bucket) => seasonStart >= bucket.from && seasonStart <= bucket.to,
  );
}

function pickIndex(weights: readonly number[], random: Random): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let target = random() * total;
  for (const [index, weight] of weights.entries()) {
    target -= weight;
    if (target < 0) return index;
  }
  return weights.length - 1;
}

// One stratum per key; weight is sqrt(size)
function pickStratum<T>(
  items: readonly T[],
  keysOf: (item: T) => readonly string[],
  random: Random,
): T[] {
  const strata = new Map<string, T[]>();
  for (const item of items) {
    for (const key of new Set(keysOf(item))) {
      const stratum = strata.get(key);
      if (stratum) stratum.push(item);
      else strata.set(key, [item]);
    }
  }
  const groups = [...strata.values()];
  const weights = groups.map((group) => Math.sqrt(group.length));
  return groups[pickIndex(weights, random)];
}

export function sampleStratified(
  candidates: readonly PoolCandidate[],
  random: Random,
): PoolCandidate | null {
  if (candidates.length === 0) return null;

  const competition = pickStratum(candidates, (c) => [c.competitionId], random);
  const era = pickStratum(
    competition,
    (c) => [String(eraBucketOf(c.seasonStart))],
    random,
  );
  const club = pickStratum(era, (c) => c.clubIds, random);
  return club[Math.min(club.length - 1, Math.floor(random() * club.length))];
}

export function selectFrom(
  candidates: readonly PoolCandidate[],
  filters: Filters,
  random: Random,
): MatchSelection {
  const pool = candidates.filter((candidate) =>
    matchesFilters(candidate, filters),
  );
  const picked = sampleStratified(pool, random);
  return picked
    ? { matchId: picked.matchId }
    : { emptyBecause: blame(candidates, filters) };
}

export function poolCoverage(
  candidates: readonly PoolCandidate[],
): PoolCoverage {
  if (candidates.length === 0) {
    return {
      competitionIds: [],
      clubIds: [],
      era: { from: FIRST_SEASON_START, to: LAST_SEASON_START },
    };
  }
  const starts = candidates.map((candidate) => candidate.seasonStart);
  return {
    competitionIds: [...new Set(candidates.map((c) => c.competitionId))],
    clubIds: [...new Set(candidates.flatMap((c) => c.clubIds))],
    era: { from: Math.min(...starts), to: Math.max(...starts) },
  };
}
