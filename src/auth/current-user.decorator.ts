import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@/contract/auth.js';

// Set by SessionGuard, from the session only
export type RequestWithUser = Request & { currentUser?: User };

export function currentUserFrom(context: ExecutionContext): User {
  const { currentUser } = context.switchToHttp().getRequest<RequestWithUser>();
  // Only a guarded route has one
  if (!currentUser) throw new Error('@CurrentUser() needs a guarded route');
  return currentUser;
}

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext) => currentUserFrom(context),
);
