import { applyDecorators } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { failureDoc } from '@/common/contract-response.js';

export const SESSION_SCHEME = 'session';
export const BEARER_SCHEME = 'bearer';

// Mobile keeps it; the web ignores it
export const AUTH_TOKEN_DOC = {
  'set-auth-token': {
    description: 'The session token, for Authorization: Bearer',
    schema: { type: 'string' },
  },
};

// Docs only: SessionGuard does the checking
export const DocumentsSession = () =>
  applyDecorators(
    // Either credential: cookie (web) or bearer (mobile)
    ApiCookieAuth(SESSION_SCHEME),
    ApiBearerAuth(BEARER_SCHEME),
    ApiUnauthorizedResponse({
      description: 'No session: sign in or continue as a guest',
      schema: failureDoc(),
    }),
  );
