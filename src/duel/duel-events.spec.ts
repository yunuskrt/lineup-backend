import { duelEventSchemas } from '@/contract/duel.js';
import { GRACE_MS, ROUND_MS } from '@/contract/constants.js';
import { applyTimed, type TimedInput } from '@/game/timed-game.js';
import { eventsFor, type Outbound } from '@/duel/duel-events.js';
import type { PlayingRoom } from '@/duel/duel-room.js';
import { playingRoom, T0 } from '@/duel/duel.fixtures.js';
import { NAMES } from '@/matches/squad.fixtures.js';

const DEADLINE = ROUND_MS + GRACE_MS;

function step(room: PlayingRoom, input: TimedInput, at: number) {
  const next = applyTimed(room.timed, input, at);
  return {
    events: eventsFor(room, next.effects),
    after: { ...room, timed: next.timed } as PlayingRoom,
  };
}

const guess = (seat: 0 | 1, text: string): TimedInput => ({
  kind: 'guess',
  seat,
  text,
});

const namesOf = (events: Outbound[], seat: 0 | 1) =>
  events.filter((e) => e.seat === seat).map((e) => e.event);

const payloadOf = (events: Outbound[], seat: 0 | 1, event: string) =>
  events.find((e) => e.seat === seat && e.event === event)?.payload;

function expectContract(events: Outbound[]) {
  for (const { event, payload } of events) {
    expect(duelEventSchemas[event].safeParse(payload).success, event).toBe(
      true,
    );
  }
}

describe('eventsFor', () => {
  it('orders a correct new name, guesser first', () => {
    const { events } = step(playingRoom(0), guess(0, 'alfa'), T0 + 1_000);
    expect(namesOf(events, 0)).toEqual([
      'guessResolved',
      'playerRevealed',
      'turnChanged',
      'roundStarted',
    ]);
    expect(namesOf(events, 1)).toEqual([
      'playerRevealed',
      'turnChanged',
      'roundStarted',
    ]);
    expectContract(events);
  });

  it('shows the reveal and the handover from each seat', () => {
    const { events } = step(playingRoom(0), guess(0, 'alfa'), T0 + 1_000);
    expect(payloadOf(events, 0, 'playerRevealed')).toMatchObject({
      id: 'p-alfa',
      foundBy: 'you',
    });
    expect(payloadOf(events, 1, 'playerRevealed')).toMatchObject({
      foundBy: 'opponent',
    });
    expect(payloadOf(events, 0, 'roundStarted')).toMatchObject({
      turn: 'opponent',
      round: { startedAt: T0 + 1_000, endsAt: T0 + 1_000 + ROUND_MS },
      found: [{ id: 'p-alfa', foundBy: 'you' }],
    });
    expect(payloadOf(events, 1, 'turnChanged')).toEqual(
      payloadOf(events, 1, 'roundStarted'),
    );
  });

  it.each(['zulu', 'Secret alfa'])(
    'answers a miss (%s) to the guesser only',
    (text) => {
      const { events } = step(playingRoom(0), guess(0, text), T0 + 1_000);
      expect(events).toEqual([
        {
          seat: 0,
          event: 'guessResolved',
          payload: { outcome: 'not_in_xi' },
        },
      ]);
    },
  );

  it('answers an already-found name to the guesser only', () => {
    const first = step(playingRoom(0), guess(0, 'alfa'), T0 + 1_000);
    const { events } = step(first.after, guess(1, 'alfa'), T0 + 2_000);
    expect(events).toEqual([
      {
        seat: 1,
        event: 'guessResolved',
        payload: { outcome: 'already_found', playerId: 'p-alfa' },
      },
    ]);
  });

  it('never carries the guess text', () => {
    const { events } = step(playingRoom(0), guess(0, 'zulu'), T0 + 1_000);
    expect(JSON.stringify(events)).not.toContain('zulu');
  });

  it('orders an expiry: life lost, handover, new round', () => {
    const { events } = step(
      playingRoom(0),
      { kind: 'tick' },
      T0 + DEADLINE + 1,
    );
    expect(namesOf(events, 1)).toEqual([
      'lifeLost',
      'turnChanged',
      'roundStarted',
    ]);
    expect(payloadOf(events, 0, 'lifeLost')).toEqual({ who: 'you', lives: 2 });
    expect(payloadOf(events, 1, 'lifeLost')).toEqual({
      who: 'opponent',
      lives: 2,
    });
    expect(payloadOf(events, 1, 'roundStarted')).toMatchObject({
      turn: 'you',
      opponent: { id: 'a', lives: 2 },
      round: { startedAt: T0 + DEADLINE },
    });
    expectContract(events);
  });

  it('shows each expiry of a catch-up at its own moment', () => {
    const late = T0 + DEADLINE * 2 + 10;
    const { events } = step(playingRoom(0), { kind: 'tick' }, late);
    const started = events.filter(
      (e) => e.seat === 0 && e.event === 'roundStarted',
    );
    expect(started.map((e) => e.payload)).toMatchObject([
      { turn: 'opponent', you: { lives: 2 }, opponent: { lives: 3 } },
      { turn: 'you', you: { lives: 2 }, opponent: { lives: 2 } },
    ]);
    expect(namesOf(events, 0)).toEqual([
      'lifeLost',
      'turnChanged',
      'roundStarted',
      'lifeLost',
      'turnChanged',
      'roundStarted',
    ]);
  });

  it('ends on the last life with loss and win', () => {
    let room = playingRoom(0);
    let at = T0;
    // Seat 0 times out; seat 1 names one in between
    for (const name of ['alfa', 'bravo']) {
      at += DEADLINE + 1;
      room = step(room, { kind: 'tick' }, at).after;
      room = step(room, guess(1, name), at).after;
    }
    const { events } = step(room, { kind: 'tick' }, at + DEADLINE + 1);

    expect(namesOf(events, 0)).toEqual(['lifeLost', 'finished']);
    expect(payloadOf(events, 0, 'finished')).toMatchObject({
      outcome: 'loss',
      isForfeit: false,
      you: { lives: 0 },
      opponent: { lives: 3 },
    });
    expect(payloadOf(events, 1, 'finished')).toMatchObject({ outcome: 'win' });
    expectContract(events);
  });

  it('ends on the 11th name with a draw for both', () => {
    let room = playingRoom(0);
    let events: Outbound[] = [];
    NAMES.forEach((name, index) => {
      const seat = (index % 2) as 0 | 1;
      ({ events, after: room } = step(room, guess(seat, name), T0 + index));
    });

    expect(namesOf(events, 0)).toEqual([
      'guessResolved',
      'playerRevealed',
      'finished',
    ]);
    expect(payloadOf(events, 1, 'finished')).toMatchObject({
      outcome: 'draw',
      isForfeit: false,
    });
    const result = payloadOf(events, 1, 'finished') as { found: unknown[] };
    expect(result.found).toHaveLength(11);
    expectContract(events);
  });

  it('ends a forfeit with loss and forfeit_win', () => {
    const { events } = step(
      playingRoom(0),
      { kind: 'forfeit', seat: 1 },
      T0 + 500,
    );
    expect(events.map((e) => e.event)).toEqual(['finished', 'finished']);
    expect(payloadOf(events, 1, 'finished')).toMatchObject({
      outcome: 'loss',
      isForfeit: true,
    });
    expect(payloadOf(events, 0, 'finished')).toMatchObject({
      outcome: 'forfeit_win',
      isForfeit: true,
    });
  });

  it('emits nothing for a step with no effects', () => {
    expect(eventsFor(playingRoom(0), [])).toEqual([]);
  });
});
