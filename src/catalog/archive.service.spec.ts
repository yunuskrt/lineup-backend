import {
  ARCHIVE_MESSAGES,
  ARCHIVE_TTL_MS,
  ArchiveService,
} from '@/catalog/archive.service.js';
import { ApiException } from '@/common/api-exception.js';
import type { Clock } from '@/common/clock.js';
import type { Env } from '@/config/env.schema.js';
import type { MatchSelectorService } from '@/matches/match-selector.service.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

const T0 = 1_000_000;

const club = (id: string) => ({
  id,
  name: `Club ${id}`,
  shortName: 'CLB',
  crestKey: null,
});

const row = (id: string, date: string, home: string, away: string) => ({
  id,
  date: new Date(`${date}T00:00:00.000Z`),
  stage: null,
  nickname: null,
  season: {
    label: '2004-05',
    competition: { id: 'ucl', kind: 'ucl', name: 'Cup', logoKey: null },
  },
  teams: [
    { side: 'home', goals: 1, club: club(home) },
    { side: 'away', goals: 0, club: club(away) },
  ],
});

const candidate = (matchId: string, clubIds: [string, string]) => ({
  matchId,
  competitionId: 'ucl',
  seasonStart: 2004,
  clubIds,
});

function setup() {
  const clock: Clock & { at: number } = { at: T0, now: () => clock.at };
  const candidates = vi
    .fn()
    .mockResolvedValue([
      candidate('m-1', ['a', 'b']),
      candidate('m-2', ['b', 'c']),
    ]);
  const findMany = vi
    .fn()
    .mockResolvedValue([
      row('m-1', '2005-05-25', 'a', 'b'),
      row('m-2', '2006-05-17', 'b', 'c'),
    ]);
  const aliases = vi
    .fn()
    .mockResolvedValue([{ clubId: 'a', alias: 'The Reds' }]);
  const service = new ArchiveService(
    { candidates } as unknown as MatchSelectorService,
    {
      match: { findMany },
      clubAlias: { findMany: aliases },
    } as unknown as PrismaService,
    {} as Env,
    clock,
  );
  return { service, clock, candidates, findMany, aliases };
}

const ALL = { limit: 20 };

describe('ArchiveService', () => {
  it("builds from the selector's candidates only, newest first", async () => {
    const ctx = setup();

    const page = await ctx.service.page(ALL);

    expect(page.entries.map((e) => e.id)).toEqual(['m-2', 'm-1']);
    expect(page.total).toBe(2);
    expect(ctx.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['m-1', 'm-2'] } } }),
    );
    expect(ctx.aliases).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clubId: { in: ['a', 'b', 'c'] } } }),
    );
  });

  it('searches club aliases', async () => {
    const ctx = setup();
    const page = await ctx.service.page({ ...ALL, q: 'reds' });
    expect(page.entries.map((e) => e.id)).toEqual(['m-1']);
  });

  it('keeps the index 5 minutes, then rebuilds', async () => {
    const ctx = setup();
    await ctx.service.page(ALL);
    ctx.clock.at = T0 + ARCHIVE_TTL_MS - 1;
    await ctx.service.page(ALL);
    expect(ctx.candidates).toHaveBeenCalledTimes(1);

    ctx.clock.at = T0 + ARCHIVE_TTL_MS;
    await ctx.service.page(ALL);
    expect(ctx.candidates).toHaveBeenCalledTimes(2);
  });

  it('builds once for concurrent calls', async () => {
    const ctx = setup();
    await Promise.all([ctx.service.page(ALL), ctx.service.page(ALL)]);
    expect(ctx.candidates).toHaveBeenCalledTimes(1);
  });

  it('keeps nothing from a failed build', async () => {
    const ctx = setup();
    ctx.candidates.mockRejectedValueOnce(new Error('down'));
    await expect(ctx.service.page(ALL)).rejects.toThrow('down');

    await expect(ctx.service.page(ALL)).resolves.toMatchObject({ total: 2 });
    expect(ctx.candidates).toHaveBeenCalledTimes(2);
  });

  it('refuses a malformed cursor as invalid_input', async () => {
    const ctx = setup();
    const error: unknown = await ctx.service
      .page({ ...ALL, cursor: 'eA' })
      .catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).error).toMatchObject({
      code: 'invalid_input',
      message: ARCHIVE_MESSAGES.badCursor,
    });
  });
});
