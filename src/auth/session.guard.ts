import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Response } from 'express';
import { AuthFlowService, NO_SESSION } from '@/auth/auth-flow.service.js';
import type { RequestWithUser } from '@/auth/current-user.decorator.js';
import { IS_PUBLIC } from '@/auth/public.decorator.js';
import { ApiException } from '@/common/api-exception.js';

// Global: a session is required unless @Public()
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthFlowService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // The socket gateway checks its own handshake
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithUser>();
    const { data, cookies } = await this.auth.getSession(
      fromNodeHeaders(request.headers),
    );
    // A refresh or expiry cookie must reach the client
    if (cookies.length > 0) {
      http.getResponse<Response>().append('Set-Cookie', cookies);
    }
    if (!data) throw new ApiException('unauthorized', NO_SESSION);
    request.currentUser = data.user;
    return true;
  }
}
