import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ApiException } from '@/common/api-exception.js';
import type {
  HistoryEntry,
  HistoryPage,
  HistoryQuery,
} from '@/contract/profile.js';
import type { Prisma } from '@/generated/prisma/client.js';
import {
  MATCH_IDENTITY_SELECT,
  toMatchIdentity,
} from '@/matches/match-refs.js';
import { PrismaService } from '@/prisma/prisma.service.js';

export const BAD_CURSOR = 'That history page is not available. Start again.';

const uuidSchema = z.uuid();

const ENTRY_SELECT = {
  sessionId: true,
  livesRemaining: true,
  duelOutcome: true,
  session: {
    select: {
      mode: true,
      endedAt: true,
      soloEndReason: true,
      match: { select: MATCH_IDENTITY_SELECT },
    },
  },
} satisfies Prisma.GameParticipantSelect;

type EntryRow = Prisma.GameParticipantGetPayload<{
  select: typeof ENTRY_SELECT;
}>;

// A duel lists once B41 has written its outcome
const finished = (userId: string): Prisma.GameParticipantWhereInput => ({
  userId,
  session: { status: 'over' },
  OR: [{ session: { mode: 'solo' } }, { duelOutcome: { not: null } }],
});

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async historyOf(userId: string, query: HistoryQuery): Promise<HistoryPage> {
    const from = query.cursor
      ? await this.startOf(userId, query.cursor)
      : undefined;

    const rows = await this.prisma.gameParticipant.findMany({
      where: { AND: [finished(userId), from ?? {}] },
      orderBy: [{ session: { endedAt: 'desc' } }, { sessionId: 'desc' }],
      take: query.limit + 1,
      select: ENTRY_SELECT,
    });
    const page = rows.slice(0, query.limit);
    const found = await this.foundCounts(page.map((row) => row.sessionId));

    return {
      entries: page.map((row) => toEntry(row, found.get(row.sessionId) ?? 0)),
      nextCursor: rows[query.limit]?.sessionId ?? null,
    };
  }

  // Keyset: the cursor's entry and everything after
  private async startOf(
    userId: string,
    cursor: string,
  ): Promise<Prisma.GameParticipantWhereInput> {
    const row = uuidSchema.safeParse(cursor).success
      ? await this.prisma.gameParticipant.findFirst({
          where: { AND: [finished(userId), { sessionId: cursor }] },
          select: { session: { select: { endedAt: true } } },
        })
      : null;
    const endedAt = row?.session.endedAt;
    if (!endedAt) throw new ApiException('invalid_input', BAD_CURSOR);

    return {
      OR: [
        { session: { endedAt: { lt: endedAt } } },
        { session: { endedAt }, sessionId: { lte: cursor } },
      ],
    };
  }

  // One query for the page; correct_new is the found pool
  private async foundCounts(sessionIds: string[]) {
    const counts = new Map<string, number>();
    if (sessionIds.length === 0) return counts;

    const rounds = await this.prisma.gameRound.findMany({
      where: { sessionId: { in: sessionIds } },
      select: {
        sessionId: true,
        _count: { select: { guesses: { where: { outcome: 'correct_new' } } } },
      },
    });

    for (const round of rounds) {
      const total = counts.get(round.sessionId) ?? 0;
      counts.set(round.sessionId, total + round._count.guesses);
    }
    return counts;
  }
}

function toEntry(row: EntryRow, foundCount: number): HistoryEntry {
  const { session } = row;
  // B08's CHECK sets ended_at on every finished session
  if (!session.endedAt) throw new Error(`Session ${row.sessionId} not over`);

  const base = {
    id: row.sessionId,
    playedAt: session.endedAt.toISOString(),
    match: toMatchIdentity(session.match),
    foundCount,
    livesRemaining: row.livesRemaining,
  };

  if (session.mode === 'solo' && session.soloEndReason) {
    return { ...base, mode: 'solo', outcome: session.soloEndReason };
  }
  if (session.mode === 'duel' && row.duelOutcome) {
    return { ...base, mode: 'duel', outcome: row.duelOutcome };
  }
  throw new Error(`Session ${row.sessionId} has no outcome`);
}
