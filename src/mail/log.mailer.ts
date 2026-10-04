import { Logger } from '@nestjs/common';
import type { MailMessage, Mailer } from '@/mail/mailer.js';

// Development only: production requires a Resend key
export class LogMailer implements Mailer {
  private readonly logger = new Logger('Mail');

  send({ subject, text }: MailMessage): Promise<void> {
    // The body, never the recipient's address
    this.logger.log(`Not sent (no RESEND_API_KEY): "${subject}"\n${text}`);
    return Promise.resolve();
  }
}
