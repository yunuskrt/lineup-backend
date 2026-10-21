import { Injectable, Logger } from '@nestjs/common';
import { runRecord } from '@/game/run-record.js';
import { runFigures } from '@/game/summary.js';
import type { Prisma } from '@/generated/prisma/client.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { failureKind, isAlreadySaved } from '@/prisma/save-errors.js';
import type { PlayedRun } from '@/solo/solo-run.js';
import { recordGame } from '@/users/stats-writer.js';

async function write(tx: Prisma.TransactionClient, run: PlayedRun) {
  const result = run.timed.game.result;
  if (result?.mode !== 'solo') throw new Error(`Run ${run.id} is not over`);
  const rounds = runRecord(run.firstRound, run.effects);
  const last = rounds.at(-1);
  if (!last) throw new Error(`Run ${run.id} has no ended round`);

  const session = await tx.gameSession.create({
    data: {
      id: run.id,
      mode: 'solo',
      status: 'over',
      matchId: run.match.id,
      side: run.side,
      startedAt: new Date(run.firstRound.startedAt),
      endedAt: new Date(last.endedAt),
      soloEndReason: result.endReason,
      participants: {
        create: {
          userId: run.userId,
          seat: 0,
          livesRemaining: result.livesRemaining,
        },
      },
    },
    select: { participants: { select: { id: true } } },
  });
  const participantId = session.participants[0].id;

  const created = await tx.gameRound.createManyAndReturn({
    data: rounds.map((round) => ({
      sessionId: run.id,
      number: round.number,
      participantId,
      startedAt: new Date(round.startedAt),
      endsAt: new Date(round.endsAt),
      endedAt: new Date(round.endedAt),
      endReason: round.endReason,
    })),
    select: { id: true, number: true },
  });
  const roundIds = new Map(created.map((row) => [row.number, row.id]));

  const guesses = rounds.flatMap((round) =>
    round.guesses.map((entry) => ({
      roundId: roundIds.get(round.number)!,
      text: entry.text,
      outcome: entry.outcome,
      playerId: entry.playerId,
      receivedAt: new Date(entry.receivedAt),
    })),
  );
  await tx.guess.createMany({ data: guesses });

  await recordGame(tx, run.userId, {
    correctGuesses: guesses.filter((entry) => entry.outcome === 'correct_new')
      .length,
    totalGuesses: guesses.length,
    bestStreak: runFigures(run.firstRound, run.effects).bestStreak,
    isPerfectClear: result.endReason === 'perfect_clear',
    duelOutcome: null,
  });
}

@Injectable()
export class SoloPersistenceService {
  private readonly logger = new Logger('SoloPersistence');

  constructor(private readonly prisma: PrismaService) {}

  // True once the run is in Postgres, now or before
  async save(run: PlayedRun): Promise<boolean> {
    try {
      await this.prisma.$transaction((tx) => write(tx, run));
      return true;
    } catch (error) {
      if (isAlreadySaved(error)) return true;
      this.logger.error(`Run ${run.id} was not saved (${failureKind(error)})`);
      return false;
    }
  }
}
