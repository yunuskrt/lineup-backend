import { HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { matchesTag, pickEncoding } from '@/catalog/player-directory.js';
import type { BuiltDirectory } from '@/catalog/player-directory.service.js';

// The browser keeps it, but asks before reuse
export const DIRECTORY_CACHE_CONTROL = 'private, no-cache';

export const DIRECTORY_HEADERS = {
  ETag: { description: 'The directory version', schema: { type: 'string' } },
  'Cache-Control': {
    description: DIRECTORY_CACHE_CONTROL,
    schema: { type: 'string' },
  },
};

export function sendDirectory(
  req: Request,
  res: Response,
  built: BuiltDirectory,
): void {
  res.setHeader('ETag', built.tag);
  res.setHeader('Cache-Control', DIRECTORY_CACHE_CONTROL);
  res.setHeader('Vary', 'Accept-Encoding');
  if (matchesTag(req.headers['if-none-match'], built.tag)) {
    res.status(HttpStatus.NOT_MODIFIED).end();
    return;
  }

  const encoding = pickEncoding(req.headers['accept-encoding']);
  const body = built.bodies[encoding];
  if (encoding !== 'identity') res.setHeader('Content-Encoding', encoding);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.status(HttpStatus.OK).end(body);
}
