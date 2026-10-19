import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import { DuelGateway } from '@/duel/duel.gateway.js';
import { SocketAuthService } from '@/duel/socket-auth.service.js';

@Module({
  imports: [AuthModule],
  providers: [DuelGateway, SocketAuthService, ConnectionRegistry],
})
export class DuelModule {}
