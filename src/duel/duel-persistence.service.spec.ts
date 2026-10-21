import { Logger } from '@nestjs/common';
import { duelPlayer } from '@/contract/contract.fixtures.js';
import { applyTimed, type TimedInput } from '@/game/timed-game.js';
import {
  DuelPersistenceService,
  finishedDuel,
} from '@/duel/duel-persistence.service.js';
import type { PlayingRoom } from '@/duel/duel-room.js';
import { playingRoom, T0 } from '@/duel/duel.fixtures.js';
import { Prisma } from '@/generated/prisma/client.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

const RETRY_MS = 1_000;

const guess = (seat: 0 | 1, text: string): TimedInput => ({
  kind: 'guess',
  seat,
  text,
});

// Seat 0 is "zed", so user-id order flips the seats
function finishedRoom(): PlayingRoom {
  const start: PlayingRoom = {
    ...playingRoom(0),
    players: [duelPlayer('zed'), duelPlayer('amy')],
  };
  const steps: [TimedInput, number][] = [
    [guess(0, 'zulu'), 1_000],
    [guess(0, 'alfa'), 2_000],
    [guess(1, 'bravo'), 3_000],
    [guess(0, 'alfa'), 4_000],
    [{ kind: 'forfeit', seat: 1 }, 5_000],
  ];
  let { timed } = start;
  const effects = [];
  for (const [input, at] of steps) {
    const step = applyTimed(timed, input, T0 + at);
    timed = step.timed;
    effects.push(...step.effects);
  }
  return { ...start, timed, effects };
}

type Stats = { userId: string; values: unknown[] };

// Runs the callback against a recording tx
function prismaWith(...failures: unknown[]) {
  const writes: string[] = [];
  const stats: Stats[] = [];
  const tx = {
    gameSession: {
      create: vi.fn(() => {
        writes.push('session');
        return Promise.resolve({
          participants: [
            { id: 'part-1', seat: 1 },
            { id: 'part-0', seat: 0 },
          ],
        });
      }),
    },
    gameRound: {
      createManyAndReturn: vi.fn(({ data }: { data: { number: number }[] }) => {
        writes.push('rounds');
        return Promise.resolve(
          data.map((row) => ({
            id: `round-${row.number}`,
            number: row.number,
          })),
        );
      }),
    },
    guess: {
      createMany: vi.fn(() => {
        writes.push('guesses');
        return Promise.resolve({ count: 0 });
      }),
    },
    $executeRaw: vi.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        writes.push('stats');
        if (strings.join('?').includes('INSERT INTO user_stats')) {
          stats.push({ userId: values[0] as string, values: values.slice(1) });
        }
        return Promise.resolve(1);
      },
    ),
  };
  const $transaction = vi.fn(async (write: (client: typeof tx) => unknown) => {
    const failure = failures.shift();
    if (failure) throw failure;
    return write(tx);
  });
  const service = new DuelPersistenceService(
    { $transaction } as unknown as PrismaService,
    RETRY_MS,
  );
  return { service, tx, writes, stats, $transaction };
}

describe('finishedDuel', () => {
  it('keeps what a save needs, and drops the squad', () => {
    const duel = finishedDuel(finishedRoom());
    expect(duel).toMatchObject({
      id: 'room-1',
      userIds: ['zed', 'amy'],
      matchId: 'm-1',
      side: 'home',
      lives: [3, 3],
      outcomes: ['forfeit_win', 'loss'],
    });
    expect(Object.keys(duel)).not.toContain('squad');
    expect(JSON.stringify(duel)).not.toContain('aliases');
  });

  it('refuses a duel still in play', () => {
    expect(() => finishedDuel(playingRoom(0))).toThrow('not over');
  });
});

describe('DuelPersistenceService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes the session, rounds, guesses, then both stats', async () => {
    const { service, writes } = prismaWith();
    await expect(service.save(finishedDuel(finishedRoom()))).resolves.toBe(
      true,
    );
    expect(writes).toEqual([
      'session',
      'rounds',
      'guesses',
      'stats',
      'stats',
      'stats',
      'stats',
    ]);
  });

  it('keys the session by the room id, with a seat per player', async () => {
    const { service, tx } = prismaWith();
    await service.save(finishedDuel(finishedRoom()));

    expect(tx.gameSession.create).toHaveBeenCalledWith({
      data: {
        id: 'room-1',
        mode: 'duel',
        status: 'over',
        matchId: 'm-1',
        side: 'home',
        startedAt: new Date(T0),
        endedAt: new Date(T0 + 5_000),
        participants: {
          create: [
            {
              userId: 'zed',
              seat: 0,
              livesRemaining: 3,
              duelOutcome: 'forfeit_win',
            },
            { userId: 'amy', seat: 1, livesRemaining: 3, duelOutcome: 'loss' },
          ],
        },
      },
      select: { participants: { select: { id: true, seat: true } } },
    });
  });

  it('points each round at the seat on turn', async () => {
    const { service, tx } = prismaWith();
    await service.save(finishedDuel(finishedRoom()));

    const rounds = tx.gameRound.createManyAndReturn.mock.calls[0][0].data;
    expect(rounds).toEqual([
      expect.objectContaining({
        number: 1,
        participantId: 'part-0',
        endReason: 'found',
      }),
      expect.objectContaining({
        number: 2,
        participantId: 'part-1',
        endReason: 'found',
      }),
      expect.objectContaining({
        number: 3,
        participantId: 'part-0',
        endReason: 'ended',
        endedAt: new Date(T0 + 5_000),
      }),
    ]);
  });

  it('files each guess under its round, as typed', async () => {
    const { service, tx } = prismaWith();
    await service.save(finishedDuel(finishedRoom()));

    expect(tx.guess.createMany).toHaveBeenCalledWith({
      data: [
        {
          roundId: 'round-1',
          text: 'zulu',
          outcome: 'not_in_xi',
          playerId: null,
          receivedAt: new Date(T0 + 1_000),
        },
        expect.objectContaining({ roundId: 'round-1', playerId: 'p-alfa' }),
        expect.objectContaining({ roundId: 'round-2', playerId: 'p-bravo' }),
        expect.objectContaining({
          roundId: 'round-3',
          outcome: 'already_found',
          playerId: 'p-alfa',
        }),
      ],
    });
  });

  it('counts each player in user-id order, with their own guesses', async () => {
    const { service, stats } = prismaWith();
    await service.save(finishedDuel(finishedRoom()));

    // w, l, d, clears, streak, correct, total
    expect(stats).toEqual([
      { userId: 'amy', values: [0, 1, 0, 0, 0, 1, 1] },
      { userId: 'zed', values: [1, 0, 0, 0, 0, 1, 3] },
    ]);
  });

  it('reads a duplicate key as already saved', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('taken', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const { service } = prismaWith(duplicate);
    await expect(service.save(finishedDuel(finishedRoom()))).resolves.toBe(
      true,
    );
  });

  it.each([
    [
      'a Prisma code',
      new Prisma.PrismaClientKnownRequestError('fk', {
        code: 'P2003',
        clientVersion: 'test',
      }),
      'P2003',
    ],
    ['an error class', new Error('guess "zulu" broke a CHECK'), 'Error'],
    ['an unknown throw', 'boom', 'unknown'],
  ])(
    'names %s when a save fails, and no row data',
    async (_, failure, kind) => {
      const error = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      const { service } = prismaWith(failure);

      await expect(service.save(finishedDuel(finishedRoom()))).resolves.toBe(
        false,
      );
      expect(error).toHaveBeenCalledWith(`Duel room-1 was not saved (${kind})`);
      expect(JSON.stringify(error.mock.calls)).not.toMatch(/zulu|alfa|amy|zed/);
    },
  );

  it('refuses a duel with no ended round, writing nothing', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const { service, writes } = prismaWith();
    const duel = { ...finishedDuel(finishedRoom()), effects: [] };

    await expect(service.save(duel)).resolves.toBe(false);
    expect(writes).toEqual([]);
    expect(error).toHaveBeenCalledWith('Duel room-1 was not saved (Error)');
  });

  describe('record', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('saves at once, and forgets the duel once saved', async () => {
      const { service, $transaction } = prismaWith();
      service.record(finishedRoom());
      expect(service.isPending('room-1')).toBe(true);

      await vi.waitFor(() => expect(service.isPending('room-1')).toBe(false));
      expect($transaction).toHaveBeenCalledTimes(1);
    });

    it('keeps a failed save, and the timer retries it', async () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const { service, $transaction } = prismaWith(new Error('down'));
      service.onModuleInit();
      service.record(finishedRoom());

      await vi.waitFor(() => expect($transaction).toHaveBeenCalledTimes(1));
      expect(service.isPending('room-1')).toBe(true);

      await vi.advanceTimersByTimeAsync(RETRY_MS);
      expect($transaction).toHaveBeenCalledTimes(2);
      expect(service.isPending('room-1')).toBe(false);

      // Nothing left: the next pass saves nothing
      await vi.advanceTimersByTimeAsync(RETRY_MS);
      expect($transaction).toHaveBeenCalledTimes(2);
      service.onModuleDestroy();
    });

    it('runs one retry pass at a time', async () => {
      const error = vi
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => {});
      const { service, $transaction } = prismaWith(new Error('down'));
      service.record(finishedRoom());
      // The first save has failed and let go
      await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(1));

      await Promise.all([service.retry(), service.retry()]);
      expect($transaction).toHaveBeenCalledTimes(2);
    });

    it('never runs two saves of one duel at once', async () => {
      const { service, $transaction } = prismaWith();
      let release = () => {};
      $transaction.mockImplementationOnce(
        () => new Promise<void>((resolve) => (release = resolve)),
      );
      service.record(finishedRoom());
      await service.retry();
      expect($transaction).toHaveBeenCalledTimes(1);

      release();
      await vi.waitFor(() => expect(service.isPending('room-1')).toBe(false));
      expect($transaction).toHaveBeenCalledTimes(1);
    });

    it('stops retrying on module destroy', async () => {
      vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      const { service, $transaction } = prismaWith(new Error('down'));
      service.onModuleInit();
      service.record(finishedRoom());
      await vi.waitFor(() => expect($transaction).toHaveBeenCalledTimes(1));

      service.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
      expect($transaction).toHaveBeenCalledTimes(1);
    });
  });
});
