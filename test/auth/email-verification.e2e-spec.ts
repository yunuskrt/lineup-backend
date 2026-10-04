import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { VERIFICATION_SUBJECT } from '@/auth/verification-email.js';
import { MAILER, type MailMessage } from '@/mail/mailer.js';
import { PrismaService } from '@/prisma/prisma.service.js';

const PASSWORD = 'correct-horse';
const CALLBACK = `${new URL(process.env.WEB_APP_URL ?? '').origin}/profile`;

// Own prefix: e2e files run in parallel
const account = (tag: string) => ({
  email: `test-mail-${tag}@lineup.test`,
  password: PASSWORD,
  handle: `test-m-${tag}`,
});

const cookieHeader = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

// The path and query of the link in a mail's text
function linkIn(mail: MailMessage): string {
  const found = /https?:\/\/\S+\/api\/auth\/verify-email\?\S+/.exec(mail.text);
  if (!found) throw new Error('No verification link in the mail');
  const url = new URL(found[0]);
  return `${url.pathname}${url.search}`;
}

describe('Email verification (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  const sent: MailMessage[] = [];
  const mailer = {
    send: vi.fn((message: MailMessage) => {
      sent.push(message);
      return Promise.resolve();
    }),
  };
  const guests: string[] = [];

  const verified = async (email: string) =>
    (await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerified;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MAILER)
      .useValue(mailer)
      .compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(() => {
    sent.length = 0;
    mailer.send.mockClear();
  });

  afterEach(async () => {
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { in: guests.splice(0) } },
          { email: { startsWith: 'test-mail-' } },
        ],
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('mails one verification link on sign-up', async () => {
    const res = await http().post('/auth/sign-up').send(account('one'));

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: 'test-mail-one@lineup.test',
      subject: VERIFICATION_SUBJECT,
    });
    expect(linkIn(sent[0])).toMatch(/^\/api\/auth\/verify-email\?token=/);
  });

  it('verifies the address and redirects to the web profile', async () => {
    const signedUp = await http().post('/auth/sign-up').send(account('ok'));
    const cookie = cookieHeader(signedUp);
    expect(signedUp.body.data.user.emailVerified).toBe(false);

    const res = await http().get(linkIn(sent[0]));

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(CALLBACK);
    expect(await verified('test-mail-ok@lineup.test')).toBe(true);
    const session = await http().get('/auth/session').set('Cookie', cookie);
    expect(session.body.data.user.emailVerified).toBe(true);
  });

  it('refuses a tampered link, leaving the address unverified', async () => {
    await http().post('/auth/sign-up').send(account('bad'));
    const link = linkIn(sent[0]);
    // Flip one character inside the token
    const tampered = link.replace(
      /token=([^&]{10})(.)/,
      (_, head, c) => `token=${head}${c === 'a' ? 'b' : 'a'}`,
    );

    const res = await http().get(tampered);

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(new RegExp(`^${CALLBACK}\\?error=`));
    expect(await verified('test-mail-bad@lineup.test')).toBe(false);
  });

  it('refuses to redirect to an untrusted site', async () => {
    await http().post('/auth/sign-up').send(account('evil'));
    const link = linkIn(sent[0]).replace(
      /callbackURL=[^&]+/,
      `callbackURL=${encodeURIComponent('https://evil.example/x')}`,
    );

    const res = await http().get(link);

    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
    expect(await verified('test-mail-evil@lineup.test')).toBe(false);
  });

  it('never mails a guest', async () => {
    const res = await http().post('/auth/guest');
    guests.push(res.body.data.user.id);

    expect(res.body.data.user).toMatchObject({
      isGuest: true,
      emailVerified: false,
    });
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('mails the new address after an upgrade', async () => {
    const guest = await http().post('/auth/guest');
    guests.push(guest.body.data.user.id);

    const res = await http()
      .post('/auth/upgrade')
      .set('Cookie', cookieHeader(guest))
      .send({ ...account('up'), email: 'TEST-MAIL-Up@lineup.test' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.emailVerified).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('test-mail-up@lineup.test');

    await http().get(linkIn(sent[0]));
    expect(await verified('test-mail-up@lineup.test')).toBe(true);
  });

  it('closes the native send route, so no one can trigger mail', async () => {
    await http().post('/auth/sign-up').send(account('spam'));
    mailer.send.mockClear();

    const res = await http()
      .post('/api/auth/send-verification-email')
      .send({ email: 'test-mail-spam@lineup.test' });

    expect(res.status).toBe(404);
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('still signs up when the mail cannot be sent', async () => {
    mailer.send.mockRejectedValueOnce(new Error('Resend refused the mail'));

    const res = await http().post('/auth/sign-up').send(account('down'));

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({
      handle: 'test-m-down',
      emailVerified: false,
    });
  });
});
