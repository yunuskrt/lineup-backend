import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthService } from '@thallesp/nestjs-better-auth';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import type { Auth } from '@/auth/auth.factory.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { buildMatch, buildUsers } from '@test/schema/schema-fixtures.js';
import { useRolledBackDb, violation } from '@test/schema/schema-test-utils.js';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-/;
const PASSWORD = 'correct-horse';

// Own prefix: e2e files run in parallel
const signUp = (tag: string, handle: string = `test-c-${tag}`) => ({
  email: `test-core-${tag}@lineup.test`,
  password: PASSWORD,
  name: handle,
  handle,
});

describe('Better Auth (e2e)', () => {
  let app: INestApplication<App>;
  let auth: Auth;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await app.init();
    auth = app.get<AuthService<Auth>>(AuthService).instance;
    prisma = app.get(PrismaService);
  });

  // Sign-ups commit for real; their rows go here
  afterEach(async () => {
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'test-core-' } },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('email sign-up', () => {
    it('writes a user with a uuid(7) id, a handle and a hashed password', async () => {
      const { user } = await auth.api.signUpEmail({ body: signUp('ada') });

      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { accounts: true },
      });
      expect(stored.id).toMatch(UUID_V7);
      expect(stored).toMatchObject({
        email: 'test-core-ada@lineup.test',
        handle: 'test-c-ada',
        emailVerified: false,
      });
      expect(stored.accounts).toHaveLength(1);
      expect(stored.accounts[0].providerId).toBe('credential');
      expect(stored.accounts[0].password).not.toContain(PASSWORD);
    });

    it('stores the trimmed handle and a lowercase email', async () => {
      const body = {
        ...signUp('case', '  test-c-pad  '),
        email: 'Test-Core-Case@Lineup.TEST',
      };
      const { user } = await auth.api.signUpEmail({ body });

      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect([stored.handle, stored.email]).toEqual([
        'test-c-pad',
        'test-core-case@lineup.test',
      ]);
    });

    it('refuses a sign-up without a handle', async () => {
      const { handle: _, ...body } = signUp('nohandle');
      await expect(
        auth.api.signUpEmail({
          body: body as typeof body & { handle: string },
        }),
      ).rejects.toThrow();
      expect(await prisma.user.count({ where: { email: body.email } })).toBe(0);
    });

    it.each(['ab', 'has space', 'İstanbul', 'x'.repeat(25)])(
      'refuses the handle %j before writing',
      async (handle) => {
        const body = signUp('badhandle', handle);
        await expect(auth.api.signUpEmail({ body })).rejects.toThrow();
        expect(await prisma.user.count({ where: { email: body.email } })).toBe(
          0,
        );
      },
    );

    it('refuses a handle taken in another case', async () => {
      await auth.api.signUpEmail({ body: signUp('first', 'test-c-Dup') });
      await expect(
        auth.api.signUpEmail({ body: signUp('second', 'TEST-C-dup') }),
      ).rejects.toThrow();
      expect(
        await prisma.user.count({
          where: { email: 'test-core-second@lineup.test' },
        }),
      ).toBe(0);
    });
  });

  describe('native routes', () => {
    it('answers /api/auth/ok outside the envelope', async () => {
      const res = await request(app.getHttpServer()).get('/api/auth/ok');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('issues a lineup-prefixed, HttpOnly session cookie', async () => {
      const { headers } = await auth.api.signUpEmail({
        body: signUp('cookie'),
        returnHeaders: true,
      });
      const session = headers
        .getSetCookie()
        .find((c) => c.startsWith('lineup.session_token='));
      expect(session).toMatch(/HttpOnly/i);
    });

    it.each(['google', 'apple'])(
      'refuses social sign-in with %s',
      async (provider) => {
        const res = await request(app.getHttpServer())
          .post('/api/auth/sign-in/social')
          .send({ provider, callbackURL: '/' });
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ code: 'PROVIDER_NOT_FOUND' });
      },
    );

    it('still envelopes every other unknown route', async () => {
      const res = await request(app.getHttpServer()).get('/api/other');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ success: false });
    });
  });

  describe('user foreign keys', () => {
    const { rolledBack } = useRolledBackDb();

    it('rejects a participant with an unknown user', async () => {
      await expect(
        rolledBack(async (tx) => {
          const { match } = await buildMatch(tx);
          await tx.gameSession.create({
            data: {
              mode: 'solo',
              matchId: match.id,
              participants: {
                create: {
                  userId: '01900000-0000-7000-8000-000000000000',
                  seat: 0,
                },
              },
            },
          });
        }),
      ).rejects.toMatchObject(
        violation('P2003', 'game_participants_user_id_fkey'),
      );
    });

    it('refuses to delete a user with game history', async () => {
      await expect(
        rolledBack(async (tx) => {
          const { match } = await buildMatch(tx);
          const [user] = await buildUsers(tx, 1);
          await tx.gameSession.create({
            data: {
              mode: 'solo',
              matchId: match.id,
              participants: { create: { userId: user.id, seat: 0 } },
            },
          });
          await tx.user.delete({ where: { id: user.id } });
        }),
      ).rejects.toMatchObject(
        violation('P2003', 'game_participants_user_id_fkey'),
      );
    });

    it('deletes stats, sessions and accounts with their user', async () => {
      const left = await rolledBack(async (tx) => {
        const [user] = await buildUsers(tx, 1);
        await tx.userStats.create({ data: { userId: user.id } });
        await tx.session.create({
          data: {
            userId: user.id,
            token: 'test-token',
            expiresAt: new Date(Date.now() + 60_000),
          },
        });
        await tx.account.create({
          data: {
            userId: user.id,
            accountId: user.id,
            providerId: 'credential',
          },
        });
        await tx.user.delete({ where: { id: user.id } });
        const where = { userId: user.id };
        return [
          await tx.userStats.count({ where }),
          await tx.session.count({ where }),
          await tx.account.count({ where }),
        ];
      });
      expect(left).toEqual([0, 0, 0]);
    });

    it.each([
      ['a bad character', 'test user', 'users_handle_check'],
      ['a case-only duplicate', 'TEST-USER-A', 'users_handle_lower_key'],
    ])('rejects %s in the database itself', async (_, handle, constraint) => {
      await expect(
        rolledBack(async (tx) => {
          await buildUsers(tx, 1);
          await tx.user.create({
            data: { name: handle, handle, email: 'test-raw@lineup.test' },
          });
        }),
      ).rejects.toThrow(constraint);
    });
  });
});
