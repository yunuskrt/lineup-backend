import { duelPlayer } from '@/contract/contract.fixtures.js';
import { DuelRooms } from '@/duel/duel-rooms.js';

describe('DuelRooms', () => {
  let rooms: DuelRooms;

  beforeEach(() => {
    rooms = new DuelRooms();
  });

  it('opens one room for both players', () => {
    const room = rooms.open(duelPlayer('a'), duelPlayer('b'), 5);
    expect(room).toEqual({
      id: expect.any(String),
      players: [duelPlayer('a'), duelPlayer('b')],
      pairedAt: 5,
    });
    expect(rooms.roomOf('a')).toBe(room);
    expect(rooms.roomOf('b')).toBe(room);
  });

  it('gives every room its own id', () => {
    const first = rooms.open(duelPlayer('a'), duelPlayer('b'), 0);
    const second = rooms.open(duelPlayer('c'), duelPlayer('d'), 0);
    expect(first.id).not.toBe(second.id);
    expect(rooms.roomOf('c')).toBe(second);
  });

  it('frees both players on close', () => {
    const room = rooms.open(duelPlayer('a'), duelPlayer('b'), 0);
    rooms.close(room.id);
    expect(rooms.roomOf('a')).toBeNull();
    expect(rooms.roomOf('b')).toBeNull();
  });

  it('leaves other rooms open on close', () => {
    const room = rooms.open(duelPlayer('a'), duelPlayer('b'), 0);
    const other = rooms.open(duelPlayer('c'), duelPlayer('d'), 0);
    rooms.close(room.id);
    expect(rooms.roomOf('c')).toBe(other);
  });

  it('ignores closing an unknown room', () => {
    expect(() => rooms.close('nope')).not.toThrow();
  });

  it('knows no room for a user who was never paired', () => {
    expect(rooms.roomOf('a')).toBeNull();
  });
});
