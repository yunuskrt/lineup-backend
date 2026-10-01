import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiException,
  SERVER_ERROR_MESSAGE,
  type ServerErrorCode,
} from '@/common/api-exception.js';
import { apiErrorSchema, type ApiError } from '@/contract/envelope.js';

type Failure = { status: number; error: ApiError };

const SERVER_ERROR: Failure = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  error: {
    code: 'server_error',
    message: SERVER_ERROR_MESSAGE,
    retryAfterMs: null,
  },
};

// Framework-raised errors get a fixed, safe message
const FROM_HTTP_STATUS: Partial<
  Record<number, { code: ServerErrorCode; message: string }>
> = {
  [HttpStatus.BAD_REQUEST]: {
    code: 'invalid_input',
    message: 'The request was not valid.',
  },
  [HttpStatus.UNAUTHORIZED]: {
    code: 'unauthorized',
    message: 'Please sign in to continue.',
  },
  [HttpStatus.FORBIDDEN]: {
    code: 'forbidden',
    message: 'That is not allowed right now.',
  },
  [HttpStatus.NOT_FOUND]: { code: 'not_found', message: 'Not found.' },
};

// Other 4xx stay the client's fault; 429 waits for B35
function clientError(status: number) {
  const isClientError = status >= 400 && status < 500;
  if (!isClientError || status === HttpStatus.TOO_MANY_REQUESTS) return null;
  return FROM_HTTP_STATUS[HttpStatus.BAD_REQUEST] ?? null;
}

@Catch()
export class EnvelopeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Envelope');

  catch(exception: unknown, host: ArgumentsHost): void {
    // Socket errors get their own envelope (B36)
    if (host.getType() !== 'http') throw exception;

    const { status, error } = this.toFailure(exception);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ success: false, error });
  }

  private toFailure(exception: unknown): Failure {
    if (exception instanceof ApiException) {
      const parsed = apiErrorSchema.safeParse(exception.error);
      if (parsed.success) {
        return { status: exception.status, error: parsed.data };
      }
      this.logger.error(
        `Malformed ApiException with code ${exception.error.code}`,
      );
      return SERVER_ERROR;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const known = FROM_HTTP_STATUS[status] ?? clientError(status);
      if (known) return { status, error: { ...known, retryAfterMs: null } };
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );
    return SERVER_ERROR;
  }
}
