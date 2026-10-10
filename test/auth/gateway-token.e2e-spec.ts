import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthService } from '@thallesp/nestjs-better-auth';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { NO_SESSION } from '@/auth/auth-flow.service.js';
import type { Auth } from '@/auth/auth.factory.js';
import { GatewayTokenService } from '@/auth/gateway-token.service.js';
import { setupDocs } from '@/docs/setup-docs.js';
import { PrismaService } from '@/prisma/prisma.service.js';

const ISSUER = new URL(process.env.BETTER_AUTH_URL ?? '').origin;
const FIVE_MIN_MS = 5 * 60_000;

// Own prefix: e2e files run in parallel
const account = (tag: string) => ({
  email: `test-jwt-${tag}@lineup.test`,
  password: 'correct-horse',
  handle: `test-j-${tag}`,
});

const cookieHeader = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

// The claims, read without checking the signature
const claimsOf = (token: string): Record<string, unknown> =>
  JSON.parse(
    Buffer.from(token.split('.')[1], 'base64url').toString('utf8'),
  ) as Record<string, unknown>;

describe('Gateway token (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: GatewayTokenService;
  let auth: AuthService<Auth>;
  const http = () => request(app.getHttpServer());
  const guests: string[] = [];

  async function asGuest() {
    const res = await http().post('/auth/guest');
    guests.push(res.body.data.user.id);
    return { cookie: cookieHeader(res), id: res.body.data.user.id as string };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    setupDocs(app);
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(GatewayTokenService);
    auth = app.get<AuthService<Auth>>(AuthService);
  });

  afterEach(async () => {
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { in: guests.splice(0) } },
          { email: { startsWith: 'test-jwt-' } },
        ],
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('gives a guest a 5-minute token for its own id', async () => {
    const guest = await asGuest();
    const before = Date.now();

    const res = await http().get('/auth/token').set('Cookie', guest.cookie);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      success: true,
      data: { token: expect.any(String), expiresAt: expect.any(Number) },
    });
    const { token, expiresAt } = res.body.data as {
      token: string;
      expiresAt: number;
    };
    expect(expiresAt).toBeGreaterThanOrEqual(before + FIVE_MIN_MS - 2_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + FIVE_MIN_MS + 1_000);
    expect(await tokens.verify(token)).toEqual({ userId: guest.id });
  });

  it('carries only the standard claims: no email, no handle', async () => {
    const signedUp = await http().post('/auth/sign-up').send(account('claims'));

    const res = await http()
      .get('/auth/token')
      .set('Cookie', cookieHeader(signedUp));

    const claims = claimsOf(res.body.data.token as string);
    expect(Object.keys(claims).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'iss',
      'sub',
    ]);
    expect(claims).toMatchObject({
      sub: signedUp.body.data.user.id,
      iss: ISSUER,
      aud: ISSUER,
    });
    expect(JSON.stringify(claims)).not.toMatch(/lineup\.test|test-j-claims/);
  });

  it('verifies a registered user to the id the session shows', async () => {
    const signedUp = await http().post('/auth/sign-up').send(account('reg'));
    const cookie = cookieHeader(signedUp);

    const res = await http().get('/auth/token').set('Cookie', cookie);
    const session = await http().get('/auth/session').set('Cookie', cookie);

    expect(await tokens.verify(res.body.data.token as string)).toEqual({
      userId: session.body.data.user.id,
    });
  });

  describe('refuses a token that is', () => {
    const NOW_S = () => Math.floor(Date.now() / 1000);

    it('tampered with', async () => {
      const guest = await asGuest();
      const res = await http().get('/auth/token').set('Cookie', guest.cookie);
      const [head, , sig] = (res.body.data.token as string).split('.');
      const forged = Buffer.from(
        JSON.stringify({ ...claimsOf(res.body.data.token), sub: 'someone' }),
      ).toString('base64url');

      expect(await tokens.verify(`${head}.${forged}.${sig}`)).toBeNull();
    });

    it('signed for another audience', async () => {
      const { token } = await auth.api.signJWT({
        body: { payload: { sub: 'u-1', aud: 'https://elsewhere.example' } },
      });
      expect(await tokens.verify(token)).toBeNull();
    });

    it('expired', async () => {
      const { token } = await auth.api.signJWT({
        body: {
          payload: { sub: 'u-1', iat: NOW_S() - 600, exp: NOW_S() - 60 },
        },
      });
      expect(await tokens.verify(token)).toBeNull();
    });

    it('not a JWT at all', async () => {
      expect(await tokens.verify('not-a-token')).toBeNull();
    });
  });

  it('refuses a token to a caller with no session', async () => {
    const res = await http().get('/auth/token');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'unauthorized', message: NO_SESSION, retryAfterMs: null },
    });
  });

  it.each(['/api/auth/token', '/api/auth/jwks'])(
    'closes the native route %s',
    async (path) => {
      const guest = await asGuest();
      const res = await http().get(path).set('Cookie', guest.cookie);
      expect(res.status).toBe(404);
    },
  );

  it('stores its signing key encrypted', async () => {
    const guest = await asGuest();
    await http().get('/auth/token').set('Cookie', guest.cookie);

    const keys = await prisma.jwks.findMany();
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      // Stored as a quoted ciphertext, never a JWK object
      expect(typeof JSON.parse(key.privateKey)).toBe('string');
      expect(key.privateKey).not.toMatch(/"d"\s*:/);
      expect(JSON.parse(key.publicKey)).not.toHaveProperty('d');
    }
  });

  it('documents the route, its cookie and its 401', async () => {
    const res = await http().get('/docs/openapi.json');
    const doc = res.body as {
      paths: Record<string, { get?: Record<string, unknown> }>;
      components: { securitySchemes?: Record<string, unknown> };
    };
    const route = doc.paths['/auth/token']?.get;

    // Cookie for the web, bearer for mobile (B13b)
    expect(route?.security).toEqual([{ session: [] }, { bearer: [] }]);
    expect(route?.responses).toMatchObject({
      '200': {
        content: {
          'application/json': {
            schema: {
              properties: {
                data: { $ref: '#/components/schemas/GatewayToken' },
              },
            },
          },
        },
      },
      '401': {
        content: {
          'application/json': {
            schema: {
              properties: {
                error: { $ref: '#/components/schemas/ApiError' },
              },
            },
          },
        },
      },
    });
    expect(doc.components.securitySchemes?.session).toEqual({
      type: 'apiKey',
      in: 'cookie',
      name: 'lineup.session_token',
    });
  });
});
