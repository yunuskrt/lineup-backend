import { guessResultSchema } from '@/contract/round.js';
import { SQUAD } from '@/matches/squad.fixtures.js';
import { toGuessResult } from '@/matches/squad-views.js';

describe('toGuessResult', () => {
  it('carries the revealed player for a new correct name', () => {
    const result = toGuessResult(
      { kind: 'correct_new', playerId: 'p-delta' },
      SQUAD,
    );
    expect(guessResultSchema.parse(result)).toEqual(result);
    expect(result).toEqual({
      outcome: 'correct_new',
      player: SQUAD.players[3],
    });
  });

  it('carries only the id for a name already found', () => {
    const result = toGuessResult(
      { kind: 'already_found', playerId: 'p-delta' },
      SQUAD,
    );
    expect(result).toEqual({ outcome: 'already_found', playerId: 'p-delta' });
  });

  it('carries nothing for a name not in the XI', () => {
    const result = toGuessResult({ kind: 'not_in_xi' }, SQUAD);
    expect(result).toEqual({ outcome: 'not_in_xi' });
  });

  it('refuses an id outside the squad without naming it', () => {
    expect(() =>
      toGuessResult({ kind: 'correct_new', playerId: 'p-zulu' }, SQUAD),
    ).toThrow('A found player is missing from the squad');
  });
});
