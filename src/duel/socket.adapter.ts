import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { Server, ServerOptions } from 'socket.io';
import { trustedOrigins } from '@/common/origin-check.middleware.js';
import type { Env } from '@/config/env.schema.js';
import { originGate } from '@/duel/socket-origin.js';

// The REST body limit, 16 KB
export const MAX_FRAME_BYTES = 16_384;

// A silent drop shows inside the 20 s window
export const PING_INTERVAL_MS = 10_000;
export const PING_TIMEOUT_MS = 5_000;

export function socketServerOptions(env: Env): Partial<ServerOptions> {
  return {
    serveClient: false,
    maxHttpBufferSize: MAX_FRAME_BYTES,
    pingInterval: PING_INTERVAL_MS,
    pingTimeout: PING_TIMEOUT_MS,
    // A token, not a cookie, carries the user
    cors: { origin: [env.WEB_APP_URL], credentials: false },
    allowRequest: originGate(trustedOrigins(env)),
  };
}

export class LineupIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly env: Env,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    return super.createIOServer(port, {
      ...options,
      ...socketServerOptions(this.env),
    } as ServerOptions);
  }
}
