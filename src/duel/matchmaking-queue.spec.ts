import { duelPlayer } from '@/contract/contract.fixtures.js';
import { MatchmakingQueue } from '@/duel/matchmaking-queue.js';

describe('MatchmakingQueue', () => {
  let queue: MatchmakingQueue;

  beforeEach(() => {
    queue = new MatchmakingQueue();
  });

  it('hands out the oldest waiting player first', () => {
    queue.enter(duelPlayer('a'), 1);
    queue.enter(duelPlayer('b'), 2);
    expect(queue.takeOpponent('z')).toEqual({
      player: duelPlayer('a'),
      since: 1,
    });
    expect(queue.takeOpponent('z')?.player.id).toBe('b');
  });

  it('removes the player it hands out', () => {
    queue.enter(duelPlayer('a'), 1);
    queue.takeOpponent('z');
    expect(queue.has('a')).toBe(false);
    expect(queue.takeOpponent('z')).toBeNull();
  });

  it('never pairs a player with themselves', () => {
    queue.enter(duelPlayer('a'), 1);
    expect(queue.takeOpponent('a')).toBeNull();
    expect(queue.has('a')).toBe(true);
  });

  it('skips the caller to reach the next in line', () => {
    queue.enter(duelPlayer('a'), 1);
    queue.enter(duelPlayer('b'), 2);
    expect(queue.takeOpponent('a')?.player.id).toBe('b');
    expect(queue.has('a')).toBe(true);
  });

  it('gives nothing from an empty queue', () => {
    expect(queue.takeOpponent('a')).toBeNull();
  });

  it('removes only the user who leaves', () => {
    queue.enter(duelPlayer('a'), 1);
    queue.enter(duelPlayer('b'), 2);
    expect(queue.leave('a')).toBe(true);
    expect(queue.has('a')).toBe(false);
    expect(queue.has('b')).toBe(true);
  });

  it('reports a leave by someone not waiting', () => {
    expect(queue.leave('a')).toBe(false);
  });
});
