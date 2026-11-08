import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@/contract/constants.js';

// An index below `size`, uniformly drawn
export type Pick = (size: number) => number;

// A secure source: a code can't be predicted (D1)
export const SECURE_PICK: Pick = (size) => randomInt(size);

// Redraws until no open room holds the code
export function newRoomCode(
  isTaken: (code: string) => boolean,
  pick: Pick,
): string {
  for (;;) {
    const code = Array.from(
      { length: ROOM_CODE_LENGTH },
      () => ROOM_CODE_ALPHABET[pick(ROOM_CODE_ALPHABET.length)],
    ).join('');
    if (!isTaken(code)) return code;
  }
}
