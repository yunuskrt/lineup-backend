import { Inject, Injectable } from '@nestjs/common';
import {
  type ArchiveEntry,
  archivePage,
  newestFirst,
  toArchiveEntry,
} from '@/catalog/archive.js';
import { ApiException } from '@/common/api-exception.js';
import { CLOCK, type Clock } from '@/common/clock.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import type { ArchivePage, ArchiveQuery } from '@/contract/catalog.js';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import {
  MATCH_IDENTITY_SELECT,
  toMatchIdentity,
} from '@/matches/match-refs.js';
import { PrismaService } from '@/prisma/prisma.service.js';

// As the overview: new data shows within this
export const ARCHIVE_TTL_MS = 5 * 60_000;

export const ARCHIVE_MESSAGES = {
  proRequired: 'Browsing the match archive needs Pro.',
  badCursor: 'That page link is no longer valid.',
} as const;

type BuiltIndex = { entries: ArchiveEntry[]; builtAt: number };

@Injectable()
export class ArchiveService {
  private built: BuiltIndex | null = null;
  private building: Promise<ArchiveEntry[]> | null = null;

  constructor(
    private readonly selector: MatchSelectorService,
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async page(query: ArchiveQuery): Promise<ArchivePage> {
    const page = archivePage(await this.index(), query);
    if (!page) {
      throw new ApiException('invalid_input', ARCHIVE_MESSAGES.badCursor);
    }
    return page;
  }

  // Kept 5 minutes; one build at a time
  private index(): Promise<ArchiveEntry[]> {
    const startedAt = this.clock.now();
    if (this.built && startedAt - this.built.builtAt < ARCHIVE_TTL_MS) {
      return Promise.resolve(this.built.entries);
    }
    // A failed build keeps nothing; the next retries
    this.building ??= this.build()
      .then((entries) => {
        this.built = { entries, builtAt: startedAt };
        return entries;
      })
      .finally(() => {
        this.building = null;
      });
    return this.building;
  }

  // The selector's pool: what R13 accepts
  private async build(): Promise<ArchiveEntry[]> {
    const candidates = await this.selector.candidates();
    const seasonStarts = new Map(
      candidates.map((c) => [c.matchId, c.seasonStart]),
    );
    const clubIds = [...new Set(candidates.flatMap((c) => c.clubIds))];
    const [rows, aliasRows] = await Promise.all([
      this.prisma.match.findMany({
        where: { id: { in: [...seasonStarts.keys()] } },
        select: MATCH_IDENTITY_SELECT,
      }),
      this.prisma.clubAlias.findMany({
        where: { clubId: { in: clubIds } },
        select: { clubId: true, alias: true },
      }),
    ]);
    const aliases = new Map<string, string[]>();
    for (const { clubId, alias } of aliasRows) {
      aliases.set(clubId, [...(aliases.get(clubId) ?? []), alias]);
    }
    return rows
      .map((row) =>
        toArchiveEntry({
          identity: toMatchIdentity(row, this.env.ASSET_BASE_URL),
          // Queried by these very ids
          seasonStart: seasonStarts.get(row.id)!,
          aliases,
        }),
      )
      .sort(newestFirst);
  }
}
