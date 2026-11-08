import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@/contract/constants.js';
import { roomCodeSchema } from '@/contract/duel.js';
import { newRoomCode, SECURE_PICK } from '@/duel/room-code.js';

const never = () => false;

// Picks the given indexes in turn
const scripted = (indexes: number[]) => {
  let at = 0;
  return () => indexes[at++ % indexes.length] ?? 0;
};

describe('ROOM_CODE_ALPHABET', () => {
  it('has 31 characters and none that look alike', () => {
    expect(ROOM_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(31);
    for (const lookAlike of ['0', 'O', '1', 'I', 'L']) {
      expect(ROOM_CODE_ALPHABET).not.toContain(lookAlike);
    }
  });
});

describe('newRoomCode', () => {
  it('draws 6 characters of the alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = newRoomCode(never, SECURE_PICK);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(roomCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  it('maps each pick to its character', () => {
    expect(newRoomCode(never, scripted([0, 1, 2, 28, 29, 30]))).toBe('ABC789');
  });

  it('redraws a code an open room holds', () => {
    const taken = new Set(['AAAAAA']);
    const pick = scripted([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]);
    expect(newRoomCode((code) => taken.has(code), pick)).toBe('BBBBBB');
  });
});

describe('roomCodeSchema', () => {
  it('uppercases before it checks', () => {
    expect(roomCodeSchema.parse('k7qm2x')).toBe('K7QM2X');
  });

  it.each(['K7QM2', 'K7QM2XA', 'K7QM2O', 'K7QM2I', 'K7-QM2', ''])(
    'refuses %j',
    (code) => {
      expect(roomCodeSchema.safeParse(code).success).toBe(false);
    },
  );
});
