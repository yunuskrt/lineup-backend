import { Logger } from '@nestjs/common';
import { CatalogService, OVERVIEW_TTL_MS } from '@/catalog/catalog.service.js';
import {
  HOME_SLUGS,
  showcaseRow,
  showcaseTeam,
} from '@/catalog/showcase.fixtures.js';
import type { Env } from '@/config/env.schema.js';
import {
  catalogOverviewSchema,
  filterOptionsSchema,
} from '@/contract/catalog.js';
import type { MatchSelectorService } from '@/matches/match-selector.service.js';
import type { PlayerKeysService } from '@/matches/player-keys.service.js';
import type { PoolCandidate } from '@/matches/pool-rules.js';
import { LANDING_SHOWCASE } from '@/matches/showcase.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

const candidate = (
  matchId: string,
  competitionId: string,
  clubIds: [string, string],
  seasonStart: number,
): PoolCandidate => ({ matchId, competitionId, clubIds, seasonStart });

const BASE = 'https://bucket.example.com/images';
const CREST = 'crests/yildiz/0123456789ab.webp';
const LOGO = 'competitions/zenith-cup/0123456789ab.webp';

const keys = { keyOf: (id: string) => id.padEnd(22, 'k') };

describe('CatalogService', () => {
  const selector = { candidates: vi.fn() };
  const prisma = {
    competition: { findMany: vi.fn() },
    club: { findMany: vi.fn() },
  };
  const catalog = (env: Partial<Env>) =>
    new CatalogService(
      selector as unknown as MatchSelectorService,
      prisma as unknown as PrismaService,
      env as Env,
      keys as PlayerKeysService,
      LANDING_SHOWCASE,
      { now: () => 0 },
    );
  const service = catalog({});

  beforeEach(() => {
    vi.resetAllMocks();
    selector.candidates.mockResolvedValue([
      candidate('m1', 'comp-1', ['club-1', 'club-2'], 2004),
      candidate('m2', 'comp-2', ['club-2', 'club-3'], 2018),
    ]);
    prisma.competition.findMany.mockResolvedValue([
      { id: 'comp-2', kind: 'ucl', name: 'Zenith Cup', logoKey: LOGO },
      { id: 'comp-1', kind: 'league', name: 'Ankara League', logoKey: null },
    ]);
    prisma.club.findMany.mockResolvedValue([
      { id: 'club-3', name: 'Yıldız', shortName: 'YLD', crestKey: CREST },
      { id: 'club-1', name: 'Örnek', shortName: 'ORN', crestKey: null },
      { id: 'club-2', name: 'Bravo', shortName: 'BRV', crestKey: null },
    ]);
  });

  it('queries competitions and clubs by the pool ids only', async () => {
    await service.filterOptions();
    expect(prisma.competition.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['comp-1', 'comp-2'] } },
      select: { id: true, kind: true, name: true, logoKey: true },
    });
    expect(prisma.club.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['club-1', 'club-2', 'club-3'] } },
      select: { id: true, name: true, shortName: true, crestKey: true },
    });
  });

  it('sorts by name and maps refs with no crest', async () => {
    const options = await service.filterOptions();
    expect(options).toEqual({
      competitions: [
        {
          id: 'comp-1',
          kind: 'league',
          name: 'Ankara League',
          logoUrl: null,
          clubIds: ['club-2', 'club-1'],
          seasonStarts: [2004],
        },
        {
          id: 'comp-2',
          kind: 'ucl',
          name: 'Zenith Cup',
          logoUrl: null,
          clubIds: ['club-2', 'club-3'],
          seasonStarts: [2018],
        },
      ],
      clubs: [
        { id: 'club-2', name: 'Bravo', shortName: 'BRV', crestUrl: null },
        { id: 'club-1', name: 'Örnek', shortName: 'ORN', crestUrl: null },
        { id: 'club-3', name: 'Yıldız', shortName: 'YLD', crestUrl: null },
      ],
      era: { from: 2004, to: 2018 },
    });
    expect(filterOptionsSchema.safeParse(options).success).toBe(true);
  });

  // Bravo before Örnek: the clubs list order
  it('gives each competition its clubs in clubs order and its seasons', async () => {
    selector.candidates.mockResolvedValue([
      candidate('m1', 'comp-1', ['club-1', 'club-2'], 2012),
      candidate('m2', 'comp-1', ['club-3', 'club-1'], 2004),
      candidate('m3', 'comp-1', ['club-2', 'club-1'], 2012),
      candidate('m4', 'comp-2', ['club-3', 'club-2'], 2018),
    ]);
    const { competitions } = await service.filterOptions();
    expect(
      competitions.map(({ id, clubIds, seasonStarts }) => ({
        id,
        clubIds,
        seasonStarts,
      })),
    ).toEqual([
      {
        id: 'comp-1',
        clubIds: ['club-2', 'club-1', 'club-3'],
        seasonStarts: [2004, 2012],
      },
      { id: 'comp-2', clubIds: ['club-2', 'club-3'], seasonStarts: [2018] },
    ]);
  });

  it('sends a crest URL under the base, if the club has one', async () => {
    const { clubs } = await catalog({ ASSET_BASE_URL: BASE }).filterOptions();
    expect(clubs.map((club) => club.crestUrl)).toEqual([
      null,
      null,
      `${BASE}/${CREST}`,
    ]);
  });

  it('sends a logo URL under the base, if the competition has one', async () => {
    const { competitions } = await catalog({
      ASSET_BASE_URL: BASE,
    }).filterOptions();
    expect(competitions.map((competition) => competition.logoUrl)).toEqual([
      null,
      `${BASE}/${LOGO}`,
    ]);
  });

  it('breaks a name tie by id', async () => {
    prisma.club.findMany.mockResolvedValue([
      { id: 'club-3', name: 'United', shortName: 'UT3' },
      { id: 'club-1', name: 'United', shortName: 'UT1' },
      { id: 'club-2', name: 'United', shortName: 'UT2' },
    ]);
    const { clubs } = await service.filterOptions();
    expect(clubs.map((club) => club.id)).toEqual([
      'club-1',
      'club-2',
      'club-3',
    ]);
  });

  it('gives empty lists and the full range for an empty pool', async () => {
    selector.candidates.mockResolvedValue([]);
    await expect(service.filterOptions()).resolves.toEqual({
      competitions: [],
      clubs: [],
      era: { from: 2000, to: 2025 },
    });
    expect(prisma.competition.findMany).not.toHaveBeenCalled();
    expect(prisma.club.findMany).not.toHaveBeenCalled();
  });
});

describe('CatalogService.overview', () => {
  const selector = { candidates: vi.fn() };
  const prisma = {
    match: { findMany: vi.fn(), findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  };
  let now = 0;
  // Each holds its own cache and last reason
  const overviewService = (spec = LANDING_SHOWCASE) =>
    new CatalogService(
      selector as unknown as MatchSelectorService,
      prisma as unknown as PrismaService,
      {} as Env,
      keys as PlayerKeysService,
      spec,
      { now: () => now },
    );
  // Past the cache, so the next read rebuilds
  const expire = () => {
    now += OVERVIEW_TTL_MS;
  };
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

  afterAll(() => {
    vi.restoreAllMocks();
  });

  const club = (id: string, name: string) => ({
    id,
    kind: 'club' as const,
    name,
    shortName: 'CLB',
    crestKey: null,
  });
  const overviewRow = {
    stage: 'Final',
    extraTime: true,
    shootoutHome: 4,
    season: {
      startYear: 2004,
      competition: {
        id: 'comp-1',
        kind: 'ucl',
        name: 'Zenith Cup',
        logoKey: null,
      },
    },
    teams: [
      { goals: 3, club: club('club-1', 'Örnek') },
      { goals: 3, club: club('club-2', 'Bravo') },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    now = 0;
    selector.candidates.mockResolvedValue([
      candidate('m1', 'comp-1', ['club-1', 'club-2'], 2004),
    ]);
    prisma.match.findMany.mockResolvedValue([overviewRow]);
    prisma.$queryRaw.mockResolvedValue([{ players: 22 }]);
    prisma.match.findUnique.mockResolvedValue(null);
  });

  it('reads the rows of the candidates only', async () => {
    await overviewService().overview();
    expect(prisma.match.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['m1'] } } }),
    );
    expect(prisma.match.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: LANDING_SHOWCASE.matchSlug },
      }),
    );
  });

  it('answers every field when the showcase is off', async () => {
    const overview = await overviewService().overview();
    expect(overview).toEqual({
      counts: {
        matches: 1,
        players: 22,
        clubs: 2,
        nationalTeams: 0,
        seasons: 1,
      },
      era: { from: 2004, to: 2004 },
      highlights: { finals: 1, shootouts: 1, extraTime: 1, goals: 6 },
      competitions: [
        { id: 'comp-1', kind: 'ucl', name: 'Zenith Cup', logoUrl: null },
      ],
      topClubs: [
        { id: 'club-2', name: 'Bravo', shortName: 'CLB', crestUrl: null },
        { id: 'club-1', name: 'Örnek', shortName: 'CLB', crestUrl: null },
      ],
      showcase: null,
    });
    expect(catalogOverviewSchema.safeParse(overview).success).toBe(true);
  });

  it('gives zeros for an empty pool and still checks the showcase', async () => {
    selector.candidates.mockResolvedValue([]);
    const overview = await overviewService().overview();
    expect(overview.counts).toEqual({
      matches: 0,
      players: 0,
      clubs: 0,
      nationalTeams: 0,
      seasons: 0,
    });
    expect(overview.era).toEqual({ from: 2000, to: 2025 });
    expect(overview.topClubs).toEqual([]);
    expect(prisma.match.findMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.match.findUnique).toHaveBeenCalled();
  });

  describe('cache', () => {
    it('answers from memory until the five minutes pass', async () => {
      const service = overviewService();
      const first = await service.overview();
      now += OVERVIEW_TTL_MS - 1;
      await expect(service.overview()).resolves.toBe(first);
      expect(selector.candidates).toHaveBeenCalledTimes(1);
      expect(prisma.match.findUnique).toHaveBeenCalledTimes(1);

      now += 1;
      const second = await service.overview();
      expect(second).not.toBe(first);
      expect(selector.candidates).toHaveBeenCalledTimes(2);
    });

    it('builds once for concurrent requests', async () => {
      const service = overviewService();
      const [a, b, c] = await Promise.all([
        service.overview(),
        service.overview(),
        service.overview(),
      ]);
      expect(b).toBe(a);
      expect(c).toBe(a);
      expect(selector.candidates).toHaveBeenCalledTimes(1);
    });

    it('keeps nothing from a failed build, and the next retries', async () => {
      const service = overviewService();
      selector.candidates.mockRejectedValueOnce(new Error('db down'));
      await expect(service.overview()).rejects.toThrow('db down');
      await expect(service.overview()).resolves.toMatchObject({
        counts: { matches: 1 },
      });
      expect(selector.candidates).toHaveBeenCalledTimes(2);
    });

    it('shows a pool change after a rebuild', async () => {
      const service = overviewService();
      await service.overview();
      selector.candidates.mockResolvedValue([]);
      await expect(service.overview()).resolves.toMatchObject({
        counts: { matches: 1 },
      });
      expire();
      await expect(service.overview()).resolves.toMatchObject({
        counts: { matches: 0 },
      });
    });
  });

  it('warns once per reason, again on a new one, and once on recovery', async () => {
    const service = overviewService({
      ...LANDING_SHOWCASE,
      matchSlug: 'gone',
    });
    await service.overview();
    expire();
    await service.overview();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenLastCalledWith(
      'Showcase off: match gone is not loaded',
    );

    prisma.match.findUnique.mockResolvedValue(
      showcaseRow([showcaseTeam('home', HOME_SLUGS, 10)]),
    );
    expire();
    await service.overview();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(
      'Showcase off: home side has no formation or no opponent',
    );
    expect(log).not.toHaveBeenCalled();

    prisma.match.findUnique.mockResolvedValue(showcaseRow());
    expire();
    const { showcase } = await service.overview();
    expire();
    await service.overview();
    expect(showcase?.players).toHaveLength(11);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('Showcase back on');
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('logs nothing while the showcase stays on', async () => {
    prisma.match.findUnique.mockResolvedValue(showcaseRow());
    const service = overviewService();
    await service.overview();
    expire();
    await service.overview();
    expect(prisma.match.findUnique).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
