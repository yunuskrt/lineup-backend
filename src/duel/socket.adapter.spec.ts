import { createServer, type IncomingMessage } from 'node:http';
import type { INestApplicationContext } from '@nestjs/common';
import type { ServerOptions } from 'socket.io';
import { RECONNECT_WINDOW_MS } from '@/contract/constants.js';
import type { Env } from '@/config/env.schema.js';
import {
  LineupIoAdapter,
  MAX_FRAME_BYTES,
  socketServerOptions,
} from '@/duel/socket.adapter.js';

const ENV = {
  WEB_APP_URL: 'http://localhost:3000',
  BETTER_AUTH_URL: 'http://localhost:8080/api/auth',
} as Env;

function allows(origin: string | undefined) {
  const { allowRequest } = socketServerOptions(ENV);
  const decide = vi.fn();
  allowRequest?.({ headers: { origin } } as IncomingMessage, decide);
  return decide.mock.calls[0]?.[1] as boolean;
}

describe('socketServerOptions', () => {
  it('caps a frame at the REST body limit, 16 KB', () => {
    expect(socketServerOptions(ENV).maxHttpBufferSize).toBe(16_384);
    expect(MAX_FRAME_BYTES).toBe(16_384);
  });

  it('allows CORS for the web app only, with no credentials', () => {
    expect(socketServerOptions(ENV)).toMatchObject({
      serveClient: false,
      cors: { origin: ['http://localhost:3000'], credentials: false },
    });
  });

  it('notices a silent drop inside the 20 s window', () => {
    const { pingInterval = 0, pingTimeout = 0 } = socketServerOptions(ENV);
    expect(pingInterval).toBe(10_000);
    expect(pingTimeout).toBe(5_000);
    expect(pingInterval + pingTimeout).toBeLessThan(RECONNECT_WINDOW_MS);
  });

  it('trusts the web app and the API origin, as the REST check does', () => {
    expect(allows('http://localhost:3000')).toBe(true);
    expect(allows('http://localhost:8080')).toBe(true);
    expect(allows(undefined)).toBe(true);
    expect(allows('https://evil.example')).toBe(false);
  });
});

describe('LineupIoAdapter', () => {
  it("puts the env's options over a gateway's own", async () => {
    const http = createServer();
    const adapter = new LineupIoAdapter(
      http as unknown as INestApplicationContext,
      ENV,
    );
    const io = adapter.createIOServer(0, {
      maxHttpBufferSize: 10_000_000,
      serveClient: true,
      pingTimeout: 60_000,
      connectTimeout: 1_234,
    } as ServerOptions);

    expect(io.engine.opts.maxHttpBufferSize).toBe(MAX_FRAME_BYTES);
    expect(io.engine.opts.pingTimeout).toBe(5_000);
    // A key the env leaves alone is kept
    expect(io._connectTimeout).toBe(1_234);
    expect(io.serveClient()).toBe(false);
    await io.close();
  });
});
