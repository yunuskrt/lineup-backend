import { applyDecorators } from '@nestjs/common';
import { ApiCookieAuth, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { failureDoc } from '@/common/contract-response.js';

export const SESSION_SCHEME = 'session';

// Docs only: SessionGuard does the checking
export const DocumentsSession = () =>
  applyDecorators(
    ApiCookieAuth(SESSION_SCHEME),
    ApiUnauthorizedResponse({
      description: 'No session: sign in or continue as a guest',
      schema: failureDoc(),
    }),
  );
