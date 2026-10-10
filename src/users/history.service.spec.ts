import { ApiException } from '@/common/api-exception.js';
import { historyPageSchema } from '@/contract/profile.js';
import type { PrismaService } from '@/prisma/prisma.service.js';
import { BAD_CURSOR, HistoryService } from '@/users/history.service.js';

const USER_ID = '01900000-0000-7000-8000-0000000000aa';
const ENDED = new Date('2026-10-01T12:00:00.000Z');
const sessionId = (n: number) =>
  `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const MATCH = {
  id: '01900000-0000-7000-8000-0000000000e1',
  date: new Date('2005-05-25T00:00:00.000Z'),
  stage: 'Final',
  nickname: null,
  season: {
    label: '2004-05',
    competition: { id: 'comp-1', kind: 'ucl' as const, name: 'Cup' },
  },
  teams: [
    {
      side: 'home',
      goals: 3,
      club: { id: 'h', name: 'Home', shortName: 'HOM' },
    },
    {
      side: 'away',
      goals: 3,
      club: { id: 'a', name: 'Away', shortName: 'AWY' },
    },
  ],
};

const solo = (n: number, extra: object = {}) => ({
  sessionId: sessionId(n),
  livesRemaining: 2,
  duelOutcome: null,
  session: {
    mode: 'solo',
    endedAt: ENDED,
    soloEndReason: 'lives_out',
    match: MATCH,
  },
  ...extra,
});

const duel = (n: number) => ({
  sessionId: sessionId(n),
  livesRemaining: 0,
  duelOutcome: 'loss',
  session: { mode: 'duel', endedAt: ENDED, soloEndReason: null, match: MATCH },
});

const rounds = (n: number, ...found: number[]) =>
  found.map((guesses) => ({ sessionId: sessionId(n), _count: { guesses } }));

describe('HistoryService', () => {
  const prisma = {
    gameParticipant: { findMany: vi.fn(), findFirst: vi.fn() },
    gameRound: { findMany: vi.fn() },
  };
  const service = new HistoryService(prisma as unknown as PrismaService);

  beforeEach(() => {
    vi.resetAllMocks();
    prisma.gameParticipant.findMany.mockResolvedValue([]);
    prisma.gameRound.findMany.mockResolvedValue([]);
  });

  it("reads only the user's finished games, newest first", async () => {
    await service.historyOf(USER_ID, { limit: 20 });

    expect(prisma.gameParticipant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              userId: USER_ID,
              session: { status: 'over' },
              OR: [
                { session: { mode: 'solo' } },
                { duelOutcome: { not: null } },
              ],
            },
            {},
          ],
        },
        orderBy: [{ session: { endedAt: 'desc' } }, { sessionId: 'desc' }],
        take: 21,
      }),
    );
  });

  it('gives an empty page without counting anything', async () => {
    const page = await service.historyOf(USER_ID, { limit: 20 });

    expect(page).toEqual({ entries: [], nextCursor: null });
    expect(prisma.gameRound.findMany).not.toHaveBeenCalled();
  });

  it('maps solo and duel rows to their own outcomes', async () => {
    prisma.gameParticipant.findMany.mockResolvedValue([solo(2), duel(1)]);

    const page = await service.historyOf(USER_ID, { limit: 20 });

    expect(page.entries).toMatchObject([
      {
        id: sessionId(2),
        mode: 'solo',
        outcome: 'lives_out',
        livesRemaining: 2,
      },
      { id: sessionId(1), mode: 'duel', outcome: 'loss', livesRemaining: 0 },
    ]);
    expect(page.entries[0].playedAt).toBe('2026-10-01T12:00:00.000Z');
    expect(page.entries[0].match.score).toEqual({ home: 3, away: 3 });
    expect(historyPageSchema.parse(page)).toEqual(page);
  });

  it("sums each session's correct_new guesses, in one query", async () => {
    prisma.gameParticipant.findMany.mockResolvedValue([solo(2), duel(1)]);
    prisma.gameRound.findMany.mockResolvedValue([
      ...rounds(2, 1, 1, 0),
      ...rounds(1, 1, 1, 1, 1, 0),
    ]);

    const page = await service.historyOf(USER_ID, { limit: 20 });

    expect(page.entries.map((e) => e.foundCount)).toEqual([2, 4]);
    expect(prisma.gameRound.findMany).toHaveBeenCalledOnce();
    expect(prisma.gameRound.findMany).toHaveBeenCalledWith({
      where: { sessionId: { in: [sessionId(2), sessionId(1)] } },
      select: {
        sessionId: true,
        _count: { select: { guesses: { where: { outcome: 'correct_new' } } } },
      },
    });
  });

  it('gives a found count of 0 to a session with no rounds', async () => {
    prisma.gameParticipant.findMany.mockResolvedValue([solo(1)]);

    const page = await service.historyOf(USER_ID, { limit: 20 });

    expect(page.entries[0].foundCount).toBe(0);
  });

  describe('paging', () => {
    it('names the first entry of the next page as nextCursor', async () => {
      prisma.gameParticipant.findMany.mockResolvedValue([
        solo(3),
        solo(2),
        solo(1),
      ]);

      const page = await service.historyOf(USER_ID, { limit: 2 });

      expect(page.entries.map((e) => e.id)).toEqual([
        sessionId(3),
        sessionId(2),
      ]);
      expect(page.nextCursor).toBe(sessionId(1));
    });

    it('gives a short page no cursor', async () => {
      prisma.gameParticipant.findMany.mockResolvedValue([solo(2), solo(1)]);

      const page = await service.historyOf(USER_ID, { limit: 2 });

      expect(page.nextCursor).toBeNull();
    });

    it("starts at the cursor's own entry, keyset by end time", async () => {
      prisma.gameParticipant.findFirst.mockResolvedValue({
        session: { endedAt: ENDED },
      });

      await service.historyOf(USER_ID, { cursor: sessionId(5), limit: 2 });

      expect(prisma.gameParticipant.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [
            expect.objectContaining({ userId: USER_ID }),
            { sessionId: sessionId(5) },
          ],
        },
        select: { session: { select: { endedAt: true } } },
      });
      expect(prisma.gameParticipant.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              expect.objectContaining({ userId: USER_ID }),
              {
                OR: [
                  { session: { endedAt: { lt: ENDED } } },
                  {
                    session: { endedAt: ENDED },
                    sessionId: { lte: sessionId(5) },
                  },
                ],
              },
            ],
          },
        }),
      );
    });
  });

  describe('refuses a cursor that', () => {
    async function refusal(cursor: string) {
      try {
        await service.historyOf(USER_ID, { cursor, limit: 20 });
      } catch (e: unknown) {
        return e;
      }
      throw new Error('Expected a refusal');
    }

    it('is not a UUID, without asking the database', async () => {
      const error = await refusal('not-a-uuid');

      expect(error).toBeInstanceOf(ApiException);
      expect(error).toMatchObject({
        status: 400,
        error: { code: 'invalid_input', message: BAD_CURSOR },
      });
      expect(prisma.gameParticipant.findFirst).not.toHaveBeenCalled();
      expect(prisma.gameParticipant.findMany).not.toHaveBeenCalled();
    });

    // Unknown, foreign or unfinished: none match the lookup
    it('matches none of your finished games', async () => {
      prisma.gameParticipant.findFirst.mockResolvedValue(null);

      expect(await refusal(sessionId(9))).toMatchObject({
        error: { code: 'invalid_input', message: BAD_CURSOR },
      });
      expect(prisma.gameParticipant.findMany).not.toHaveBeenCalled();
    });
  });

  describe('fails loudly on a row the CHECKs should rule out', () => {
    it.each([
      [
        'a solo run with no end reason',
        solo(1, { session: { ...solo(1).session, soloEndReason: null } }),
      ],
      [
        'a session with no end time',
        solo(1, { session: { ...solo(1).session, endedAt: null } }),
      ],
    ])('%s', async (_, row) => {
      prisma.gameParticipant.findMany.mockResolvedValue([row]);

      await expect(service.historyOf(USER_ID, { limit: 20 })).rejects.toThrow(
        /no outcome|not over/,
      );
    });
  });
});
