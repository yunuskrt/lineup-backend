import type { GameMode, Prisma } from '@/generated/prisma/client.js';
import {
  type Built,
  buildMatch,
  buildUsers,
} from '@test/schema/schema-fixtures.js';
import {
  type Tx,
  useRolledBackDb,
  violation,
} from '@test/schema/schema-test-utils.js';

const T0 = new Date('2026-10-03T12:00:00.000Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

// A session on a fresh match, one or two players
async function startSession(tx: Tx, mode: GameMode) {
  const built = await buildMatch(tx);
  const users = await buildUsers(tx, mode === 'solo' ? 1 : 2);
  const session = await tx.gameSession.create({
    data: {
      mode,
      matchId: built.match.id,
      side: 'home',
      startedAt: T0,
      participants: {
        create: users.map((user, seat) => ({ userId: user.id, seat })),
      },
    },
    include: { participants: { orderBy: { seat: 'asc' } } },
  });
  return { built, session, seats: session.participants };
}

type Started = Awaited<ReturnType<typeof startSession>>;

const round = (
  tx: Tx,
  { session, seats }: Started,
  data: Partial<Prisma.GameRoundUncheckedCreateInput> = {},
) =>
  tx.gameRound.create({
    data: {
      sessionId: session.id,
      participantId: seats[0].id,
      number: 1,
      startedAt: at(0),
      endsAt: at(15),
      ...data,
    },
  });

describe('Scoring & session schema (e2e)', () => {
  const { rolledBack, prisma } = useRolledBackDb();

  const withSession = <T>(
    mode: GameMode,
    change: (tx: Tx, started: Started) => Promise<T>,
  ) => rolledBack(async (tx) => change(tx, await startSession(tx, mode)));

  it('round-trips a finished solo run with rounds and guesses', async () => {
    const read = await withSession('solo', async (tx, started) => {
      const { built, session } = started;
      const starter = built.players[9];
      const first = await round(tx, started, {
        endedAt: at(6),
        endReason: 'found',
      });
      await tx.guess.createMany({
        data: [
          {
            roundId: first.id,
            text: 'Zlatan',
            outcome: 'not_in_xi',
            receivedAt: at(3),
          },
          {
            roundId: first.id,
            text: 'Player 9',
            outcome: 'correct_new',
            playerId: starter.id,
            receivedAt: at(6),
          },
        ],
      });
      const second = await round(tx, started, {
        number: 2,
        startedAt: at(6),
        endsAt: at(21),
        endedAt: at(21),
        endReason: 'expired',
      });
      await tx.guess.create({
        data: {
          roundId: second.id,
          text: 'Player 9',
          outcome: 'already_found',
          playerId: starter.id,
        },
      });
      await tx.gameSession.update({
        where: { id: session.id },
        data: { status: 'over', endedAt: at(21), soloEndReason: 'quit' },
      });
      return tx.gameSession.findUniqueOrThrow({
        where: { id: session.id },
        include: {
          participants: { include: { user: true } },
          rounds: {
            orderBy: { number: 'asc' },
            include: { guesses: { orderBy: { receivedAt: 'asc' } } },
          },
        },
      });
    });

    expect(read).toMatchObject({
      mode: 'solo',
      status: 'over',
      side: 'home',
      soloEndReason: 'quit',
      participants: [
        { seat: 0, livesRemaining: 3, user: { handle: 'test-user-a' } },
      ],
    });
    expect(read.rounds.map((r) => [r.number, r.endReason])).toEqual([
      [1, 'found'],
      [2, 'expired'],
    ]);
    expect(
      read.rounds[0].endsAt.getTime() - read.rounds[0].startedAt.getTime(),
    ).toBe(15_000);
    expect(read.rounds.flatMap((r) => r.guesses.map((g) => g.outcome))).toEqual(
      ['not_in_xi', 'correct_new', 'already_found'],
    );
  });

  it('round-trips a duel with alternating turns and outcomes', async () => {
    const read = await withSession('duel', async (tx, started) => {
      const [a, b] = started.seats;
      await round(tx, started, {
        participantId: a.id,
        endedAt: at(15),
        endReason: 'expired',
      });
      await round(tx, started, {
        number: 2,
        participantId: b.id,
        startedAt: at(15),
        endsAt: at(30),
      });
      await tx.gameParticipant.update({
        where: { id: a.id },
        data: { livesRemaining: 0, duelOutcome: 'loss' },
      });
      await tx.gameParticipant.update({
        where: { id: b.id },
        data: { duelOutcome: 'win' },
      });
      await tx.gameSession.update({
        where: { id: started.session.id },
        data: { status: 'over', endedAt: at(30) },
      });
      return tx.gameSession.findUniqueOrThrow({
        where: { id: started.session.id },
        include: {
          participants: { orderBy: { seat: 'asc' }, include: { user: true } },
          rounds: {
            orderBy: { number: 'asc' },
            include: { participant: true },
          },
        },
      });
    });

    expect(read.soloEndReason).toBeNull();
    expect(
      read.participants.map((p) => [
        p.user.handle,
        p.livesRemaining,
        p.duelOutcome,
      ]),
    ).toEqual([
      ['test-user-a', 0, 'loss'],
      ['test-user-b', 3, 'win'],
    ]);
    expect(read.rounds.map((r) => r.participant.seat)).toEqual([0, 1]);
  });

  it('leaves no rows behind', async () => {
    // buildUsers' prefix; the auth suite commits others
    const leftovers = await prisma().user.count({
      where: { email: { startsWith: 'test-user-' } },
    });
    expect(leftovers).toBe(0);
  });

  describe('memorability_scores', () => {
    const score = (tx: Tx, { match }: Built, data: object = {}) =>
      tx.memorabilityScore.create({
        data: {
          matchId: match.id,
          score: 87.5,
          signals: { stage: 0.9, drama: 0.8, footprint: 1 },
          algorithmVersion: 'v1',
          computedAt: T0,
          ...data,
        },
      });

    it('stores one score per match with its signal breakdown', async () => {
      const stored = await rolledBack(async (tx) =>
        score(tx, await buildMatch(tx)),
      );
      expect(stored.score).toBe(87.5);
      expect(stored.signals).toEqual({ stage: 0.9, drama: 0.8, footprint: 1 });
    });

    it('rejects a second score for the same match', async () => {
      await expect(
        rolledBack(async (tx) => {
          const built = await buildMatch(tx);
          await score(tx, built);
          await score(tx, built, { algorithmVersion: 'v2' });
        }),
      ).rejects.toMatchObject(
        violation('P2002', 'memorability_scores_match_id_key'),
      );
    });

    it.each([-0.1, 100.1, Number.NaN])(
      'rejects the score %d',
      async (value) => {
        await expect(
          rolledBack(async (tx) =>
            score(tx, await buildMatch(tx), { score: value }),
          ),
        ).rejects.toThrow('memorability_scores_score_check');
      },
    );

    it('rejects a blank algorithm version', async () => {
      await expect(
        rolledBack(async (tx) =>
          score(tx, await buildMatch(tx), { algorithmVersion: ' ' }),
        ),
      ).rejects.toThrow('memorability_scores_version_check');
    });

    it('refuses to delete a scored match', async () => {
      await expect(
        rolledBack(async (tx) => {
          const built = await buildMatch(tx);
          await score(tx, built);
          await tx.match.delete({ where: { id: built.match.id } });
        }),
      ).rejects.toMatchObject(
        violation('P2003', 'memorability_scores_match_id_fkey'),
      );
    });
  });

  describe('game_sessions', () => {
    const end = (mode: GameMode, data: Prisma.GameSessionUpdateInput) =>
      withSession(mode, (tx, { session }) =>
        tx.gameSession.update({ where: { id: session.id }, data }),
      );

    it.each([
      ['over without an end time', { status: 'over' as const }],
      ['an end time while active', { endedAt: at(30) }],
    ])('rejects %s', async (_, data) => {
      await expect(end('duel', data)).rejects.toThrow(
        'game_sessions_status_check',
      );
    });

    it.each([
      [
        'a finished solo run without a reason',
        'solo',
        { status: 'over' as const, endedAt: at(30) },
      ],
      [
        'a reason on an active solo run',
        'solo',
        { soloEndReason: 'quit' as const },
      ],
      [
        'a solo reason on a duel',
        'duel',
        {
          status: 'over' as const,
          endedAt: at(30),
          soloEndReason: 'quit' as const,
        },
      ],
    ] as const)('rejects %s', async (_, mode, data) => {
      await expect(end(mode, data)).rejects.toThrow(
        'game_sessions_end_reason_check',
      );
    });

    it('lets a solo run wait for its side', async () => {
      const session = await end('solo', { side: null });
      expect(session.side).toBeNull();
    });

    it('rejects a duel without a side', async () => {
      await expect(end('duel', { side: null })).rejects.toThrow(
        'game_sessions_side_check',
      );
    });

    it('rejects an end before the start', async () => {
      await expect(
        end('duel', { status: 'over', endedAt: at(-1) }),
      ).rejects.toThrow('game_sessions_time_check');
    });

    it('refuses to delete a match with a recorded game', async () => {
      await expect(
        withSession('solo', (tx, { built }) =>
          tx.match.delete({ where: { id: built.match.id } }),
        ),
      ).rejects.toMatchObject(
        violation('P2003', 'game_sessions_match_id_fkey'),
      );
    });
  });

  describe('game_participants', () => {
    it.each([
      ['4 lives', { livesRemaining: 4 }, 'game_participants_lives_check'],
      [
        'negative lives',
        { livesRemaining: -1 },
        'game_participants_lives_check',
      ],
      ['seat 2', { seat: 2 }, 'game_participants_seat_check'],
    ])('rejects %s', async (_, data, constraint) => {
      await expect(
        withSession('solo', (tx, { seats }) =>
          tx.gameParticipant.update({ where: { id: seats[0].id }, data }),
        ),
      ).rejects.toThrow(constraint);
    });

    it('rejects two players in one seat', async () => {
      await expect(
        withSession('duel', (tx, { seats }) =>
          tx.gameParticipant.update({
            where: { id: seats[1].id },
            data: { seat: 0 },
          }),
        ),
      ).rejects.toMatchObject(
        violation('P2002', 'game_participants_session_id_seat_key'),
      );
    });

    it('rejects one user playing themselves', async () => {
      await expect(
        withSession('duel', (tx, { seats }) =>
          tx.gameParticipant.update({
            where: { id: seats[1].id },
            data: { userId: seats[0].userId },
          }),
        ),
      ).rejects.toMatchObject(
        violation('P2002', 'game_participants_session_id_user_id_key'),
      );
    });
  });

  describe('game_rounds', () => {
    it.each([
      ['round 0', { number: 0 }, 'game_rounds_number_check'],
      ['a zero-length round', { endsAt: at(0) }, 'game_rounds_time_check'],
      [
        'an end before the start',
        { endedAt: at(-1), endReason: 'ended' as const },
        'game_rounds_time_check',
      ],
      [
        'an end time without a reason',
        { endedAt: at(15) },
        'game_rounds_end_check',
      ],
      [
        'a reason without an end time',
        { endReason: 'found' as const },
        'game_rounds_end_check',
      ],
    ])('rejects %s', async (_, data, constraint) => {
      await expect(
        withSession('solo', (tx, started) => round(tx, started, data)),
      ).rejects.toThrow(constraint);
    });

    it('accepts an end past ends_at (the grace window)', async () => {
      const ended = await withSession('solo', (tx, started) =>
        round(tx, started, { endedAt: at(15.4), endReason: 'found' }),
      );
      expect(ended.endedAt?.getTime()).toBe(at(15.4).getTime());
    });

    it('rejects a duplicate round number', async () => {
      await expect(
        withSession('solo', async (tx, started) => {
          await round(tx, started);
          await round(tx, started);
        }),
      ).rejects.toMatchObject(
        violation('P2002', 'game_rounds_session_id_number_key'),
      );
    });
  });

  describe('guesses', () => {
    const guess = (data: Partial<Prisma.GuessUncheckedCreateInput>) =>
      withSession('solo', async (tx, started) => {
        const { id } = await round(tx, started);
        return tx.guess.create({
          data: { roundId: id, text: 'Pirlo', outcome: 'not_in_xi', ...data },
        });
      });

    it.each([
      ['untrimmed', ' Pirlo'],
      ['empty', ''],
      ['65 characters', 'x'.repeat(65)],
    ])('rejects %s text', async (_, text) => {
      await expect(guess({ text })).rejects.toThrow('guesses_text_check');
    });

    it('accepts 64 characters', async () => {
      const stored = await guess({ text: 'x'.repeat(64) });
      expect(stored.text).toHaveLength(64);
    });

    it('rejects a correct guess with no player', async () => {
      await expect(guess({ outcome: 'correct_new' })).rejects.toThrow(
        'guesses_player_check',
      );
    });

    it('rejects a not_in_xi guess that names a player', async () => {
      await expect(
        withSession('solo', async (tx, started) => {
          const { id } = await round(tx, started);
          return tx.guess.create({
            data: {
              roundId: id,
              text: 'Player 1',
              outcome: 'not_in_xi',
              playerId: started.built.players[1].id,
            },
          });
        }),
      ).rejects.toThrow('guesses_player_check');
    });

    it('refuses to delete a player someone guessed', async () => {
      await expect(
        withSession('solo', async (tx, started) => {
          const benched = await tx.player.create({
            data: { slug: 'test-benched', name: 'Benched Player' },
          });
          const { id } = await round(tx, started);
          await tx.guess.create({
            data: {
              roundId: id,
              text: 'Benched',
              outcome: 'already_found',
              playerId: benched.id,
            },
          });
          await tx.player.delete({ where: { id: benched.id } });
        }),
      ).rejects.toMatchObject(violation('P2003', 'guesses_player_id_fkey'));
    });
  });

  describe('user_stats', () => {
    const stats = (data: Partial<Prisma.UserStatsUncheckedCreateInput>) =>
      rolledBack(async (tx) => {
        const [user] = await buildUsers(tx, 1);
        return tx.userStats.create({ data: { userId: user.id, ...data } });
      });

    it('accepts a best streak of 11', async () => {
      const created = await stats({ bestStreak: 11 });
      expect(created.bestStreak).toBe(11);
    });

    it('rejects a best streak above one XI', async () => {
      await expect(stats({ bestStreak: 12 })).rejects.toThrow(
        'user_stats_best_streak_check',
      );
    });

    it('starts every counter at zero', async () => {
      const created = await stats({});
      expect(created).toMatchObject({
        played: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        perfectClears: 0,
        bestStreak: 0,
        correctGuesses: 0,
        totalGuesses: 0,
        favouriteClubId: null,
      });
    });

    it.each([
      ['a negative counter', { bestStreak: -1 }, 'user_stats_counters_check'],
      [
        'more results than games',
        { played: 2, wins: 2, draws: 1 },
        'user_stats_results_check',
      ],
      [
        'more correct guesses than guesses',
        { correctGuesses: 5, totalGuesses: 4 },
        'user_stats_guesses_check',
      ],
    ])('rejects %s', async (_, data, constraint) => {
      await expect(stats(data)).rejects.toThrow(constraint);
    });

    it('forgets a favourite club that is deleted', async () => {
      const after = await rolledBack(async (tx) => {
        const club = await tx.club.create({
          data: {
            slug: 'test-fav',
            kind: 'club',
            name: 'Fav FC',
            shortName: 'FAV',
          },
        });
        const [user] = await buildUsers(tx, 1);
        await tx.userStats.create({
          data: { userId: user.id, favouriteClubId: club.id },
        });
        await tx.club.delete({ where: { id: club.id } });
        return tx.userStats.findUniqueOrThrow({
          where: { userId: user.id },
        });
      });
      expect(after.favouriteClubId).toBeNull();
    });
  });

  it('deletes a session’s players, rounds and guesses with it', async () => {
    const remaining = await withSession('duel', async (tx, started) => {
      const r = await round(tx, started);
      await tx.guess.create({
        data: { roundId: r.id, text: 'Pirlo', outcome: 'not_in_xi' },
      });
      await tx.gameSession.delete({ where: { id: started.session.id } });
      return {
        participants: await tx.gameParticipant.count({
          where: { sessionId: started.session.id },
        }),
        rounds: await tx.gameRound.count({
          where: { sessionId: started.session.id },
        }),
        guesses: await tx.guess.count({ where: { roundId: r.id } }),
      };
    });
    expect(remaining).toEqual({ participants: 0, rounds: 0, guesses: 0 });
  });
});
