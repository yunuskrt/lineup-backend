import { Logger } from '@nestjs/common';
import { Prisma } from '@/generated/prisma/client.js';
import type { PrismaService } from '@/prisma/prisma.service.js';
import { SoloPersistenceService } from '@/solo/solo-persistence.service.js';
import { guess, playedRun, T0 } from '@/solo/solo.fixtures.js';

const QUIT = { kind: 'quit' } as const;

// Runs the callback against a recording tx
function prismaWith(failure?: unknown) {
  const writes: string[] = [];
  const tx = {
    gameSession: {
      create: vi.fn(() => {
        writes.push('session');
        return Promise.resolve({ participants: [{ id: 'part-1' }] });
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
    $executeRaw: vi.fn(() => {
      writes.push('stats');
      return Promise.resolve(1);
    }),
  };
  const $transaction = vi.fn(async (write: (client: typeof tx) => unknown) => {
    if (failure) throw failure;
    return write(tx);
  });
  const service = new SoloPersistenceService({
    $transaction,
  } as unknown as PrismaService);
  return { service, tx, writes };
}

const finished = () =>
  playedRun(
    [guess('zulu'), 1_000],
    [guess('alfa'), 2_000],
    [guess('bravo'), 3_000],
    [QUIT, 4_000],
  );

describe('SoloPersistenceService', () => {
  it('writes the session, rounds, guesses, then the stats', async () => {
    const { service, writes } = prismaWith();
    await expect(service.save(finished())).resolves.toBe(true);
    expect(writes).toEqual(['session', 'rounds', 'guesses', 'stats', 'stats']);
  });

  it('keys the session by the run id, with one seat-0 player', async () => {
    const { service, tx } = prismaWith();
    await service.save(finished());

    expect(tx.gameSession.create).toHaveBeenCalledWith({
      data: {
        id: 'run-1',
        mode: 'solo',
        status: 'over',
        matchId: 'm-1',
        side: 'home',
        startedAt: new Date(T0),
        endedAt: new Date(T0 + 4_000),
        soloEndReason: 'quit',
        participants: {
          create: { userId: 'user-1', seat: 0, livesRemaining: 3 },
        },
      },
      select: { participants: { select: { id: true } } },
    });
  });

  it('points every round at that player, and guesses at their round', async () => {
    const { service, tx } = prismaWith();
    await service.save(finished());

    const rounds = tx.gameRound.createManyAndReturn.mock.calls[0][0].data;
    expect(rounds).toHaveLength(3);
    expect(rounds).toEqual([
      expect.objectContaining({
        number: 1,
        participantId: 'part-1',
        endReason: 'found',
        endedAt: new Date(T0 + 2_000),
      }),
      expect.objectContaining({ number: 2, endReason: 'found' }),
      expect.objectContaining({ number: 3, endReason: 'ended' }),
    ]);
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
      ],
    });
  });

  it('counts the run into the stats', async () => {
    const { service, tx } = prismaWith();
    await service.save(finished());
    // user id, perfect clears, streak, correct, total
    expect(tx.$executeRaw.mock.calls[0].slice(1)).toEqual([
      'user-1',
      0,
      2,
      2,
      3,
    ]);
  });

  it('reads a duplicate key as already saved', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('taken', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const { service } = prismaWith(duplicate);
    await expect(service.save(finished())).resolves.toBe(true);
  });

  it('reports any other failure, logging no row data', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const { service } = prismaWith(new Error('guess "zulu" broke a CHECK'));

    await expect(service.save(finished())).resolves.toBe(false);
    expect(error).toHaveBeenCalledWith('Run run-1 was not saved (Error)');
    error.mockRestore();
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
    ['an unknown throw', 'boom', 'unknown'],
  ])('names %s when a save fails', async (_, failure, kind) => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const { service } = prismaWith(failure);

    await expect(service.save(finished())).resolves.toBe(false);
    expect(error).toHaveBeenCalledWith(`Run run-1 was not saved (${kind})`);
    error.mockRestore();
  });

  it('refuses a run still in play', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const { service, writes } = prismaWith();

    await expect(service.save(playedRun())).resolves.toBe(false);
    expect(writes).toEqual([]);
    error.mockRestore();
  });
});
