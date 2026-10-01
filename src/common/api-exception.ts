import { HttpStatus } from '@nestjs/common';
import type {
  ApiError,
  ApiErrorCode,
  EmptyPoolReason,
} from '@/contract/envelope.js';

export type ServerErrorCode = Exclude<ApiErrorCode, 'network'>;

// HttpStatus has no 426 Upgrade Required
const UPGRADE_REQUIRED = 426;

const STATUS_BY_CODE: Record<ServerErrorCode, number> = {
  unauthorized: HttpStatus.UNAUTHORIZED,
  forbidden: HttpStatus.FORBIDDEN,
  not_found: HttpStatus.NOT_FOUND,
  invalid_input: HttpStatus.BAD_REQUEST,
  empty_pool: HttpStatus.UNPROCESSABLE_ENTITY,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
  session_over: HttpStatus.CONFLICT,
  server_error: HttpStatus.INTERNAL_SERVER_ERROR,
  protocol_refused: UPGRADE_REQUIRED,
};

export const SERVER_ERROR_MESSAGE = 'Something went wrong. Please try again.';

type ApiErrorExtras = {
  retryAfterMs?: number;
  emptyBecause?: EmptyPoolReason;
};

export class ApiException extends Error {
  readonly status: number;
  readonly error: ApiError;

  constructor(
    code: ServerErrorCode,
    message: string,
    extras: ApiErrorExtras = {},
  ) {
    super(message);
    this.status = STATUS_BY_CODE[code];
    this.error = {
      code,
      message,
      retryAfterMs: extras.retryAfterMs ?? null,
      ...(extras.emptyBecause && { emptyBecause: extras.emptyBecause }),
    };
  }
}
