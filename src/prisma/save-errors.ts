import { Prisma } from '@/generated/prisma/client.js';

const UNIQUE_VIOLATION = 'P2002';

// The game id is the key: a second save collides
export function isAlreadySaved(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_VIOLATION
  );
}

// The code or class only: never the rows
export function failureKind(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  return error instanceof Error ? error.name : 'unknown';
}
