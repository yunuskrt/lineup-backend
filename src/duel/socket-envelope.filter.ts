import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  Logger,
} from '@nestjs/common';
import type { ExtendedError, Socket } from 'socket.io';
import { ApiException, SERVER_ERROR_MESSAGE } from '@/common/api-exception.js';
import { apiErrorSchema, type ApiError } from '@/contract/envelope.js';
import type { SocketAck } from '@/contract/socket.js';

const SERVER_ERROR: ApiError = {
  code: 'server_error',
  message: SERVER_ERROR_MESSAGE,
  retryAfterMs: null,
};

const nameOf = (error: unknown) =>
  error instanceof Error ? error.constructor.name : typeof error;

// Logs the class only: a payload may hold the squad
export function socketError(error: unknown, logger: Logger): ApiError {
  if (error instanceof ApiException) {
    const parsed = apiErrorSchema.safeParse(error.error);
    if (parsed.success) return parsed.data;
    logger.error(`Malformed ApiException with code ${error.error.code}`);
    return SERVER_ERROR;
  }
  logger.error(`Socket handler failed: ${nameOf(error)}`);
  return SERVER_ERROR;
}

export const failureAck = (error: ApiError): SocketAck => ({
  success: false,
  error,
});

// connect_error: message is the code, data the ack
export function handshakeRefusal(error: ApiError): ExtendedError {
  const refusal: ExtendedError = new Error(error.code);
  refusal.data = failureAck(error);
  return refusal;
}

// Args are [socket, data, ack, pattern]
const ACK_INDEX = 2;

// Gateway-scoped: no global filter runs on sockets
@Catch()
export class SocketEnvelopeFilter implements ExceptionFilter {
  private readonly logger = new Logger('SocketEnvelope');

  catch(exception: unknown, host: ArgumentsHost): void {
    const error = socketError(exception, this.logger);
    const ack: unknown = host.getArgByIndex(ACK_INDEX);
    if (typeof ack === 'function') {
      ack(failureAck(error));
      return;
    }
    // No ack to answer: never fail silently
    host.switchToWs().getClient<Socket>().emit('error', error);
  }
}
