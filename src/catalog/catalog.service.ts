import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  byName,
  OVERVIEW_SELECT,
  overviewFigures,
  poolCompetitions,
  topClubs,
} from '@/catalog/overview.js';
import { SHOWCASE_SELECT, toShowcase } from '@/catalog/showcase-view.js';
import { CLOCK, type Clock } from '@/common/clock.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import type {
  CatalogOverview,
  CompetitionOption,
  FilterOptions,
  Showcase,
} from '@/contract/catalog.js';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import { toClubRef, toCompetitionRef } from '@/matches/match-refs.js';
import { PlayerKeysService } from '@/matches/player-keys.service.js';
import { competitionCoverage, poolCoverage } from '@/matches/pool-rules.js';
import { SHOWCASE, type ShowcaseSpec } from '@/matches/showcase.js';
import { PrismaService } from '@/prisma/prisma.service.js';

const EMPTY_FIGURES = overviewFigures([]);

// A scraper load shows within this (D3)
export const OVERVIEW_TTL_MS = 5 * 60_000;

type BuiltOverview = { overview: CatalogOverview; builtAt: number };

@Injectable()
export class CatalogService {
  private readonly logger = new Logger('Catalog');
  // Logged once per reason, not per read (D4)
  private showcaseFault: string | null = null;
  private built: BuiltOverview | null = null;
  private building: Promise<CatalogOverview> | null = null;

  constructor(
    private readonly selector: MatchSelectorService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    private readonly keys: PlayerKeysService,
    @Inject(SHOWCASE) private readonly showcaseSpec: ShowcaseSpec,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // Only what the pool can serve; never every row
  async filterOptions(): Promise<FilterOptions> {
    const candidates = await this.selector.candidates();
    const coverage = poolCoverage(candidates);
    if (coverage.competitionIds.length === 0) {
      return { competitions: [], clubs: [], era: coverage.era };
    }

    const [competitions, clubs] = await Promise.all([
      this.prisma.competition.findMany({
        where: { id: { in: coverage.competitionIds } },
        select: { id: true, kind: true, name: true, logoKey: true },
      }),
      this.prisma.club.findMany({
        where: { id: { in: coverage.clubIds } },
        select: { id: true, name: true, shortName: true, crestKey: true },
      }),
    ]);

    const sortedClubs = clubs.sort(byName);
    const clubOrder = sortedClubs.map((club) => club.id);
    const perCompetition = competitionCoverage(candidates);
    const toOption = (
      competition: (typeof competitions)[number],
    ): CompetitionOption => {
      const covered = perCompetition.get(competition.id);
      // The query only reads covered competitions
      if (!covered) throw new Error(`No coverage for ${competition.id}`);
      const inPool = new Set(covered.clubIds);
      return {
        ...toCompetitionRef(competition, this.env.ASSET_BASE_URL),
        clubIds: clubOrder.filter((id) => inPool.has(id)),
        seasonStarts: covered.seasonStarts,
      };
    };

    return {
      competitions: competitions.sort(byName).map(toOption),
      clubs: sortedClubs.map((club) =>
        toClubRef(club, this.env.ASSET_BASE_URL),
      ),
      era: coverage.era,
    };
  }

  // Kept 5 minutes; one build at a time (D3)
  overview(): Promise<CatalogOverview> {
    const startedAt = this.clock.now();
    if (this.built && startedAt - this.built.builtAt < OVERVIEW_TTL_MS) {
      return Promise.resolve(this.built.overview);
    }
    // A failed build keeps nothing; the next retries
    this.building ??= this.buildOverview()
      .then((overview) => {
        this.built = { overview, builtAt: startedAt };
        return overview;
      })
      .finally(() => {
        this.building = null;
      });
    return this.building;
  }

  // The pool's figures; the showcase is never in it
  private async buildOverview(): Promise<CatalogOverview> {
    const [candidates, showcase] = await Promise.all([
      this.selector.candidates(),
      this.showcase(),
    ]);
    const { era } = poolCoverage(candidates);
    const ids = candidates.map((candidate) => candidate.matchId);
    if (ids.length === 0) {
      const counts = { ...EMPTY_FIGURES.counts, players: 0 };
      const { highlights } = EMPTY_FIGURES;
      return {
        counts,
        era,
        highlights,
        competitions: [],
        topClubs: [],
        showcase,
      };
    }

    const [rows, players] = await Promise.all([
      this.prisma.match.findMany({
        where: { id: { in: ids } },
        select: OVERVIEW_SELECT,
      }),
      this.playerCount(ids),
    ]);
    const { counts, highlights } = overviewFigures(rows);
    const base = this.env.ASSET_BASE_URL;
    return {
      counts: { ...counts, players },
      era,
      highlights,
      competitions: poolCompetitions(rows).map((c) =>
        toCompetitionRef(c, base),
      ),
      topClubs: topClubs(rows).map((club) => toClubRef(club, base)),
      showcase,
    };
  }

  // Counted in the database, never selected (D6)
  private async playerCount(matchIds: string[]): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ players: number }[]>`
      SELECT count(DISTINCT l.player_id)::int AS players
      FROM lineups l
      JOIN match_teams t ON t.id = l.match_team_id
      WHERE t.match_id = ANY(${matchIds}::uuid[])`;
    return row?.players ?? 0;
  }

  private async showcase(): Promise<Showcase | null> {
    const row = await this.prisma.match.findUnique({
      where: { slug: this.showcaseSpec.matchSlug },
      select: SHOWCASE_SELECT,
    });
    const view = toShowcase(
      this.showcaseSpec,
      row,
      this.env.ASSET_BASE_URL,
      (id) => this.keys.keyOf(id),
    );
    this.noteShowcase('reason' in view ? view.reason : null);
    return 'showcase' in view ? view.showcase : null;
  }

  private noteShowcase(fault: string | null): void {
    if (fault === this.showcaseFault) return;
    if (fault) this.logger.warn(`Showcase off: ${fault}`);
    else this.logger.log('Showcase back on');
    this.showcaseFault = fault;
  }
}
