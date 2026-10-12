import {
  FUZZY_THRESHOLD,
  type MatchResolution,
  resolveGuess,
  similarity,
  type SquadEntry,
} from '@/game/matcher.js';

// Aliases copied from the seeded fixtures
const NORTHGATE: SquadEntry[] = [
  { playerId: 'pl-gareth-pennock', aliases: ['gareth pennock', 'pennock'] },
  { playerId: 'pl-dean-harlow', aliases: ['dean harlow', 'harlow'] },
  { playerId: 'pl-stuart-fenwick', aliases: ['stuart fenwick', 'fenwick'] },
  {
    playerId: 'pl-ciaran-odonovan',
    aliases: ['ciaran odonovan', 'odonovan', 'o donovan'],
  },
  { playerId: 'pl-rhys-harlow', aliases: ['rhys harlow', 'harlow'] },
  { playerId: 'pl-liam-ashworth', aliases: ['liam ashworth', 'ashworth'] },
  {
    playerId: 'pl-jasper-van-der-linde',
    aliases: ['jasper van der linde', 'van der linde', 'linde'],
  },
  { playerId: 'pl-kieran-moss', aliases: ['kieran moss', 'moss'] },
  {
    playerId: 'pl-kofi-addo-mensah',
    aliases: ['kofi addo mensah', 'addo mensah'],
  },
  { playerId: 'pl-wes-tolland', aliases: ['wes tolland', 'tolland'] },
  { playerId: 'pl-brandon-keele', aliases: ['brandon keele', 'keele'] },
];

const YILDIRIMSPOR: SquadEntry[] = [
  { playerId: 'pl-kerem-sahin', aliases: ['kerem sahin', 'sahin'] },
  { playerId: 'pl-ilker-dogancay', aliases: ['ilker dogancay', 'dogancay'] },
  { playerId: 'pl-baris-kilic', aliases: ['baris kilic', 'kilic'] },
  { playerId: 'pl-oguzhan-simsek', aliases: ['oguzhan simsek', 'simsek'] },
];

const OSTRENIA: SquadEntry[] = [
  { playerId: 'pl-jakub-cerny', aliases: ['jakub cerny', 'cerny'] },
  { playerId: 'pl-lukasz-wrobel', aliases: ['lukasz wrobel', 'wrobel'] },
  { playerId: 'pl-ondrej-vlcek', aliases: ['ondrej vlcek', 'vlcek'] },
];

const SOLVARA: SquadEntry[] = [
  {
    playerId: 'pl-francisco-belmonte',
    aliases: ['francisco belmonte', 'belmonte', 'kiko'],
  },
  { playerId: 'pl-tavinho', aliases: ['tavinho', 'otavio ramalho', 'ramalho'] },
  { playerId: 'pl-jonas-friedl', aliases: ['jonas friedl', 'friedl'] },
];

// match-crown-2015: one Price per side
const CROWN_HOME: SquadEntry[] = [
  { playerId: 'pl-callum-price', aliases: ['callum price', 'price'] },
  { playerId: 'pl-tom-ellery', aliases: ['tom ellery', 'ellery'] },
];
const CROWN_AWAY: SquadEntry[] = [
  { playerId: 'pl-owen-price', aliases: ['owen price', 'price'] },
  { playerId: 'pl-kyle-dunmore', aliases: ['kyle dunmore', 'dunmore'] },
];

const HARLOWS = ['pl-dean-harlow', 'pl-rhys-harlow'];

function hitId(guess: string, squad: SquadEntry[] = NORTHGATE): string | null {
  const result = resolveGuess(guess, squad);
  return result.kind === 'hit' ? result.playerId : null;
}

function ambiguousIds(result: MatchResolution): string[] | null {
  return result.kind === 'ambiguous' ? [...result.playerIds].sort() : null;
}

describe('resolveGuess', () => {
  // Ported from the web mock's matcher.test.ts
  it('resolves a full name and a bare surname', () => {
    expect(hitId('Kieran Moss')).toBe('pl-kieran-moss');
    expect(hitId('Moss')).toBe('pl-kieran-moss');
  });

  it('resolves a nickname and a mononym', () => {
    expect(hitId('Kiko', SOLVARA)).toBe('pl-francisco-belmonte');
    expect(hitId('Tavinho', SOLVARA)).toBe('pl-tavinho');
  });

  it('ignores case, accents and surrounding whitespace', () => {
    expect(hitId('  kerem şahin ', YILDIRIMSPOR)).toBe('pl-kerem-sahin');
    expect(hitId('İLKER DOĞANÇAY', YILDIRIMSPOR)).toBe('pl-ilker-dogancay');
    expect(hitId('Kılıç', YILDIRIMSPOR)).toBe('pl-baris-kilic');
    expect(hitId('Černý', OSTRENIA)).toBe('pl-jakub-cerny');
    expect(hitId('Łukasz Wróbel', OSTRENIA)).toBe('pl-lukasz-wrobel');
  });

  it('refuses a bare surname shared by two players in the XI', () => {
    expect(ambiguousIds(resolveGuess('Harlow', NORTHGATE))).toEqual(HARLOWS);
  });

  it('refuses a typo that ties across the same collision', () => {
    expect(ambiguousIds(resolveGuess('Harlwo', NORTHGATE))).toEqual(HARLOWS);
  });

  it('resolves the collision once the first name settles it', () => {
    expect(hitId('Dean Harlow')).toBe('pl-dean-harlow');
    expect(hitId('Rhys Harlow')).toBe('pl-rhys-harlow');
  });

  it('resolves a surname shared only with the opposing XI', () => {
    expect(hitId('Price', CROWN_HOME)).toBe('pl-callum-price');
    expect(hitId('Price', CROWN_AWAY)).toBe('pl-owen-price');
  });

  it.each(['Zinedine Zidane', '', '!!!'])('misses %j', (guess) => {
    expect(resolveGuess(guess, NORTHGATE)).toEqual({ kind: 'miss' });
  });

  it.each([
    ['a swapped pair', 'Pennokc', 'pl-gareth-pennock'],
    ['a dropped letter', 'Tollnd', 'pl-wes-tolland'],
    ['a swapped pair at the end', 'Fenwikc', 'pl-stuart-fenwick'],
  ])('accepts %s (%s)', (_, guess, playerId) => {
    expect(hitId(guess)).toBe(playerId);
  });

  it('never resolves Ronaldo to Ronaldinho', () => {
    const squad = [{ playerId: 'x-1', aliases: ['ronaldinho'] }];
    expect(resolveGuess('Ronaldo', squad)).toEqual({ kind: 'miss' });
    expect(similarity('ronaldo', 'ronaldinho')).toBeLessThan(FUZZY_THRESHOLD);
  });

  // Added in B28
  it('keeps Xavi and Xabi apart, both ways', () => {
    const xavi = [{ playerId: 'xavi', aliases: ['xavi', 'xavi hernandez'] }];
    const xabi = [{ playerId: 'xabi', aliases: ['xabi', 'xabi alonso'] }];
    expect(resolveGuess('Xabi', xavi)).toEqual({ kind: 'miss' });
    expect(resolveGuess('Xavi', xabi)).toEqual({ kind: 'miss' });
  });

  it('prefers an exact alias over a fuzzy neighbour', () => {
    const squad = [
      { playerId: 'a', aliases: ['pennock'] },
      { playerId: 'b', aliases: ['pennoch'] },
    ];
    expect(resolveGuess('Pennock', squad)).toEqual({
      kind: 'hit',
      playerId: 'a',
    });
  });

  it('keeps an exact collision ambiguous despite a fuzzy single', () => {
    const squad = [
      { playerId: 'a', aliases: ['harlow'] },
      { playerId: 'b', aliases: ['harlow'] },
      { playerId: 'c', aliases: ['harlowe'] },
    ];
    expect(ambiguousIds(resolveGuess('Harlow', squad))).toEqual(['a', 'b']);
  });

  it('misses a non-Latin guess without scoring it', () => {
    expect(resolveGuess('Аршавин', NORTHGATE)).toEqual({ kind: 'miss' });
  });

  it('misses against an empty squad', () => {
    expect(resolveGuess('Moss', [])).toEqual({ kind: 'miss' });
  });

  it('hits exactly when similarity clears the threshold', () => {
    const alias = 'a'.repeat(50);
    const squad = [{ playerId: 'p', aliases: [alias] }];
    for (let edits = 5; edits <= 12; edits += 1) {
      const guess = 'a'.repeat(50 - edits) + 'b'.repeat(edits);
      const clears = similarity(guess, alias) > FUZZY_THRESHOLD;
      expect(resolveGuess(guess, squad).kind).toBe(clears ? 'hit' : 'miss');
    }
  });
});

describe('similarity', () => {
  it('is 1 for equal strings, including two empty ones', () => {
    expect(similarity('moss', 'moss')).toBe(1);
    expect(similarity('', '')).toBe(1);
  });

  it('is 0 against an empty string', () => {
    expect(similarity('moss', '')).toBe(0);
    expect(similarity('', 'moss')).toBe(0);
  });

  it.each([
    ['ronaldo', 'ronaldinho'],
    ['pennokc', 'pennock'],
    ['xavi', 'xabi'],
  ])('is symmetric for %s and %s', (a, b) => {
    expect(similarity(a, b)).toBe(similarity(b, a));
  });

  it('counts a swapped pair as one edit', () => {
    expect(similarity('pennokc', 'pennock')).toBeCloseTo(1 - 1 / 7);
  });

  it.each<[string, string, number]>([
    ['ronaldo', 'ronaldinho', 0.7],
    ['harlwo', 'harlow', 1 - 1 / 6],
    ['tollnd', 'tolland', 1 - 1 / 7],
    ['xavi', 'xabi', 0.75],
  ])('scores %s / %s at %d', (a, b, score) => {
    expect(similarity(a, b)).toBeCloseTo(score);
  });
});
