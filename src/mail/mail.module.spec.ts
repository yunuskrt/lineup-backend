import { Logger } from '@nestjs/common';
import type { Env } from '@/config/env.schema.js';
import { LogMailer } from '@/mail/log.mailer.js';
import { createMailer } from '@/mail/mail.module.js';
import { ResendMailer } from '@/mail/resend.mailer.js';

describe('createMailer', () => {
  const logger = new Logger('test');
  const env = { MAIL_FROM: 'Lineup <onboarding@resend.dev>' } as Env;
  const log = vi.spyOn(logger, 'log');
  const warn = vi.spyOn(logger, 'warn');

  beforeEach(() => {
    log.mockReset().mockImplementation(() => undefined);
    warn.mockReset().mockImplementation(() => undefined);
  });

  it('sends through Resend when a key is set', () => {
    const mailer = createMailer({ ...env, RESEND_API_KEY: 're_k' }, logger);
    expect(mailer).toBeInstanceOf(ResendMailer);
    expect(log).toHaveBeenCalledWith('Sending mail through Resend');
  });

  it('falls back to the log, and says so, without a key', () => {
    const mailer = createMailer(env, logger);
    expect(mailer).toBeInstanceOf(LogMailer);
    expect(warn).toHaveBeenCalledWith(
      'No RESEND_API_KEY: mail goes to the log',
    );
  });

  it('never logs the key', () => {
    createMailer({ ...env, RESEND_API_KEY: 're_secret' }, logger);
    expect(JSON.stringify(log.mock.calls)).not.toContain('re_secret');
  });
});

describe('LogMailer', () => {
  it('logs the subject and body, never the address', async () => {
    const log = vi
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    await new LogMailer().send({
      to: 'fan@lineup.gg',
      subject: 'Confirm your Lineup email',
      text: 'open http://localhost:8080/api/auth/verify-email?token=t',
      html: '<p>ignored</p>',
    });

    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain('Confirm your Lineup email');
    expect(logged).toContain('verify-email?token=t');
    expect(logged).not.toContain('fan@lineup.gg');
  });
});
