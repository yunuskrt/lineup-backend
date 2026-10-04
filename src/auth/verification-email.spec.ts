import {
  VERIFICATION_SUBJECT,
  verificationEmail,
} from '@/auth/verification-email.js';

describe('verificationEmail', () => {
  const URL =
    'http://localhost:8080/api/auth/verify-email?token=a.b&callbackURL=x';
  const mail = verificationEmail('fan@lineup.gg', URL);

  it('is addressed to the player, with a fixed subject', () => {
    expect(mail.to).toBe('fan@lineup.gg');
    expect(mail.subject).toBe(VERIFICATION_SUBJECT);
  });

  it('carries the link as-is in the text part', () => {
    expect(mail.text).toContain(URL);
  });

  it('escapes the link in the HTML part', () => {
    expect(mail.html).toContain('token=a.b&amp;callbackURL=x');
    expect(mail.html).not.toContain('&callbackURL');
  });

  it('never repeats the address in the body', () => {
    expect(mail.text).not.toContain('fan@lineup.gg');
    expect(mail.html).not.toContain('fan@lineup.gg');
  });
});
