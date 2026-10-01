import {
  type ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ApiException } from '@/common/api-exception.js';
import { EnvelopeExceptionFilter } from '@/common/envelope-exception.filter.js';

function httpHost() {
  const response = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

function respond(exception: unknown) {
  const { host, response } = httpHost();
  new EnvelopeExceptionFilter().catch(exception, host);
  const [[status]] = response.status.mock.calls;
  const [[body]] = response.json.mock.calls;
  return { status, body };
}

describe('EnvelopeExceptionFilter', () => {
  let logError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logError.mockRestore();
  });

  it('sends an ApiException with its own status and extras', () => {
    const exception = new ApiException('rate_limited', 'Slow down.', {
      retryAfterMs: 1_500,
    });
    expect(respond(exception)).toEqual({
      status: 429,
      body: {
        success: false,
        error: {
          code: 'rate_limited',
          message: 'Slow down.',
          retryAfterMs: 1_500,
        },
      },
    });
  });

  it('downgrades an ApiException that breaks the ApiError rules', () => {
    const { status, body } = respond(new ApiException('empty_pool', 'Empty.'));
    expect(status).toBe(500);
    expect(body.error.code).toBe('server_error');
  });

  it('maps framework 404s to not_found with a fixed message', () => {
    const { status, body } = respond(
      new NotFoundException('Cannot GET /x?a=1'),
    );
    expect(status).toBe(404);
    expect(body.error).toEqual({
      code: 'not_found',
      message: 'Not found.',
      retryAfterMs: null,
    });
  });

  it.each([
    ['413', new PayloadTooLargeException(), 413],
    ['405', new HttpException('nope', HttpStatus.METHOD_NOT_ALLOWED), 405],
    ['415', new HttpException('nope', HttpStatus.UNSUPPORTED_MEDIA_TYPE), 415],
  ])(
    'keeps a %s as invalid_input without logging a stack',
    (_, exception, code) => {
      const { status, body } = respond(exception);
      expect(status).toBe(code);
      expect(body.error.code).toBe('invalid_input');
      expect(logError).not.toHaveBeenCalled();
    },
  );

  it('treats a bare 429 as server_error until B35 supplies retryAfterMs', () => {
    const { status, body } = respond(
      new HttpException('slow', HttpStatus.TOO_MANY_REQUESTS),
    );
    expect(status).toBe(500);
    expect(body.error.code).toBe('server_error');
  });

  it('hides an unknown error and logs it server-side only', () => {
    const { status, body } = respond(new Error('password=hunter2'));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(logError).toHaveBeenCalledOnce();
  });

  it('never emits the client-only network code', () => {
    const codes = [
      new ApiException('not_found', 'x'),
      new NotFoundException(),
      new Error('x'),
      'thrown string',
    ].map((exception) => respond(exception).body.error.code);
    expect(codes).not.toContain('network');
  });

  it('rethrows outside HTTP so the socket layer can handle it', () => {
    const host = { getType: () => 'ws' } as unknown as ArgumentsHost;
    const exception = new Error('socket');
    expect(() => new EnvelopeExceptionFilter().catch(exception, host)).toThrow(
      exception,
    );
  });
});
