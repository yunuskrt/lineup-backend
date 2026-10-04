import { Logger, Module } from '@nestjs/common';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import { LogMailer } from '@/mail/log.mailer.js';
import { MAILER, type Mailer } from '@/mail/mailer.js';
import { ResendMailer } from '@/mail/resend.mailer.js';

export function createMailer(env: Env, logger = new Logger('Mail')): Mailer {
  if (env.RESEND_API_KEY) {
    logger.log('Sending mail through Resend');
    return new ResendMailer(env.RESEND_API_KEY, env.MAIL_FROM);
  }
  logger.warn('No RESEND_API_KEY: mail goes to the log');
  return new LogMailer();
}

@Module({
  providers: [{ provide: MAILER, inject: [ENV], useFactory: createMailer }],
  exports: [MAILER],
})
export class MailModule {}
