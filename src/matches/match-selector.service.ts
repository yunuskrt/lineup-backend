import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import { SQUAD_SIZE } from '@/contract/constants.js';
import type { EmptyPoolReason } from '@/contract/envelope.js';
import type { Filters } from '@/contract/match.js';
import type { Prisma } from '@/generated/prisma/client.js';
import {
  emptyReason,
  type MatchSelection,
  POOL_THRESHOLD,
  type PoolCandidate,
  type Random,
  selectFrom,
  TOURNAMENT_KINDS,
} from '@/matches/pool-rules.js';
import { SHOWCASE, type ShowcaseSpec } from '@/matches/showcase.js';
import { PrismaService } from '@/prisma/prisma.service.js';

// Any uuid: the id column refuses anything else
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lineups are counted, never selected (HC 2)
const CANDIDATE_SELECT = {
  id: true,
  season: { select: { competitionId: true, startYear: true } },
  teams: {
    select: {
      clubId: true,
      formation: true,
      _count: { select: { lineups: true } },
    },
    // Home first, so strata build in a fixed order
    orderBy: { side: 'asc' },
  },
} satisfies Prisma.MatchSelect;

type CandidateRow = Prisma.MatchGetPayload<{
  select: typeof CANDIDATE_SELECT;
}>;

// The score is a where clause only (HC 20)
export function poolWhere(
  includeUnscored: boolean,
  excludedSlugs: readonly string[],
): Prisma.MatchWhereInput {
  const kinds = [...TOURNAMENT_KINDS];
  const scored: Prisma.MatchWhereInput[] = [
    {
      season: { competition: { kind: { in: kinds } } },
      memorability: { is: { score: { gte: POOL_THRESHOLD.tournament } } },
    },
    {
      season: { competition: { kind: { notIn: kinds } } },
      memorability: { is: { score: { gte: POOL_THRESHOLD.league } } },
    },
  ];
  const unscored = includeUnscored ? [{ memorability: { is: null } }] : [];
  return {
    AND: [
      { OR: [...scored, ...unscored] },
      { slug: { notIn: [...excludedSlugs] } },
    ],
  };
}

// Stands in for B21's gate: both XIs whole
function toCandidate(row: CandidateRow): PoolCandidate | null {
  const isComplete =
    row.teams.length === 2 &&
    row.teams.every(
      (team) => team.formation !== null && team._count.lineups === SQUAD_SIZE,
    );
  if (!isComplete) return null;

  return {
    matchId: row.id,
    competitionId: row.season.competitionId,
    seasonStart: row.season.startYear,
    clubIds: [row.teams[0].clubId, row.teams[1].clubId],
  };
}

@Injectable()
export class MatchSelectorService {
  private readonly includeUnscored: boolean;
  // Its XI is public on the landing page
  private readonly excludedSlugs: readonly string[];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) env: Env,
    @Inject(SHOWCASE) showcase: ShowcaseSpec,
  ) {
    this.includeUnscored = env.MATCH_POOL_INCLUDE_UNSCORED;
    this.excludedSlugs = [showcase.matchSlug];
  }

  async candidates(): Promise<PoolCandidate[]> {
    const rows = await this.prisma.match.findMany({
      where: poolWhere(this.includeUnscored, this.excludedSlugs),
      select: CANDIDATE_SELECT,
      orderBy: { id: 'asc' },
    });
    return rows.flatMap((row) => toCandidate(row) ?? []);
  }

  // R13: one match, under the pool's own rules
  async isPlayable(matchId: string): Promise<boolean> {
    if (!UUID.test(matchId)) return false;
    const row = await this.prisma.match.findFirst({
      where: {
        AND: [
          { id: matchId },
          poolWhere(this.includeUnscored, this.excludedSlugs),
        ],
      },
      select: CANDIDATE_SELECT,
    });
    return row !== null && toCandidate(row) !== null;
  }

  async select(
    filters: Filters,
    random: Random = Math.random,
  ): Promise<MatchSelection> {
    return selectFrom(await this.candidates(), filters, random);
  }

  async check(filters: Filters): Promise<EmptyPoolReason | null> {
    return emptyReason(await this.candidates(), filters);
  }
}
