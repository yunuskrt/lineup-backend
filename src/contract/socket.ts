import { z } from 'zod';
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
