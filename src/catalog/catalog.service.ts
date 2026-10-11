import { Injectable } from '@nestjs/common';
import type { FilterOptions } from '@/contract/catalog.js';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import { toClubRef, toCompetitionRef } from '@/matches/match-refs.js';
import { poolCoverage } from '@/matches/pool-rules.js';
import { PrismaService } from '@/prisma/prisma.service.js';

type Named = { id: string; name: string };

// Fixed locale, id tie-break: a stable order
const byName = (a: Named, b: Named) =>
  a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en');

@Injectable()
export class CatalogService {
  constructor(
    private readonly selector: MatchSelectorService,
    private readonly prisma: PrismaService,
  ) {}

  // Only what the pool can serve; never every row
  async filterOptions(): Promise<FilterOptions> {
    const coverage = poolCoverage(await this.selector.candidates());
    if (coverage.competitionIds.length === 0) {
      return { competitions: [], clubs: [], era: coverage.era };
    }

    const [competitions, clubs] = await Promise.all([
      this.prisma.competition.findMany({
        where: { id: { in: coverage.competitionIds } },
        select: { id: true, kind: true, name: true },
      }),
      this.prisma.club.findMany({
        where: { id: { in: coverage.clubIds } },
        select: { id: true, name: true, shortName: true },
      }),
    ]);

    return {
      competitions: competitions.sort(byName).map(toCompetitionRef),
      clubs: clubs.sort(byName).map(toClubRef),
      era: coverage.era,
    };
  }
}
