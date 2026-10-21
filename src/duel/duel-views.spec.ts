import { duelPlayer } from '@/contract/contract.fixtures.js';
import {
  coinFlipResultSchema,
  duelResultSchema,
  duelSessionSchema,
  filterSubmissionSchema,
} from '@/contract/duel.js';
import { NO_PREFERENCE } from '@/game/coin-flip.js';
import { applyTimed, createTimedGame } from '@/game/timed-game.js';
import type { FlippingRoom, PlayingRoom } from '@/duel/duel-room.js';
import {
  toCoinFlip,
  toDuelResult,
  toDuelSession,
  toFilterSubmission,
  toLifeLost,
} from '@/duel/duel-views.js';
import { IDENTITY, NAMES, SQUAD } from '@/matches/squad.fixtures.js';

const T0 = 1_000_000;
const PLAYERS = [duelPlayer('a'), duelPlayer('b')] as const;

const flipping: FlippingRoom = {
  id: 'room-1',
  players: PLAYERS,
  pairedAt: T0,
  phase: 'flipping',
  flip: { winner: 0, filters: NO_PREFERENCE },
};

// Seat 1 starts; seat 1 names alfa
function playing(): PlayingRoom {
  const start = createTimedGame(
    { mode: 'duel', squad: SQUAD.entries, firstSeat: 1 },
    T0,
  );
  const step = applyTimed(start, { kind: 'guess', seat: 1, text: 'alfa' }, T0);
  return {
    ...flipping,
    phase: 'playing',
    match: IDENTITY,
    side: 'away',
    squad: SQUAD,
    timed: step.timed,
    firstRound: start.round!,
    effects: step.effects,
    away: [null, null],
  };
}

describe('toFilterSubmission', () => {
  it("shows each player their own seat as 'yours'", () => {
    const submissions = [NO_PREFERENCE, null] as const;
    expect(toFilterSubmission(submissions, 0)).toEqual({
      yours: 'submitted',
      theirs: 'pending',
    });
    expect(toFilterSubmission(submissions, 1)).toEqual({
      yours: 'pending',
      theirs: 'submitted',
    });
    expect(
      filterSubmissionSchema.safeParse(toFilterSubmission(submissions, 1))
        .success,
    ).toBe(true);
  });
});

describe('toCoinFlip', () => {
  it('tells the winner they won and the loser they lost', () => {
    expect(toCoinFlip(flipping, 0)).toEqual({
      winner: 'you',
      filters: NO_PREFERENCE,
    });
    expect(toCoinFlip(flipping, 1).winner).toBe('opponent');
    expect(
      coinFlipResultSchema.safeParse(toCoinFlip(flipping, 1)).success,
    ).toBe(true);
  });
});

describe('toDuelSession', () => {
  it('shows one moment to both seats with the actors swapped', () => {
    const room = playing();
    const forA = toDuelSession(room, 0);
    const forB = toDuelSession(room, 1);

    expect(duelSessionSchema.parse(forA)).toEqual(forA);
    expect(forA.sessionId).toBe('room-1');
    expect(forB.sessionId).toBe(forA.sessionId);
    expect(forB.match).toEqual(forA.match);
    expect(forB.round).toEqual(forA.round);
    expect(forA.you).toEqual(forB.opponent);
    expect(forA.opponent).toEqual(forB.you);
  });

  it("turns seats into the receiver's you and opponent", () => {
    const room = playing();
    // Seat 1 found alfa, so the turn is seat 0's
    expect(toDuelSession(room, 0)).toMatchObject({
      you: { id: 'a', lives: 3 },
      opponent: { id: 'b', lives: 3 },
      turn: 'you',
      found: [{ id: 'p-alfa', foundBy: 'opponent' }],
    });
    expect(toDuelSession(room, 1)).toMatchObject({
      turn: 'opponent',
      found: [{ id: 'p-alfa', foundBy: 'you' }],
    });
  });

  it('shows the shared XI the server picked', () => {
    expect(toDuelSession(playing(), 0).match).toMatchObject({
      id: IDENTITY.id,
      side: 'away',
      formation: '4-4-2',
    });
  });

  it('holds no player who has not been found', () => {
    const json = JSON.stringify(toDuelSession(playing(), 0));
    for (const name of NAMES.slice(1)) {
      expect(json).not.toContain(name);
    }
  });

  it('refuses a room with no live round', () => {
    const room = playing();
    const over = { ...room, timed: { ...room.timed, round: null } };
    expect(() => toDuelSession(over, 0)).toThrow('no live round');
  });
});

describe('toDuelResult', () => {
  const duel = (
    outcomes: readonly [
      'win' | 'loss' | 'draw' | 'forfeit_win',
      'win' | 'loss' | 'draw' | 'forfeit_win',
    ],
    isForfeit = false,
  ) => ({ mode: 'duel' as const, outcomes, isForfeit });

  it.each([
    ['a win and a loss', duel(['win', 'loss'])],
    ['a draw', duel(['draw', 'draw'])],
    ['a forfeit', duel(['forfeit_win', 'loss'], true)],
  ])('shows %s from each seat', (_, result) => {
    const room = playing();
    const forA = toDuelResult(room, result, 0);
    const forB = toDuelResult(room, result, 1);

    expect(duelResultSchema.parse(forA)).toEqual(forA);
    expect(forA.outcome).toBe(result.outcomes[0]);
    expect(forB.outcome).toBe(result.outcomes[1]);
    expect(forA.isForfeit).toBe(result.isForfeit);
    expect(forA.you).toEqual(forB.opponent);
    expect(forA.match).toEqual(IDENTITY);
    expect(forA.found).toMatchObject([{ id: 'p-alfa', foundBy: 'opponent' }]);
    expect(forB.found).toMatchObject([{ id: 'p-alfa', foundBy: 'you' }]);
  });

  it('refuses a solo result', () => {
    const solo = {
      mode: 'solo' as const,
      endReason: 'quit' as const,
      livesRemaining: 3,
    };
    expect(() => toDuelResult(playing(), solo, 0)).toThrow('Not a duel');
  });
});

describe('toLifeLost', () => {
  it('names who lost it from each seat', () => {
    expect(toLifeLost({ seat: 1, lives: 2 }, 1)).toEqual({
      who: 'you',
      lives: 2,
    });
    expect(toLifeLost({ seat: 1, lives: 2 }, 0)).toEqual({
      who: 'opponent',
      lives: 2,
    });
  });
});
