import { classifyGuess, squadCollisions } from '@/game/collisions.js';
import type { SquadEntry } from '@/game/matcher.js';

// Aliases copied from the seeded fixtures
const NORTHGATE: SquadEntry[] = [
  { playerId: 'pl-gareth-pennock', aliases: ['gareth pennock', 'pennock'] },
  { playerId: 'pl-dean-harlow', aliases: ['dean harlow', 'harlow'] },
  { playerId: 'pl-kieran-moss', aliases: ['kieran moss', 'moss'] },
  { playerId: 'pl-rhys-harlow', aliases: ['rhys harlow', 'harlow'] },
  { playerId: 'pl-wes-tolland', aliases: ['wes tolland', 'tolland'] },
];

const CROWN_HOME: SquadEntry[] = [
  { playerId: 'pl-callum-price', aliases: ['callum price', 'price'] },
  { playerId: 'pl-tom-ellery', aliases: ['tom ellery', 'ellery'] },
];
const CROWN_AWAY: SquadEntry[] = [
  { playerId: 'pl-owen-price', aliases: ['owen price', 'price'] },
  { playerId: 'pl-kyle-dunmore', aliases: ['kyle dunmore', 'dunmore'] },
];

const DEAN = 'pl-dean-harlow';
const RHYS = 'pl-rhys-harlow';
const NOT_IN_XI = { kind: 'not_in_xi' };

describe('classifyGuess', () => {
  describe('a single match', () => {
    it('reveals a new player on an exact alias', () => {
      expect(classifyGuess('Moss', NORTHGATE, [])).toEqual({
        kind: 'correct_new',
        playerId: 'pl-kieran-moss',
      });
    });

    it('reveals a new player on a fuzzy alias', () => {
      expect(classifyGuess('Tollnd', NORTHGATE, [])).toEqual({
        kind: 'correct_new',
        playerId: 'pl-wes-tolland',
      });
    });

    it('reports an already found player', () => {
      expect(classifyGuess('Moss', NORTHGATE, ['pl-kieran-moss'])).toEqual({
        kind: 'already_found',
        playerId: 'pl-kieran-moss',
      });
    });

    it.each(['Zinedine Zidane', '', '!!!'])('misses %j', (guess) => {
      expect(classifyGuess(guess, NORTHGATE, [])).toEqual(NOT_IN_XI);
    });

    it('resolves a surname shared only with the opposing XI', () => {
      expect(classifyGuess('Price', CROWN_HOME, [])).toEqual({
        kind: 'correct_new',
        playerId: 'pl-callum-price',
      });
      expect(classifyGuess('Price', CROWN_AWAY, [])).toEqual({
        kind: 'correct_new',
        playerId: 'pl-owen-price',
      });
    });
  });

  describe('a surname shared inside the XI', () => {
    it('is not in the XI while both are unfound', () => {
      expect(classifyGuess('Harlow', NORTHGATE, [])).toEqual(NOT_IN_XI);
    });

    it.each([[[DEAN]], [[RHYS]]])(
      'never reveals the other one (found: %j)',
      (found) => {
        expect(classifyGuess('Harlow', NORTHGATE, found)).toEqual(NOT_IN_XI);
      },
    );

    it('is already found once both are found', () => {
      expect(classifyGuess('Harlow', NORTHGATE, [RHYS, DEAN])).toEqual({
        kind: 'already_found',
        playerId: DEAN,
      });
    });

    it('applies the same rule to a typo that ties', () => {
      expect(classifyGuess('Harlwo', NORTHGATE, [DEAN])).toEqual(NOT_IN_XI);
      expect(classifyGuess('Harlwo', NORTHGATE, [DEAN, RHYS])).toEqual({
        kind: 'already_found',
        playerId: DEAN,
      });
    });

    it('needs every one found when three share it', () => {
      const silvas = ['a', 'b', 'c'].map((id) => ({
        playerId: id,
        aliases: [`${id} silva`, 'silva'],
      }));
      expect(classifyGuess('Silva', silvas, ['a', 'c'])).toEqual(NOT_IN_XI);
      expect(classifyGuess('Silva', silvas, ['c', 'b', 'a'])).toEqual({
        kind: 'already_found',
        playerId: 'a',
      });
    });

    it('still reveals each one by full name', () => {
      expect(classifyGuess('Rhys Harlow', NORTHGATE, [DEAN])).toEqual({
        kind: 'correct_new',
        playerId: RHYS,
      });
      expect(classifyGuess('Dean Harlow', NORTHGATE, [])).toEqual({
        kind: 'correct_new',
        playerId: DEAN,
      });
    });
  });
});

describe('squadCollisions', () => {
  it('lists an alias held by two players, in squad order', () => {
    expect(squadCollisions(NORTHGATE)).toEqual([
      { alias: 'harlow', playerIds: [DEAN, RHYS] },
    ]);
  });

  it('lists each collision, three-way included', () => {
    const squad = [
      { playerId: 'a', aliases: ['silva', 'neville'] },
      { playerId: 'b', aliases: ['silva'] },
      { playerId: 'c', aliases: ['neville', 'silva'] },
    ];
    expect(squadCollisions(squad)).toEqual([
      { alias: 'silva', playerIds: ['a', 'b', 'c'] },
      { alias: 'neville', playerIds: ['a', 'c'] },
    ]);
  });

  it('is empty for a squad without collisions', () => {
    expect(squadCollisions(CROWN_HOME)).toEqual([]);
    expect(squadCollisions([])).toEqual([]);
  });

  it('counts a player once for a repeated alias', () => {
    const squad = [{ playerId: 'a', aliases: ['moss', 'moss'] }];
    expect(squadCollisions(squad)).toEqual([]);
  });
});
