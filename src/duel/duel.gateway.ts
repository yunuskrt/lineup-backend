import { Logger, UseFilters } from '@nestjs/common';
import {
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
import { type DuelCommand, duelCommandSchemas } from '@/contract/duel.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import { SocketAuthService } from '@/duel/socket-auth.service.js';
import {
  failureAck,
  handshakeRefusal,
  SocketEnvelopeFilter,
  socketError,
} from '@/duel/socket-envelope.filter.js';

// Set by the handshake, from the server only
export type SocketData = { user: User };
type Events = DefaultEventsMap;
export type DuelSocket = Socket<Events, Events, Events, SocketData>;
export type DuelServer = Server<Events, Events, Events, SocketData>;

export const DUELS_NOT_OPEN = "Duels aren't open yet.";
export const REPLACED = "You're connected somewhere else.";
export const UNKNOWN_COMMAND = 'Unknown command.';

const COMMANDS = new Set<string>(Object.keys(duelCommandSchemas));

export const roomOf = (userId: string) => `user:${userId}`;

// Validated, then refused until B37–B41
function refuseUntilOpen(command: DuelCommand, payload: unknown): never {
  new ZodValidationPipe(duelCommandSchemas[command]).transform(payload);
  throw new ApiException('forbidden', DUELS_NOT_OPEN);
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
  ) {}

  // A refused socket never reaches a handler
  afterInit(server: DuelServer): void {
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
      replaced.emit('error', new ApiException('forbidden', REPLACED).error);
      replaced.disconnect(true);
    }
  }

  handleDisconnect(socket: DuelSocket): void {
    this.connections.remove(socket.data.user.id, socket);
  }

  @SubscribeMessage('queue:enter')
  enterQueue(@MessageBody() payload: unknown): never {
    return refuseUntilOpen('queue:enter', payload);
  }

  @SubscribeMessage('queue:leave')
  leaveQueue(@MessageBody() payload: unknown): never {
    return refuseUntilOpen('queue:leave', payload);
  }

  @SubscribeMessage('filters:submit')
  submitFilters(@MessageBody() payload: unknown): never {
    return refuseUntilOpen('filters:submit', payload);
  }

  @SubscribeMessage('duel:guess')
  guess(@MessageBody() payload: unknown): never {
    return refuseUntilOpen('duel:guess', payload);
  }

  @SubscribeMessage('duel:forfeit')
  forfeit(@MessageBody() payload: unknown): never {
    return refuseUntilOpen('duel:forfeit', payload);
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
