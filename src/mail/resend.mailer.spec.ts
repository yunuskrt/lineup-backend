import { ResendMailer } from '@/mail/resend.mailer.js';

const MESSAGE = {
  to: 'fan@lineup.gg',
  subject: 'Confirm your Lineup email',
  text: 'text body',
  html: '<p>html body</p>',
};

describe('ResendMailer', () => {
  const request = vi.fn<typeof fetch>();
  const mailer = new ResendMailer(
    're_test_key',
    'Lineup <onboarding@resend.dev>',
    request,
  );

  beforeEach(() => {
    request.mockReset();
  });

  it('posts the message to Resend with the API key', async () => {
    request.mockResolvedValue(new Response('{"id":"m-1"}', { status: 200 }));

    await mailer.send(MESSAGE);

    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer re_test_key',
        'Content-Type': 'application/json',
      },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init?.body as string)).toEqual({
      from: 'Lineup <onboarding@resend.dev>',
      to: ['fan@lineup.gg'],
      subject: MESSAGE.subject,
      text: MESSAGE.text,
      html: MESSAGE.html,
    });
  });

  it('throws on a refusal, with the status and not the body', async () => {
    request.mockResolvedValue(
      new Response('{"message":"You can only send to fan@lineup.gg"}', {
        status: 403,
      }),
    );

    const error = await mailer.send(MESSAGE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Resend refused the mail with 403');
    expect((error as Error).message).not.toContain('fan@');
  });

  it('passes a network failure on', async () => {
    request.mockRejectedValue(new TypeError('fetch failed'));

    await expect(mailer.send(MESSAGE)).rejects.toThrow('fetch failed');
  });
});
