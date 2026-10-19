import { type ArgumentsHost, Logger } from '@nestjs/common';
import { ApiException, SERVER_ERROR_MESSAGE } from '@/common/api-exception.js';
import { socketAckSchema } from '@/contract/socket.js';
import {
  handshakeRefusal,
  SocketEnvelopeFilter,
  socketError,
} from '@/duel/socket-envelope.filter.js';

const SERVER_ERROR = {
  code: 'server_error',
  message: SERVER_ERROR_MESSAGE,
  retryAfterMs: null,
};

// Nest's ws host: [socket, data, ack, pattern]
function hostWith(ack: unknown) {
  const emit = vi.fn();
  const args = [{ emit }, { guess: 'Zlatan' }, ack, 'duel:guess'];
  const host = {
    getArgByIndex: (index: number) => args[index],
    switchToWs: () => ({ getClient: () => args[0] }),
  } as unknown as ArgumentsHost;
  return { host, emit };
}

describe('socketError', () => {
  let logError: ReturnType<typeof vi.spyOn>;
  const logger = new Logger('Test');

  beforeEach(() => {
    logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logError.mockRestore();
  });

  it('keeps an ApiException as its own error', () => {
    const error = new ApiException('rate_limited', 'Slow down.', {
      retryAfterMs: 2_000,
    });
    expect(socketError(error, logger)).toEqual({
      code: 'rate_limited',
      message: 'Slow down.',
      retryAfterMs: 2_000,
    });
    expect(logError).not.toHaveBeenCalled();
  });

  it('turns a malformed ApiException into server_error', () => {
    // rate_limited needs a retryAfterMs
    const error = new ApiException('rate_limited', 'Slow down.');
    expect(socketError(error, logger)).toEqual(SERVER_ERROR);
    expect(logError).toHaveBeenCalledWith(
      'Malformed ApiException with code rate_limited',
    );
  });

  it('logs anything else by its class name only', () => {
    const error = new TypeError('squad: Ronaldinho, Xavi, Puyol');
    expect(socketError(error, logger)).toEqual(SERVER_ERROR);
    expect(logError).toHaveBeenCalledWith('Socket handler failed: TypeError');
    expect(JSON.stringify(logError.mock.calls)).not.toContain('Ronaldinho');
  });

  it('names a thrown non-error by its type', () => {
    expect(socketError('squad text', logger)).toEqual(SERVER_ERROR);
    expect(logError).toHaveBeenCalledWith('Socket handler failed: string');
  });
});

describe('handshakeRefusal', () => {
  it('carries the code as the message and the envelope as data', () => {
    const error = {
      code: 'protocol_refused' as const,
      message: 'Update to keep playing.',
      retryAfterMs: null,
    };
    const refusal = handshakeRefusal(error);
    expect(refusal.message).toBe('protocol_refused');
    expect(refusal.data).toEqual({ success: false, error });
    expect(socketAckSchema.safeParse(refusal.data).success).toBe(true);
  });
});

describe('SocketEnvelopeFilter', () => {
  const filter = new SocketEnvelopeFilter();
  const forbidden = new ApiException('forbidden', 'Not your turn.');

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers the ack with the failure envelope', () => {
    const ack = vi.fn();
    const { host, emit } = hostWith(ack);
    filter.catch(forbidden, host);

    expect(ack).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'forbidden',
        message: 'Not your turn.',
        retryAfterMs: null,
      },
    });
    expect(socketAckSchema.safeParse(ack.mock.calls[0][0]).success).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });

  it('answers an unexpected error with server_error', () => {
    const ack = vi.fn();
    filter.catch(new Error('boom'), hostWith(ack).host);
    expect(ack).toHaveBeenCalledWith({ success: false, error: SERVER_ERROR });
  });

  it('emits an error event when there is no ack, never throwing', () => {
    const { host, emit } = hostWith(undefined);
    expect(() => filter.catch(forbidden, host)).not.toThrow();
    expect(emit).toHaveBeenCalledWith('error', forbidden.error);
  });
});
