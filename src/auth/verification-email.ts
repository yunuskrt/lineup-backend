import type { MailMessage } from '@/mail/mailer.js';

export const VERIFICATION_SUBJECT = 'Confirm your Lineup email';

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

// One link, no tracking, no images
export function verificationEmail(to: string, url: string): MailMessage {
  const href = escapeHtml(url);
  return {
    to,
    subject: VERIFICATION_SUBJECT,
    text: [
      'Confirm your email for Lineup by opening this link:',
      url,
      'It works for 24 hours. If you did not sign up, ignore this email.',
    ].join('\n\n'),
    html: [
      '<p>Confirm your email for Lineup:</p>',
      `<p><a href="${href}">Confirm my email</a></p>`,
      `<p>Or paste this link into your browser:<br>${href}</p>`,
      '<p>It works for 24 hours. If you did not sign up, ignore this email.</p>',
    ].join('\n'),
  };
}
