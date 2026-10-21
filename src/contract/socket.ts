import { z } from 'zod';
import {
  DUEL_COMMAND_REFUSALS,
  type DuelCommand,
  duelCommandSchemas,
  type DuelEventMap,
  duelEventSchemas,
} from '@/contract/duel.js';
import { emptyResultSchema } from '@/contract/envelope.js';
import { contractRegistry } from '@/contract/registry.js';

// socket.handshake.auth on connect
export const socketHandshakeSchema = z
  .object({
    // A GatewayToken from GET /auth/token
    token: z.string().min(1),
    protocolVersion: z.number().int(),
  })
  .register(contractRegistry, { id: 'SocketHandshake' });
export type SocketHandshake = z.infer<typeof socketHandshakeSchema>;

// Every command's ack: data is always null
export const socketAckSchema = emptyResultSchema;
export type SocketAck = z.infer<typeof socketAckSchema>;

export type ServerToClientEvents = {
  [E in keyof DuelEventMap]: (payload: DuelEventMap[E]) => void;
};

type Ack = (ack: SocketAck) => void;
type CommandPayload<C extends DuelCommand> = z.input<
  (typeof duelCommandSchemas)[C]
>;

export type ClientToServerEvents = {
  [C in DuelCommand]: undefined extends CommandPayload<C>
    ? (ack: Ack) => void
    : (payload: CommandPayload<C>, ack: Ack) => void;
};

export type SocketCatalog = {
  commands: Record<
    DuelCommand,
    { payload: string | null; ack: string; refusals: readonly string[] }
  >;
  events: Record<keyof DuelEventMap, string>;
};

function idOf(schema: z.ZodType): string {
  const id = contractRegistry.get(schema)?.id;
  if (!id) throw new Error('Socket schemas must be named contract types');
  return id;
}

const entries = <K extends string, V>(record: Record<K, V>) =>
  Object.entries(record) as [K, V][];

// Built from the contract, so it can't drift
export function socketCatalog(): SocketCatalog {
  const commands = entries(duelCommandSchemas).map(([command, schema]) => [
    command,
    {
      payload: schema instanceof z.ZodUndefined ? null : idOf(schema),
      ack: idOf(socketAckSchema),
      refusals: DUEL_COMMAND_REFUSALS[command],
    },
  ]);
  const events = entries(duelEventSchemas).map(([event, schema]) => [
    event,
    idOf(schema),
  ]);
  return {
    commands: Object.fromEntries(commands) as SocketCatalog['commands'],
    events: Object.fromEntries(events) as SocketCatalog['events'],
  };
}
