import {
  GRACE_MS,
  RECONNECT_WINDOW_MS,
  ROUND_MS,
} from '@/contract/constants.js';
import type { DuelResult, DuelSession } from '@/contract/duel.js';
import type { DuelFoundPlayer } from '@/contract/player.js';
import { DUEL_PLAY_MESSAGES } from '@/duel/duel-messages.js';
import { type Client, DuelHarness } from '@test/duel/duel-harness.js';
import { nextEvent } from '@test/duel/socket-client.js';

const OK = { success: true, data: null };
const PAST_DEADLINE = ROUND_MS + GRACE_MS + 100;
// Far from any squad name
const MISS = 'Zzyzx Qwertyuiop';

type Player = Client;
type Duel = {
  a: Player;
  b: Player;
  sessionId: string;
  // The XI both name, in slot order
  names: string[];
  // Every player in the match, both sides
  everyone: string[];
};

const refused = (code: string, message: string) => ({
  success: false,
  error: { code, message, retryAfterMs: null },
});

describe('Duel round loop (e2e)', () => {
  let h: DuelHarness;

  const ack = (p: Player, event: string, ...args: unknown[]) =>
    h.ack(p, event, ...args);

  // A wins the flip, so B names first
  async function duel(): Promise<Duel> {
    const { a, b, sessionId, match } = await h.pair();
    const squad = await h.squadOf(match);
    const everyone = [...squad.names, ...squad.others];
    return { a, b, sessionId, names: squad.names, everyone };
  }

  const guess = (p: Player, d: Duel, text: string) =>
    ack(p, 'duel:guess', { sessionId: d.sessionId, guess: text });

  // Events since matchReady
  const playOf = (p: Player) => {
    const start = p.events.findIndex((e) => e.event === 'matchReady');
    return p.events.slice(start + 1);
  };
  const namesOf = (p: Player) => playOf(p).map((e) => e.event);
  const lastOf = <T>(p: Player, event: string) =>
    playOf(p)
      .filter((e) => e.event === event)
      .at(-1)?.payload as T;

  beforeAll(async () => {
    // The real window: no case drops a socket
    h = await DuelHarness.boot({
      filterWindowMs: 5_000,
      windowMs: RECONNECT_WINDOW_MS,
    });
  });

  beforeEach(() => h.resetClock());
  afterEach(() => h.settle());
  afterAll(() => h.close());

  describe('a guess', () => {
    it('reveals a correct name to both and hands over the turn', async () => {
      const d = await duel();
      const aRound = nextEvent<DuelSession>(d.a.socket, 'roundStarted');
      expect(await guess(d.b, d, d.names[0])).toEqual(OK);

      // The guesser's events arrive before the ack
      expect(namesOf(d.b)).toEqual([
        'guessResolved',
        'playerRevealed',
        'turnChanged',
        'roundStarted',
      ]);
      expect(lastOf(d.b, 'guessResolved')).toMatchObject({
        outcome: 'correct_new',
        player: { name: d.names[0] },
      });
      expect(lastOf(d.b, 'roundStarted')).toMatchObject({ turn: 'opponent' });

      expect((await aRound).turn).toBe('you');
      expect(namesOf(d.a)).toEqual([
        'playerRevealed',
        'turnChanged',
        'roundStarted',
      ]);
      expect(lastOf<DuelFoundPlayer>(d.a, 'playerRevealed')).toMatchObject({
        name: d.names[0],
        foundBy: 'opponent',
      });
    });

    it('answers a miss and an already-found name to the guesser only', async () => {
      const d = await duel();
      expect(await guess(d.b, d, MISS)).toEqual(OK);
      expect(lastOf(d.b, 'guessResolved')).toEqual({ outcome: 'not_in_xi' });

      const aRevealed = nextEvent(d.a.socket, 'roundStarted');
      await guess(d.b, d, d.names[0]);
      await aRevealed;
      // A saw nothing of B's miss
      expect(namesOf(d.a)[0]).toBe('playerRevealed');

      expect(await guess(d.a, d, d.names[0])).toEqual(OK);
      expect(lastOf(d.a, 'guessResolved')).toMatchObject({
        outcome: 'already_found',
      });
      expect(lastOf<DuelSession>(d.a, 'roundStarted').turn).toBe('you');
    });

    it('refuses a guess out of turn', async () => {
      const d = await duel();
      expect(await guess(d.a, d, d.names[0])).toEqual(
        refused('forbidden', DUEL_PLAY_MESSAGES.waitTurn),
      );
      expect(namesOf(d.a)).toEqual([]);
    });

    it('refuses a guess for another duel', async () => {
      const d = await duel();
      const result = await ack(d.b, 'duel:guess', {
        sessionId: 'not-this-duel',
        guess: d.names[0],
      });
      expect(result).toEqual(
        refused('invalid_input', DUEL_PLAY_MESSAGES.otherDuel),
      );
    });

    it('never sends the guess text or an unrevealed player', async () => {
      const d = await duel();
      await guess(d.b, d, MISS);
      const aRound = nextEvent(d.a.socket, 'roundStarted');
      await guess(d.b, d, d.names[0]);
      await aRound;

      const json = JSON.stringify([...d.a.events, ...d.b.events]);
      expect(json).not.toContain(MISS);
      for (const name of d.everyone.filter((n) => n !== d.names[0])) {
        expect(json).not.toContain(name);
      }
    });
  });

  describe('the clock', () => {
    it('costs the player on turn a life once the round runs out', async () => {
      const d = await duel();
      const aRound = nextEvent<DuelSession>(d.a.socket, 'roundStarted');
      h.skew(PAST_DEADLINE);

      // Any input catches the clock up first
      expect(await guess(d.a, d, d.names[0])).toEqual(
        refused('session_over', DUEL_PLAY_MESSAGES.roundOver),
      );
      expect(namesOf(d.a)).toEqual(['lifeLost', 'turnChanged', 'roundStarted']);
      expect(lastOf(d.a, 'lifeLost')).toEqual({ who: 'opponent', lives: 2 });
      expect(await aRound).toMatchObject({
        turn: 'you',
        opponent: { lives: 2 },
      });
      await vi.waitFor(() =>
        expect(lastOf(d.b, 'lifeLost')).toEqual({ who: 'you', lives: 2 }),
      );
    });

    it(
      'fires by itself when nobody sends anything',
      async () => {
        const d = await duel();
        const round = nextEvent<DuelSession>(d.b.socket, 'roundStarted');
        expect(await round).toMatchObject({
          turn: 'opponent',
          you: { lives: 2 },
        });
        expect(namesOf(d.b)).toEqual([
          'lifeLost',
          'turnChanged',
          'roundStarted',
        ]);
        expect(lastOf(d.b, 'lifeLost')).toEqual({ who: 'you', lives: 2 });
      },
      ROUND_MS + 15_000,
    );
  });

  describe('the end', () => {
    it('runs a player out of lives: loss and win', async () => {
      const d = await duel();
      const finished = nextEvent<DuelResult>(d.a.socket, 'finished');
      for (const name of d.names.slice(0, 2)) {
        // B times out, then A names one
        h.skew(PAST_DEADLINE);
        await guess(d.a, d, MISS);
        expect(await guess(d.a, d, name)).toEqual(OK);
      }
      h.skew(PAST_DEADLINE);
      expect(await guess(d.a, d, MISS)).toEqual(
        refused('session_over', DUEL_PLAY_MESSAGES.notRunning),
      );

      expect(await finished).toMatchObject({
        outcome: 'win',
        isForfeit: false,
        you: { lives: 3 },
        opponent: { lives: 0 },
      });
      await vi.waitFor(() =>
        expect(lastOf(d.b, 'finished')).toMatchObject({ outcome: 'loss' }),
      );
      expect(await ack(d.a, 'queue:enter')).toEqual(OK);
    });

    it('ends in a draw once all 11 are named', async () => {
      const d = await duel();
      const finished = nextEvent<DuelResult>(d.a.socket, 'finished');
      for (const [index, name] of d.names.entries()) {
        // B started, so B names the even slots
        const p = index % 2 === 0 ? d.b : d.a;
        expect(await guess(p, d, name)).toEqual(OK);
      }

      const result = await finished;
      expect(result).toMatchObject({ outcome: 'draw', isForfeit: false });
      expect(result.found).toHaveLength(11);
      expect(lastOf(d.b, 'finished')).toMatchObject({ outcome: 'draw' });
      expect(namesOf(d.b).slice(-3)).toEqual([
        'guessResolved',
        'playerRevealed',
        'finished',
      ]);
    });

    it('forfeits: loss for the forfeiter, forfeit_win for the other', async () => {
      const d = await duel();
      const finished = nextEvent<DuelResult>(d.b.socket, 'finished');
      expect(await ack(d.a, 'duel:forfeit')).toEqual(OK);

      expect(lastOf(d.a, 'finished')).toMatchObject({
        outcome: 'loss',
        isForfeit: true,
      });
      expect(await finished).toMatchObject({
        outcome: 'forfeit_win',
        isForfeit: true,
      });
      expect(await ack(d.a, 'duel:forfeit')).toEqual(
        refused('forbidden', DUEL_PLAY_MESSAGES.noDuel),
      );
    });
  });
});
