import type { MailMessage, Mailer } from '@/mail/mailer.js';

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  async send({ to, subject, text, html }: MailMessage): Promise<void> {
    const res = await this.request(RESEND_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: this.from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // Status only: Resend's body may echo the address
    if (!res.ok) throw new Error(`Resend refused the mail with ${res.status}`);
  }
}
