import { promisify } from 'node:util';
import { brotliDecompress, gunzip } from 'node:zlib';
import { Logger } from '@nestjs/common';
import { PlayerDirectoryService } from '@/catalog/player-directory.service.js';
import { ApiException } from '@/common/api-exception.js';
import type { Env } from '@/config/env.schema.js';
import { playerDirectorySchema } from '@/contract/catalog.js';
import { PlayerKeysService } from '@/matches/player-keys.service.js';
import type { PrismaService } from '@/prisma/prisma.service.js';

const ENV = { BETTER_AUTH_SECRET: 'k'.repeat(32) } as Env;
const KEYS = new PlayerKeysService(ENV);

const versionRow = (players: string) => [
  { players, player_hash: '11', aliases: '4', alias_hash: '22' },
];

const ROWS = [
  {
    id: 'p-1',
    name: 'Secret One',
    imageKey: null,
    aliases: [{ normalized: 'one' }],
  },
  {
    id: 'p-2',
    name: 'Secret Two',
    imageKey: null,
    aliases: [{ normalized: 'two' }],
  },
];

function setup() {
  const db = {
    $queryRaw: vi.fn().mockResolvedValue(versionRow('2')),
    player: { findMany: vi.fn().mockResolvedValue(ROWS) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((work: (tx: typeof db) => unknown) =>
    work(db),
  );
  const service = new PlayerDirectoryService(
    db as unknown as PrismaService,
    KEYS,
    ENV,
  );
  return { db, service };
}

describe('PlayerDirectoryService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the envelope once, in one repeatable-read snapshot', async () => {
    const { db, service } = setup();
    const built = await service.current();

    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(db.player.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { aliases: { some: {} } } }),
    );
    const envelope = JSON.parse(built.bodies.identity.toString());
    expect(envelope.success).toBe(true);
    expect(playerDirectorySchema.parse(envelope.data).players).toHaveLength(2);
    expect(built.playerCount).toBe(2);
    expect(built.tag).toMatch(/^"[A-Za-z0-9_-]{32}"$/);
  });

  it('keeps gzip and Brotli copies of the same JSON', async () => {
    const { service } = setup();
    const { bodies } = await service.current();
    const json = bodies.identity.toString();
    expect((await promisify(gunzip)(bodies.gzip)).toString()).toBe(json);
    expect((await promisify(brotliDecompress)(bodies.br)).toString()).toBe(
      json,
    );
  });

  it('logs one line per build: counts and sizes, never a name', async () => {
    const log = vi.spyOn(Logger.prototype, 'log');
    const { service } = setup();
    const { bodies } = await service.current();
    await service.current();

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toMatch(
      new RegExp(
        `^Directory built: 2 players, ${bodies.identity.length}/` +
          `${bodies.gzip.length}/${bodies.br.length} bytes raw/gzip/br, \\d+ ms$`,
      ),
    );
    expect(line).not.toMatch(/Secret|p-1|one|two/);
  });

  it('never sends a real player id', async () => {
    const { service } = setup();
    const { bodies } = await service.current();
    expect(bodies.identity.toString()).not.toMatch(/p-1|p-2/);
  });

  it('runs one build for concurrent requests', async () => {
    const { db, service } = setup();
    const [a, b, c] = await Promise.all([
      service.current(),
      service.current(),
      service.current(),
    ]);
    expect(db.player.findMany).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('does not rebuild while the version holds', async () => {
    const { db, service } = setup();
    const first = await service.current();
    const second = await service.current();
    expect(second).toBe(first);
    expect(db.player.findMany).toHaveBeenCalledTimes(1);
  });

  it('rebuilds with a new tag when the version changes', async () => {
    const { db, service } = setup();
    const first = await service.current();
    db.$queryRaw.mockResolvedValue(versionRow('3'));
    const second = await service.current();
    expect(db.player.findMany).toHaveBeenCalledTimes(2);
    expect(second.tag).not.toBe(first.tag);
  });

  it('answers server_error on a failed build and caches nothing', async () => {
    const { db, service } = setup();
    db.player.findMany.mockRejectedValueOnce(new Error('connection lost'));

    const failure: unknown = await service.current().catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiException);
    expect((failure as ApiException).error.code).toBe('server_error');

    const built = await service.current();
    expect(built.playerCount).toBe(2);
    expect(db.player.findMany).toHaveBeenCalledTimes(2);
  });

  it('fails closed on an off-contract directory, logging no name', async () => {
    const { db, service } = setup();
    const error = vi.spyOn(Logger.prototype, 'error');
    db.player.findMany.mockResolvedValueOnce([{ ...ROWS[0], name: '' }]);

    await expect(service.current()).rejects.toBeInstanceOf(ApiException);
    const logged = error.mock.calls.flat().join(' ');
    expect(logged).toContain('players.0.name');
    expect(logged).not.toMatch(/Secret|p-1/);
  });
});
