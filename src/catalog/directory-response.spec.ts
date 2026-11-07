import type { Request, Response } from 'express';
import { sendDirectory } from '@/catalog/directory-response.js';
import type { BuiltDirectory } from '@/catalog/player-directory.service.js';

const BUILT: BuiltDirectory = {
  version: 'v',
  tag: '"tag-1"',
  playerCount: 1,
  bodies: {
    identity: Buffer.from('{"success":true}'),
    gzip: Buffer.from('gz'),
    br: Buffer.from('b'),
  },
};

function exchange(headers: Record<string, string>) {
  const sent = { status: 0, headers: new Map<string, unknown>(), body: null };
  const res = {
    setHeader: (name: string, value: unknown) => sent.headers.set(name, value),
    status: (code: number) => {
      sent.status = code;
      return res;
    },
    end: (body?: Buffer) => {
      sent.body = (body ?? null) as never;
    },
  };
  sendDirectory(
    { headers } as unknown as Request,
    res as unknown as Response,
    BUILT,
  );
  return sent;
}

describe('sendDirectory', () => {
  it('sends the Brotli body with its caching headers', () => {
    const sent = exchange({ 'accept-encoding': 'gzip, br' });
    expect(sent.status).toBe(200);
    expect(sent.body).toBe(BUILT.bodies.br);
    expect(Object.fromEntries(sent.headers)).toEqual({
      ETag: '"tag-1"',
      'Cache-Control': 'private, no-cache',
      Vary: 'Accept-Encoding',
      'Content-Encoding': 'br',
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': 1,
    });
  });

  it('sends gzip when Brotli is not accepted', () => {
    const sent = exchange({ 'accept-encoding': 'gzip' });
    expect(sent.body).toBe(BUILT.bodies.gzip);
    expect(sent.headers.get('Content-Encoding')).toBe('gzip');
  });

  it('sends plain JSON with no Content-Encoding otherwise', () => {
    const sent = exchange({});
    expect(sent.body).toBe(BUILT.bodies.identity);
    expect(sent.headers.has('Content-Encoding')).toBe(false);
    expect(sent.headers.get('Content-Length')).toBe(16);
  });

  it('answers 304 with no body on a matching If-None-Match', () => {
    const sent = exchange({
      'if-none-match': '"tag-1"',
      'accept-encoding': 'br',
    });
    expect(sent.status).toBe(304);
    expect(sent.body).toBeNull();
    expect(sent.headers.get('ETag')).toBe('"tag-1"');
    expect(sent.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(sent.headers.has('Content-Encoding')).toBe(false);
  });

  it('sends the body on a stale If-None-Match', () => {
    const sent = exchange({ 'if-none-match': '"tag-0"' });
    expect(sent.status).toBe(200);
    expect(sent.body).toBe(BUILT.bodies.identity);
  });
});
