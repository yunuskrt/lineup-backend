import { Injectable, Logger } from '@nestjs/common';
import { NO_SESSION, toContractUser } from '@/auth/auth-flow.service.js';
import { GatewayTokenService } from '@/auth/gateway-token.service.js';
import { ApiException } from '@/common/api-exception.js';
import type { User } from '@/contract/auth.js';
import { isSupportedProtocol, PROTOCOL_VERSION } from '@/contract/protocol.js';
import { socketHandshakeSchema } from '@/contract/socket.js';
import { PrismaService } from '@/prisma/prisma.service.js';

export const OUT_OF_DATE =
  'This version of Lineup is out of date. Update to keep playing.';

const versionOf = (auth: unknown): unknown =>
  typeof auth === 'object' && auth !== null && 'protocolVersion' in auth
    ? auth.protocolVersion
    : undefined;

// Version, then token, then a fresh user row
@Injectable()
export class SocketAuthService {
  private readonly logger = new Logger('SocketAuth');

  constructor(
    private readonly tokens: GatewayTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async authenticate(auth: unknown): Promise<User> {
    const version = versionOf(auth);
    if (!isSupportedProtocol(version)) {
      // The backend ships first: a deploy-order bug
      if (typeof version === 'number' && version > PROTOCOL_VERSION) {
        this.logger.warn(`Refused protocol ${version}, newer than ours`);
      }
      throw new ApiException('protocol_refused', OUT_OF_DATE);
    }

    const handshake = socketHandshakeSchema.safeParse(auth);
    const verified = handshake.success
      ? await this.tokens.verify(handshake.data.token)
      : null;
    if (!verified) throw new ApiException('unauthorized', NO_SESSION);

    // B12b: a token outlives its user's deletion
    const user = await this.prisma.user.findUnique({
      where: { id: verified.userId },
      select: {
        id: true,
        handle: true,
        isAnonymous: true,
        emailVerified: true,
      },
    });
    if (!user) throw new ApiException('unauthorized', NO_SESSION);
    return toContractUser(user);
  }
}
