import { Prisma } from '@/generated/prisma/client.js';
import { failureKind, isAlreadySaved } from '@/prisma/save-errors.js';

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('failed', {
    code,
    clientVersion: 'test',
  });

describe('isAlreadySaved', () => {
  it('reads a unique violation as already saved', () => {
    expect(isAlreadySaved(known('P2002'))).toBe(true);
  });

  it.each([
    ['another Prisma code', known('P2003')],
    ['a plain error', new Error('P2002')],
    ['a non-error throw', 'P2002'],
  ])('reads %s as a failure', (_, error) => {
    expect(isAlreadySaved(error)).toBe(false);
  });
});

describe('failureKind', () => {
  it.each([
    ['a Prisma code', known('P2003'), 'P2003'],
    ['an error class', new TypeError('guess "zulu"'), 'TypeError'],
    ['a non-error throw', { text: 'zulu' }, 'unknown'],
  ])('names %s and nothing else', (_, error, kind) => {
    expect(failureKind(error)).toBe(kind);
  });
});
