import {
  type ArchiveEntry,
  archivePage,
  archiveWords,
  decodeCursor,
  encodeCursor,
  newestFirst,
  toArchiveEntry,
} from '@/catalog/archive.js';
import type { ArchiveQuery } from '@/contract/catalog.js';
import type { ClubRef, MatchIdentity } from '@/contract/match.js';

const club = (id: string, name: string, shortName: string): ClubRef => ({
  id,
  name,
  shortName,
  crestUrl: null,
});

const MILAN = club('milan', 'AC Milan', 'MIL');
const LIVERPOOL = club('liv', 'Liverpool', 'LIV');
const ATLETICO = club('atm', 'Atlético Madrid', 'ATM');
const GALATASARAY = club('gs', 'Galatasaray', 'GAL');
const FENER = club('fb', 'Fenerbahçe', 'FB');
const INTER = club('int', 'Inter', 'INT');

function identity(
  id: string,
  date: string,
  home: ClubRef,
  away: ClubRef,
  extra: Partial<MatchIdentity> = {},
): MatchIdentity {
  return {
    id,
    competition: {
      id: 'ucl',
      kind: 'ucl',
      name: 'Champions League',
      logoUrl: null,
    },
    season: `${date.slice(0, 4)}`,
    date,
    stage: null,
    home,
    away,
    score: { home: 1, away: 1 },
    nickname: null,
    ...extra,
  };
}

const ALIASES = new Map([['milan', ['Rossoneri']]]);

const entry = (
  match: MatchIdentity,
  seasonStart: number,
  aliases: ReadonlyMap<string, readonly string[]> = ALIASES,
): ArchiveEntry => toArchiveEntry({ identity: match, seasonStart, aliases });

const ISTANBUL = entry(
  identity('m-istanbul', '2005-05-25', MILAN, LIVERPOOL, {
    season: '2004-05',
    nickname: 'Miracle of Istanbul',
  }),
  2004,
);
const DERBY = entry(
  identity('m-derby', '2013-10-20', GALATASARAY, FENER, {
    competition: { id: 'sl', kind: 'league', name: 'Süper Lig', logoUrl: null },
    season: '2013-14',
  }),
  2013,
);
const MADRID = entry(
  identity('m-madrid', '2014-05-24', ATLETICO, MILAN, { season: '2013-14' }),
  2013,
);
const SAME_DAY_A = entry(
  identity('m-a', '2014-05-24', INTER, LIVERPOOL, { season: '2013-14' }),
  2013,
);
const POOL = [ISTANBUL, DERBY, MADRID, SAME_DAY_A].sort(newestFirst);

const query = (q: Partial<ArchiveQuery> = {}): ArchiveQuery => ({
  limit: 20,
  ...q,
});

const idsOf = (q: Partial<ArchiveQuery>) =>
  archivePage(POOL, query(q))?.entries.map((e) => e.id);

describe('archiveWords', () => {
  it('reads clubs, aliases, competition, nickname and the years', () => {
    expect(archiveWords({ ...ISTANBUL, aliases: ALIASES })).toEqual(
      expect.arrayContaining([
        'ac',
        'milan',
        'mil',
        'rossoneri',
        'liverpool',
        'champions',
        'league',
        'miracle',
        'istanbul',
        '2004',
        '05',
        '2005',
      ]),
    );
  });

  it('adds no next year to a tournament season', () => {
    const cup = entry(identity('wc', '2006-07-09', INTER, MILAN), 2006);
    expect(cup.words).toContain('2006');
    expect(cup.words).not.toContain('2007');
  });

  it('keeps each word once', () => {
    expect(new Set(ISTANBUL.words).size).toBe(ISTANBUL.words.length);
  });
});

describe('archivePage search', () => {
  it.each([
    ['diacritics', 'atletico', ['m-madrid']],
    ['Turkish letters', 'fenerbahce', ['m-derby']],
    ['a Turkish competition', 'super lig', ['m-derby']],
    ['several words, each anywhere', 'milan 2005', ['m-istanbul']],
    ['a nickname', 'istanbul', ['m-istanbul']],
    ['an alias', 'rossoneri', ['m-madrid', 'm-istanbul']],
    ['the start of a word', 'barc atl', []],
    ['upper case and accents in the query', 'ATLÉTICO', ['m-madrid']],
  ])('finds by %s', (_, q, ids) => {
    expect(idsOf({ q })).toEqual(ids);
  });

  it('never matches inside a word', () => {
    expect(idsOf({ q: 'ter' })).toEqual([]);
    expect(idsOf({ q: 'inte' })).toEqual(['m-a']);
  });

  it('needs every word to match', () => {
    expect(idsOf({ q: 'milan fenerbahce' })).toEqual([]);
  });

  it('filters nothing for a query with no words', () => {
    expect(idsOf({ q: '!!!' })).toHaveLength(POOL.length);
  });
});

describe('archivePage filters', () => {
  it('by competition', () => {
    expect(idsOf({ competitionId: 'sl' })).toEqual(['m-derby']);
  });

  it('by club, on either side', () => {
    expect(idsOf({ clubId: 'milan' })).toEqual(['m-madrid', 'm-istanbul']);
  });

  it('by season starts, both bounds included', () => {
    expect(idsOf({ from: 2013 })).toEqual(['m-madrid', 'm-a', 'm-derby']);
    expect(idsOf({ to: 2004 })).toEqual(['m-istanbul']);
    expect(idsOf({ from: 2005, to: 2012 })).toEqual([]);
  });

  it('combined, with the search', () => {
    expect(idsOf({ clubId: 'milan', from: 2013, q: 'atletico' })).toEqual([
      'm-madrid',
    ]);
    expect(idsOf({ clubId: 'liv', competitionId: 'sl' })).toEqual([]);
  });
});

describe('archivePage order and paging', () => {
  it('lists newest first, then by id descending', () => {
    expect(idsOf({})).toEqual(['m-madrid', 'm-a', 'm-derby', 'm-istanbul']);
  });

  it('pages with no repeats or gaps, and counts the total', () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pageNo = 0; pageNo < 5; pageNo += 1) {
      const page = archivePage(POOL, query({ limit: 1, cursor }));
      if (!page) throw new Error('Bad cursor');
      expect(page.total).toBe(4);
      seen.push(...page.entries.map((e) => e.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(['m-madrid', 'm-a', 'm-derby', 'm-istanbul']);
  });

  it('has no next cursor on a full last page', () => {
    const page = archivePage(POOL, query({ limit: 4 }));
    expect(page?.nextCursor).toBeNull();
    expect(page?.entries).toHaveLength(4);
  });

  it('pages a filtered list, keeping its total', () => {
    const first = archivePage(POOL, query({ clubId: 'milan', limit: 1 }));
    const second = archivePage(
      POOL,
      query({ clubId: 'milan', limit: 1, cursor: first?.nextCursor ?? '' }),
    );
    expect(first?.total).toBe(2);
    expect(second?.entries.map((e) => e.id)).toEqual(['m-istanbul']);
    expect(second?.nextCursor).toBeNull();
  });

  it('continues after a cursor whose match is gone', () => {
    const cursor = encodeCursor(MADRID);
    const without = POOL.filter((e) => e !== MADRID);
    expect(
      archivePage(without, query({ cursor }))?.entries.map((e) => e.id),
    ).toEqual(['m-a', 'm-derby', 'm-istanbul']);
  });

  it('is empty past the last match', () => {
    const page = archivePage(POOL, query({ cursor: encodeCursor(ISTANBUL) }));
    expect(page).toEqual({ entries: [], nextCursor: null, total: 4 });
  });

  it('refuses a malformed cursor', () => {
    expect(archivePage(POOL, query({ cursor: 'bm90LWEtY3Vyc29y' }))).toBeNull();
  });
});

describe('cursors', () => {
  it('round-trips a date and an id', () => {
    expect(decodeCursor(encodeCursor(ISTANBUL))).toEqual({
      date: '2005-05-25',
      id: 'm-istanbul',
    });
  });

  it.each(['', 'x', Buffer.from('2005-05-25|').toString('base64url')])(
    'refuses %j',
    (text) => {
      expect(decodeCursor(text)).toBeNull();
    },
  );
});
