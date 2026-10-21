import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AuthService } from '@thallesp/nestjs-better-auth';
import type { Socket } from 'socket.io-client';
import request from 'supertest';
import { AppModule } from '@/app.module.js';
import { NO_SESSION } from '@/auth/auth-flow.service.js';
import type { Auth } from '@/auth/auth.factory.js';
import { loadEnv } from '@/config/load-env.js';
import { apiErrorSchema } from '@/contract/envelope.js';
import { PROTOCOL_VERSION } from '@/contract/protocol.js';
import { socketAckSchema } from '@/contract/socket.js';
import { REPLACED, UNKNOWN_COMMAND } from '@/duel/duel.gateway.js';
import {
  DUEL_PLAY_MESSAGES,
  DUEL_START_MESSAGES,
} from '@/duel/duel-messages.js';
import { OUT_OF_DATE } from '@/duel/socket-auth.service.js';
import { LineupIoAdapter, MAX_FRAME_BYTES } from '@/duel/socket.adapter.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import {
  ackOf,
  connected,
  nextEvent,
  openSocket,
  type Refusal,
  recordEvents,
  refusalOf,
} from '@test/duel/socket-client.js';

const VALID_FILTERS = {
  competitionIds: [],
  clubIds: [],
  era: { from: 2000, to: 2025 },
};
const NOW_S = () => Math.floor(Date.now() / 1000);

const cookieHeader = (res: request.Response) =>
  [res.headers['set-cookie'] ?? []]
    .flat()
    .map((c) => c.split(';')[0])
    .join('; ');

const failure = (code: string, message: string) => ({
  success: false,
  error: { code, message, retryAfterMs: null },
});

describe('Duel gateway (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let auth: AuthService<Auth>;
  let url: string;
  let webOrigin: string;
  const guests: string[] = [];
  const sockets: Socket[] = [];
  // Every ack and refusal, for the leak check
  const seen: unknown[] = [];
  const tokensIssued: string[] = [];

  const http = () => request(app.getHttpServer());

  async function guest() {
    const res = await http().post('/auth/guest');
    const id = res.body.data.user.id as string;
    guests.push(id);
    return { id, cookie: cookieHeader(res) };
  }

  async function tokenFor(cookie: string) {
    const res = await http().get('/auth/token').set('Cookie', cookie);
    const token = res.body.data.token as string;
    tokensIssued.push(token);
    return token;
  }

  function open(handshake: object, options = {}) {
    const socket = openSocket(url, handshake, options);
    sockets.push(socket);
    return socket;
  }

  // A fresh guest, connected at version N
  async function player() {
    const { id, cookie } = await guest();
    const token = await tokenFor(cookie);
    const socket = await connected(
      open({ token, protocolVersion: PROTOCOL_VERSION }),
    );
    return { id, cookie, token, socket };
  }

  async function ack(socket: Socket, event: string, ...args: unknown[]) {
    const result = await ackOf(socket, event, ...args);
    seen.push(result);
    expect(socketAckSchema.safeParse(result).success).toBe(true);
    return result;
  }

  async function refused(handshake: object, options = {}): Promise<Refusal> {
    const refusal = await refusalOf(open(handshake, options));
    seen.push(refusal);
    return refusal;
  }

  beforeAll(async () => {
    const env = loadEnv();
    if (!env.success) throw new Error('E2E needs a valid .env');
    webOrigin = env.data.WEB_APP_URL;
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useWebSocketAdapter(new LineupIoAdapter(app, env.data));
    await app.listen(0, '127.0.0.1');
    const { port } = app.getHttpServer().address() as AddressInfo;
    url = `http://127.0.0.1:${port}`;
    prisma = app.get(PrismaService);
    auth = app.get<AuthService<Auth>>(AuthService);
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: guests } } });
    await app.close();
  });

  describe('an accepted handshake', () => {
    it('connects a guest at version N, and its commands reach the gateway', async () => {
      const { socket } = await player();
      expect(socket.connected).toBe(true);
      // Guards or the HTTP interceptor would break this
      expect(await ack(socket, 'duel:forfeit')).toEqual(
        failure('forbidden', DUEL_PLAY_MESSAGES.noDuel),
      );
    });

    it('connects over the WebSocket transport alone', async () => {
      const { cookie } = await guest();
      const socket = await connected(
        open(
          { token: await tokenFor(cookie), protocolVersion: PROTOCOL_VERSION },
          { transports: ['websocket'] },
        ),
      );
      expect(socket.io.engine.transport.name).toBe('websocket');
    });
  });

  describe('the version gate', () => {
    it.each([
      ['N-2', { protocolVersion: PROTOCOL_VERSION - 2 }],
      ['N+1', { protocolVersion: PROTOCOL_VERSION + 1 }],
      ['a missing version', {}],
      ['a string version', { protocolVersion: String(PROTOCOL_VERSION) }],
    ])('refuses %s with protocol_refused', async (_, version) => {
      const { cookie } = await guest();
      const token = await tokenFor(cookie);
      const refusal = await refused({ token, ...version });
      expect(refusal).toEqual({
        message: 'protocol_refused',
        data: failure('protocol_refused', OUT_OF_DATE),
      });
    });

    it('checks the version before the token', async () => {
      const refusal = await refused({
        token: 'not-a-token',
        protocolVersion: PROTOCOL_VERSION - 2,
      });
      expect(refusal.message).toBe('protocol_refused');
    });
  });

  describe('the token gate', () => {
    const unauthorized = {
      message: 'unauthorized',
      data: failure('unauthorized', NO_SESSION),
    };

    it('refuses a missing token', async () => {
      expect(await refused({ protocolVersion: PROTOCOL_VERSION })).toEqual(
        unauthorized,
      );
    });

    it('refuses a tampered token', async () => {
      const { cookie } = await guest();
      const token = await tokenFor(cookie);
      const tampered = `${token.slice(0, -2)}${token.endsWith('AA') ? 'BB' : 'AA'}`;
      expect(
        await refused({ token: tampered, protocolVersion: PROTOCOL_VERSION }),
      ).toEqual(unauthorized);
    });

    it('refuses an expired token', async () => {
      const { id } = await guest();
      const { token } = await auth.api.signJWT({
        body: { payload: { sub: id, iat: NOW_S() - 600, exp: NOW_S() - 60 } },
      });
      expect(
        await refused({ token, protocolVersion: PROTOCOL_VERSION }),
      ).toEqual(unauthorized);
    });

    it('refuses a good token whose user was deleted', async () => {
      const { id, cookie } = await guest();
      const token = await tokenFor(cookie);
      await prisma.user.delete({ where: { id } });
      expect(
        await refused({ token, protocolVersion: PROTOCOL_VERSION }),
      ).toEqual(unauthorized);
    });
  });

  describe('the origin check', () => {
    async function handshakeFrom(
      origin: string | undefined,
      transport: string,
    ) {
      const { cookie } = await guest();
      const token = await tokenFor(cookie);
      return open(
        { token, protocolVersion: PROTOCOL_VERSION },
        {
          transports: [transport],
          ...(origin && { extraHeaders: { Origin: origin } }),
        },
      );
    }

    it.each(['polling', 'websocket'])(
      'refuses a foreign Origin before the handshake, over %s',
      async (transport) => {
        const socket = await handshakeFrom('https://evil.example', transport);
        const refusal = await refusalOf(socket);
        // Not an envelope: no handshake work was done
        expect(refusal.data).toBeUndefined();
        expect(refusal.message).not.toBe('unauthorized');
      },
    );

    it('connects with no Origin, as mobile does', async () => {
      const socket = await handshakeFrom(undefined, 'websocket');
      await expect(connected(socket)).resolves.toBe(socket);
    });

    it("connects from the web app's origin", async () => {
      const socket = await handshakeFrom(webOrigin, 'polling');
      await expect(connected(socket)).resolves.toBe(socket);
    });
  });

  describe('one socket per user', () => {
    it('lets the newer connection in and closes the older one', async () => {
      const first = await player();
      const replacedBy = nextEvent(first.socket, 'error');
      const closed = nextEvent<string>(first.socket, 'disconnect');

      const opened = open({
        token: await tokenFor(first.cookie),
        protocolVersion: PROTOCOL_VERSION,
      });
      const heard = recordEvents(opened);
      const second = await connected(opened);

      expect(apiErrorSchema.parse(await replacedBy)).toEqual({
        code: 'forbidden',
        message: REPLACED,
        retryAfterMs: null,
      });
      expect(await closed).toBe('io server disconnect');
      expect(second.connected).toBe(true);
      expect(await ack(second, 'duel:forfeit')).toEqual(
        failure('forbidden', DUEL_PLAY_MESSAGES.noDuel),
      );
      // The takeover notice is for the old socket only
      expect(heard).toEqual([]);
    });

    it('leaves another user connected', async () => {
      const one = await player();
      const other = await player();
      expect(one.socket.connected && other.socket.connected).toBe(true);
    });
  });

  describe('commands', () => {
    it('refuses a bad payload with invalid_input, naming fields only', async () => {
      const { socket } = await player();
      const result = await ack(socket, 'filters:submit', {
        competitionIds: 'all',
        era: { from: 2025, to: 1999 },
      });
      expect(result).toMatchObject({
        success: false,
        error: { code: 'invalid_input' },
      });
      expect(JSON.stringify(result)).not.toContain('1999');
    });

    it('answers filters from a player in no duel with forbidden', async () => {
      const { socket } = await player();
      expect(await ack(socket, 'filters:submit', VALID_FILTERS)).toEqual(
        failure('forbidden', DUEL_START_MESSAGES.filtersClosed),
      );
    });

    it.each([
      [
        'duel:guess',
        [{ sessionId: 'd-1', guess: 'Zlatan' }],
        failure('session_over', DUEL_PLAY_MESSAGES.notRunning),
      ],
      ['duel:forfeit', [], failure('forbidden', DUEL_PLAY_MESSAGES.noDuel)],
    ])(
      'refuses a valid %s from a player in no duel',
      async (event, args, refused) => {
        const { socket } = await player();
        expect(await ack(socket, event, ...args)).toEqual(refused);
      },
    );

    it('answers an unknown command that waits on an ack', async () => {
      const { socket } = await player();
      expect(await ack(socket, 'duel:gues', { guess: 'Zlatan' })).toEqual(
        failure('invalid_input', UNKNOWN_COMMAND),
      );
    });

    it('reports a failed command sent with no ack as an error event', async () => {
      const { socket } = await player();
      const error = nextEvent(socket, 'error');
      socket.emit('duel:forfeit');
      expect(apiErrorSchema.parse(await error)).toMatchObject({
        code: 'forbidden',
      });
      expect(socket.connected).toBe(true);
    });

    it('closes the connection on a frame over 16 KB', async () => {
      const { cookie } = await guest();
      const socket = await connected(
        open(
          { token: await tokenFor(cookie), protocolVersion: PROTOCOL_VERSION },
          { transports: ['websocket'] },
        ),
      );
      const closed = nextEvent<string>(socket, 'disconnect');
      socket.emit('duel:guess', {
        sessionId: 'd-1',
        guess: 'x'.repeat(MAX_FRAME_BYTES),
      });
      expect(await closed).toMatch(/^transport (close|error)$/);
    });
  });

  it('still serves REST on the same port', async () => {
    const res = await http().get('/auth/session');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null });
  });

  it('never puts a token or a stack in an ack or a refusal', () => {
    expect(seen.length).toBeGreaterThanOrEqual(10);
    const text = JSON.stringify(seen);
    for (const token of tokensIssued) expect(text).not.toContain(token);
    expect(text).not.toMatch(/\bat \S+:\d+|Error:|node_modules/);
  });
});
