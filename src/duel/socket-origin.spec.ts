import type { IncomingMessage } from 'node:http';
import { ORIGIN_REFUSED } from '@/common/origin-check.middleware.js';
import { isTrustedOrigin, originGate } from '@/duel/socket-origin.js';

const TRUSTED = ['http://localhost:3000', 'http://localhost:8080'];

describe('isTrustedOrigin', () => {
  it('passes a request with no Origin, as mobile sends', () => {
    expect(isTrustedOrigin(undefined, TRUSTED)).toBe(true);
  });

  it("passes the web app's origin", () => {
    expect(isTrustedOrigin('http://localhost:3000', TRUSTED)).toBe(true);
  });

  it.each([
    'https://evil.example',
    'http://localhost:3000.evil.example',
    'http://localhost:3001',
    'null',
    '',
  ])('refuses %s', (origin) => {
    expect(isTrustedOrigin(origin, TRUSTED)).toBe(false);
  });
});

describe('originGate', () => {
  const decide = (origin?: string) => {
    const callback = vi.fn();
    const req = { headers: { origin } } as unknown as IncomingMessage;
    originGate(TRUSTED)(req, callback);
    return callback;
  };

  it('lets a trusted request through with no error', () => {
    expect(decide('http://localhost:3000')).toHaveBeenCalledWith(null, true);
  });

  it('refuses a foreign one with the safe message', () => {
    expect(decide('https://evil.example')).toHaveBeenCalledWith(
      ORIGIN_REFUSED,
      false,
    );
  });
});
