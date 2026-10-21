import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { Side } from '@/contract/common.js';
import type { DuelOutcome } from '@/contract/duel.js';
import type { RoundTiming } from '@/contract/round.js';
import type { Seat } from '@/game/engine.js';
import { runRecord } from '@/game/run-record.js';
import type { TimedEffect } from '@/game/timed-game.js';
import type { PlayingRoom } from '@/duel/duel-room.js';
import type { Prisma } from '@/generated/prisma/client.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { failureKind, isAlreadySaved } from '@/prisma/save-errors.js';
import { recordGame } from '@/users/stats-writer.js';

export const DUEL_RETRY_MS = Symbol('DUEL_RETRY_MS');
export const DEFAULT_DUEL_RETRY_MS = 60_000;

const SEATS: readonly Seat[] = [0, 1];

// What a save needs; the squad stays behind
export type FinishedDuel = {
  readonly id: string;
  readonly userIds: readonly [string, string];
  readonly matchId: string;
  readonly side: Side;
  readonly firstRound: RoundTiming;
  readonly effects: readonly TimedEffect[];
  readonly lives: readonly number[];
  readonly outcomes: readonly [DuelOutcome, DuelOutcome];
};

export function finishedDuel(room: PlayingRoom): FinishedDuel {
  const result = room.timed.game.result;
  if (result?.mode !== 'duel') throw new Error(`Duel ${room.id} is not over`);
  return {
    id: room.id,
    userIds: [room.players[0].id, room.players[1].id],
    matchId: room.match.id,
    side: room.side,
    firstRound: room.firstRound,
    effects: room.effects,
    lives: room.timed.game.lives,
    outcomes: result.outcomes,
  };
}

async function write(tx: Prisma.TransactionClient, duel: FinishedDuel) {
  const rounds = runRecord(duel.firstRound, duel.effects);
  const last = rounds.at(-1);
  if (!last) throw new Error(`Duel ${duel.id} has no ended round`);

  const session = await tx.gameSession.create({
    data: {
      id: duel.id,
      mode: 'duel',
      status: 'over',
      matchId: duel.matchId,
      side: duel.side,
      startedAt: new Date(duel.firstRound.startedAt),
      endedAt: new Date(last.endedAt),
      participants: {
        create: SEATS.map((seat) => ({
          userId: duel.userIds[seat],
          seat,
          livesRemaining: duel.lives[seat],
          duelOutcome: duel.outcomes[seat],
        })),
      },
    },
    select: { participants: { select: { id: true, seat: true } } },
  });
  const participantIds = new Map(
    session.participants.map((row) => [row.seat, row.id]),
  );

  const created = await tx.gameRound.createManyAndReturn({
    data: rounds.map((round) => ({
      sessionId: duel.id,
      number: round.number,
      participantId: participantIds.get(round.seat)!,
      startedAt: new Date(round.startedAt),
      endsAt: new Date(round.endsAt),
      endedAt: new Date(round.endedAt),
      endReason: round.endReason,
    })),
    select: { id: true, number: true },
  });
  const roundIds = new Map(created.map((row) => [row.number, row.id]));

  const guesses = rounds.flatMap((round) =>
    round.guesses.map((entry) => ({ round: round.number, ...entry })),
  );
  await tx.guess.createMany({
    data: guesses.map((entry) => ({
      roundId: roundIds.get(entry.round)!,
      text: entry.text,
      outcome: entry.outcome,
      playerId: entry.playerId,
      receivedAt: new Date(entry.receivedAt),
    })),
  });

  // User-id order: two saves never lock in reverse
  const seats = [...SEATS].sort((a, b) =>
    duel.userIds[a].localeCompare(duel.userIds[b]),
  );
  for (const seat of seats) {
    const own = guesses.filter((entry) => entry.seat === seat);
    await recordGame(tx, duel.userIds[seat], {
      correctGuesses: own.filter((entry) => entry.outcome === 'correct_new')
        .length,
      totalGuesses: own.length,
      // A correct name ends the turn: no streaks
      bestStreak: 0,
      isPerfectClear: false,
      duelOutcome: duel.outcomes[seat],
    });
  }
}

// Finished duels wait here until Postgres has them
@Injectable()
export class DuelPersistenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('DuelPersistence');
  private readonly pending = new Map<string, FinishedDuel>();
  // A duel already being written is never sent twice
  private readonly saving = new Set<string>();
  private timer: NodeJS.Timeout | undefined;
  private isRetrying = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DUEL_RETRY_MS) private readonly retryMs: number,
  ) {}

  // Never waits: the result is already out
  record(room: PlayingRoom): void {
    const duel = finishedDuel(room);
    this.pending.set(duel.id, duel);
    void this.attempt(duel);
  }

  isPending(duelId: string): boolean {
    return this.pending.has(duelId);
  }

  // One pass at a time, one duel after another
  async retry(): Promise<void> {
    if (this.isRetrying) return;
    this.isRetrying = true;
    try {
      for (const duel of this.pending.values()) await this.attempt(duel);
    } finally {
      this.isRetrying = false;
    }
  }

  // True once the duel is in Postgres, now or before
  async save(duel: FinishedDuel): Promise<boolean> {
    try {
      await this.prisma.$transaction((tx) => write(tx, duel));
      return true;
    } catch (error) {
      if (isAlreadySaved(error)) return true;
      this.logger.error(
        `Duel ${duel.id} was not saved (${failureKind(error)})`,
      );
      return false;
    }
  }

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.retry();
    }, this.retryMs);
    // Never keeps the process alive on its own
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  private async attempt(duel: FinishedDuel): Promise<void> {
    if (this.saving.has(duel.id)) return;
    this.saving.add(duel.id);
    try {
      if (await this.save(duel)) this.pending.delete(duel.id);
    } finally {
      this.saving.delete(duel.id);
    }
  }
}
