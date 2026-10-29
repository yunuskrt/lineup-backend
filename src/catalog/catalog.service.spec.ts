import { CatalogService } from '@/catalog/catalog.service.js';
import type { Env } from '@/config/env.schema.js';
import { filterOptionsSchema } from '@/contract/catalog.js';
import type { MatchSelectorService } from '@/matches/match-selector.service.js';
import type { PoolCandidate } from '@/matches/pool-rules.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

const candidate = (
  matchId: string,
  competitionId: string,
  clubIds: [string, string],
  seasonStart: number,
): PoolCandidate => ({ matchId, competitionId, clubIds, seasonStart });

const BASE = 'https://bucket.example.com/images';
const CREST = 'crests/yildiz/0123456789ab.webp';

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
    );
  const service = catalog({});

  beforeEach(() => {
    vi.resetAllMocks();
    selector.candidates.mockResolvedValue([
      candidate('m1', 'comp-1', ['club-1', 'club-2'], 2004),
      candidate('m2', 'comp-2', ['club-2', 'club-3'], 2018),
    ]);
    prisma.competition.findMany.mockResolvedValue([
      { id: 'comp-2', kind: 'ucl', name: 'Zenith Cup' },
      { id: 'comp-1', kind: 'league', name: 'Ankara League' },
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
      select: { id: true, kind: true, name: true },
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
        { id: 'comp-1', kind: 'league', name: 'Ankara League' },
        { id: 'comp-2', kind: 'ucl', name: 'Zenith Cup' },
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

  it('sends a crest URL under the base, if the club has one', async () => {
    const { clubs } = await catalog({ ASSET_BASE_URL: BASE }).filterOptions();
    expect(clubs.map((club) => club.crestUrl)).toEqual([
      null,
      null,
      `${BASE}/${CREST}`,
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
