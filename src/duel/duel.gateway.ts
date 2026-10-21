import { Logger, UseFilters } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type {
  DefaultEventsMap,
  ExtendedError,
  Server,
  Socket,
} from 'socket.io';
import { ApiException } from '@/common/api-exception.js';
import { ZodValidationPipe } from '@/common/zod-validation.pipe.js';
import type { User } from '@/contract/auth.js';
import {
  type DuelCommand,
  duelCommandSchemas,
  type DuelGuessRequest,
  duelGuessRequestSchema,
} from '@/contract/duel.js';
import { type Filters, filtersSchema } from '@/contract/match.js';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketAck,
} from '@/contract/socket.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import { DuelNotifier, roomOf } from '@/duel/duel-notifier.js';
import { DuelPlayService } from '@/duel/duel-play.service.js';
import { DuelStartService } from '@/duel/duel-start.service.js';
import { MatchmakingService } from '@/duel/matchmaking.service.js';
import { SocketAuthService } from '@/duel/socket-auth.service.js';
import {
  failureAck,
  handshakeRefusal,
  SocketEnvelopeFilter,
  socketError,
  SUCCESS_ACK,
} from '@/duel/socket-envelope.filter.js';

// Set by the handshake, from the server only
export type SocketData = { user: User };
type Listen = ClientToServerEvents;
type Emit = ServerToClientEvents;
export type DuelSocket = Socket<Listen, Emit, DefaultEventsMap, SocketData>;
export type DuelServer = Server<Listen, Emit, DefaultEventsMap, SocketData>;

export const REPLACED = "You're connected somewhere else.";
export const UNKNOWN_COMMAND = 'Unknown command.';

const COMMANDS = new Set<string>(Object.keys(duelCommandSchemas));

function parseCommand(command: DuelCommand, payload: unknown): void {
  new ZodValidationPipe(duelCommandSchemas[command]).transform(payload);
}

@WebSocketGateway()
@UseFilters(SocketEnvelopeFilter)
export class DuelGateway
  implements
    OnGatewayInit<DuelServer>,
    OnGatewayConnection<DuelSocket>,
    OnGatewayDisconnect<DuelSocket>
{
  private readonly logger = new Logger('DuelGateway');

  constructor(
    private readonly auth: SocketAuthService,
    private readonly connections: ConnectionRegistry<DuelSocket>,
    private readonly notifier: DuelNotifier,
    private readonly matchmaking: MatchmakingService,
    private readonly start: DuelStartService,
    private readonly play: DuelPlayService,
  ) {}

  // A refused socket never reaches a handler
  afterInit(server: DuelServer): void {
    this.notifier.attach(server);
    server.use((socket, next) => {
      void this.admit(socket).then(next);
    });
  }

  handleConnection(socket: DuelSocket): void {
    const { user } = socket.data;
    void socket.join(roomOf(user.id));
    socket.onAny((event: string, ...args: unknown[]) => {
      this.answerUnknown(event, args);
    });

    const replaced = this.connections.register(user.id, socket);
    if (replaced) {
      // The new socket starts idle
      this.matchmaking.drop(user.id);
      const error = new ApiException('forbidden', REPLACED).error;
      this.notifier.toSocket(replaced, 'error', error);
      replaced.disconnect(true);
    }
  }

  handleDisconnect(socket: DuelSocket): void {
    const { user } = socket.data;
    if (this.connections.remove(user.id, socket)) {
      this.matchmaking.drop(user.id);
    }
  }

  @SubscribeMessage('queue:enter')
  enterQueue(
    @ConnectedSocket() socket: DuelSocket,
    @MessageBody() payload: unknown,
  ): SocketAck {
    parseCommand('queue:enter', payload);
    this.matchmaking.enter(socket.data.user);
    return SUCCESS_ACK;
  }

  @SubscribeMessage('queue:leave')
  leaveQueue(
    @ConnectedSocket() socket: DuelSocket,
    @MessageBody() payload: unknown,
  ): SocketAck {
    parseCommand('queue:leave', payload);
    this.matchmaking.leave(socket.data.user.id);
    return SUCCESS_ACK;
  }

  @SubscribeMessage('filters:submit')
  async submitFilters(
    @ConnectedSocket() socket: DuelSocket,
    @MessageBody(new ZodValidationPipe(filtersSchema)) filters: Filters,
  ): Promise<SocketAck> {
    await this.start.submit(socket.data.user, filters);
    return SUCCESS_ACK;
  }

  @SubscribeMessage('duel:guess')
  guess(
    @ConnectedSocket() socket: DuelSocket,
    @MessageBody(new ZodValidationPipe(duelGuessRequestSchema))
    request: DuelGuessRequest,
  ): SocketAck {
    this.play.guess(socket.data.user, request);
    return SUCCESS_ACK;
  }

  @SubscribeMessage('duel:forfeit')
  forfeit(
    @ConnectedSocket() socket: DuelSocket,
    @MessageBody() payload: unknown,
  ): SocketAck {
    parseCommand('duel:forfeit', payload);
    this.play.forfeit(socket.data.user);
    return SUCCESS_ACK;
  }

  private async admit(socket: DuelSocket): Promise<ExtendedError | undefined> {
    try {
      socket.data.user = await this.auth.authenticate(socket.handshake.auth);
      return undefined;
    } catch (thrown) {
      const error = socketError(thrown, this.logger);
      // The code only: never the token or its claims
      this.logger.debug(`Handshake refused: ${error.code}`);
      return handshakeRefusal(error);
    }
  }

  // An ack never waits on a mistyped command
  private answerUnknown(event: string, args: unknown[]): void {
    const ack = args.at(-1);
    if (COMMANDS.has(event) || typeof ack !== 'function') return;
    ack(failureAck(new ApiException('invalid_input', UNKNOWN_COMMAND).error));
  }
}
