import { get, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import {
  type PlayerDirectory,
  playerDirectorySchema,
} from '@/contract/catalog.js';
import {
  soloGuessResponseSchema,
  soloMatchOfferSchema,
} from '@/contract/solo.js';
import { normalizeName } from '@/game/normalize.js';
import { PlayerKeysService } from '@/matches/player-keys.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';

const SLUG = 'test-directory';
const ALL = { competitionIds: [], clubIds: [], era: { from: 2000, to: 2025 } };

type Raw = { status: number; headers: IncomingHttpHeaders; body: Buffer };

const cookieOf = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

describe('GET /catalog/players (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let port: number;
  let cookie: string;
  const guests: string[] = [];
  const http = () => request(app.getHttpServer());

  // Raw bytes: no client-side unzipping
  function raw(headers: Record<string, string> = {}): Promise<Raw> {
    return new Promise((resolve, reject) => {
      get(
        { port, path: '/catalog/players', headers: { cookie, ...headers } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      ).on('error', reject);
    });
  }

  async function directory(): Promise<{ tag: string; data: PlayerDirectory }> {
    const res = await raw();
    expect(res.status).toBe(200);
    const envelope = JSON.parse(res.body.toString());
    expect(envelope.success).toBe(true);
    return {
      tag: String(res.headers.etag),
      data: playerDirectorySchema.parse(envelope.data),
    };
  }

  const tagNow = async () => (await directory()).tag;

  async function guest(): Promise<string> {
    const res = await http().post('/auth/guest');
    guests.push(res.body.data.user.id as string);
    return cookieOf(res);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await app.listen(0);
    const server = app.getHttpServer() as unknown as Server;
    port = (server.address() as AddressInfo).port;
    prisma = app.get(PrismaService);
    cookie = await guest();
  });

  afterAll(async () => {
    await prisma.player.deleteMany({ where: { slug: { startsWith: SLUG } } });
    await prisma.gameSession.deleteMany({
      where: { participants: { some: { userId: { in: guests } } } },
    });
    await prisma.user.deleteMany({ where: { id: { in: guests } } });
    await app.close();
  });

  it('refuses a request with no session', async () => {
    const res = await http().get('/catalog/players');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('answers a guest with the whole directory and its caching headers', async () => {
    const res = await raw();
    expect(res.status).toBe(200);
    expect(res.headers.etag).toMatch(/^"[A-Za-z0-9_-]{32}"$/);
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.headers.vary).toContain('Accept-Encoding');
    expect(res.headers['content-type']).toContain('application/json');

    const { data } = await directory();
    const withAliases = await prisma.player.count({
      where: { aliases: { some: {} } },
    });
    expect(data.players).toHaveLength(withAliases);
    const keys = data.players.map((player) => player.key);
    expect(keys).toEqual([...keys].sort());
  });

  it('answers 304 with no body to the current ETag', async () => {
    const first = await raw();
    const again = await raw({ 'if-none-match': String(first.headers.etag) });
    expect(again.status).toBe(304);
    expect(again.body).toHaveLength(0);
    expect(again.headers.etag).toBe(first.headers.etag);
  });

  it('sends Brotli and gzip that unzip to the same JSON', async () => {
    const plain = (await raw()).body.toString();
    const br = await raw({ 'accept-encoding': 'br' });
    const gz = await raw({ 'accept-encoding': 'gzip' });
    expect(br.headers['content-encoding']).toBe('br');
    expect(gz.headers['content-encoding']).toBe('gzip');
    expect(brotliDecompressSync(br.body).toString()).toBe(plain);
    expect(gunzipSync(gz.body).toString()).toBe(plain);
    expect(br.body.length).toBeLessThan(plain.length);
  });

  it('changes its ETag with every write it reads, and only then', async () => {
    const start = await tagNow();
    const player = await prisma.player.create({
      data: { slug: `${SLUG}-one`, name: 'Directory Probe' },
    });
    // No alias yet: not in the directory
    expect(await tagNow()).toBe(start);

    const alias = await prisma.playerAlias.create({
      data: {
        playerId: player.id,
        alias: 'Directory Probe',
        normalized: normalizeName('Directory Probe'),
      },
    });
    const added = await tagNow();
    expect(added).not.toBe(start);

    await prisma.player.update({
      where: { id: player.id },
      data: { slug: `${SLUG}-renamed` },
    });
    expect(await tagNow()).toBe(added);

    await prisma.playerAlias.update({
      where: { id: alias.id },
      data: { alias: 'Probe', normalized: normalizeName('Probe') },
    });
    const edited = await tagNow();
    expect(edited).not.toBe(added);

    await prisma.player.delete({ where: { id: player.id } });
    expect(await tagNow()).toBe(start);
  });

  it('keeps its ETag through a guest sign-up and a solo run', async () => {
    const start = await tagNow();
    const other = await guest();
    const offer = soloMatchOfferSchema.parse(
      (await http().post('/solo/sessions').set('Cookie', other).send(ALL)).body
        .data,
    );
    await http()
      .post(`/solo/sessions/${offer.sessionId}/side`)
      .set('Cookie', other)
      .send({ side: 'home' });
    await http()
      .post(`/solo/sessions/${offer.sessionId}/quit`)
      .set('Cookie', other);
    expect(await tagNow()).toBe(start);
  });

  it("gives a revealed player the key of that player's entry", async () => {
    const run = await guest();
    const offer = soloMatchOfferSchema.parse(
      (await http().post('/solo/sessions').set('Cookie', run).send(ALL)).body
        .data,
    );
    const id = offer.sessionId;
    await http()
      .post(`/solo/sessions/${id}/side`)
      .set('Cookie', run)
      .send({ side: 'home' });
    const starter = await prisma.lineup.findFirstOrThrow({
      where: { matchTeam: { matchId: offer.match.id, side: 'home' } },
      orderBy: { slot: 'asc' },
      select: {
        player: { select: { id: true, name: true, aliases: true } },
      },
    });
    // The longest alias: never a shared surname
    const [longest] = starter.player.aliases
      .map((row) => row.alias)
      .sort((a, b) => b.length - a.length);
    const guess = await http()
      .post(`/solo/sessions/${id}/guesses`)
      .set('Cookie', run)
      .send({ sessionId: id, guess: longest });
    const { result } = soloGuessResponseSchema.parse(guess.body.data);
    if (result.outcome !== 'correct_new') throw new Error(result.outcome);

    const key = app.get(PlayerKeysService).keyOf(starter.player.id);
    expect(result.player.directoryKey).toBe(key);
    const { data } = await directory();
    const entry = data.players.find((player) => player.key === key);
    expect(entry?.name).toBe(starter.player.name);
    await http().post(`/solo/sessions/${id}/quit`).set('Cookie', run);
  });
});
