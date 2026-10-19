import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module.js';
import { SYSTEM_CLOCK } from '@/common/clock.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import { DuelNotifier } from '@/duel/duel-notifier.js';
import { DuelRooms } from '@/duel/duel-rooms.js';
import { DuelGateway } from '@/duel/duel.gateway.js';
import {
  DEFAULT_QUEUE_TIMEOUT_MS,
  MatchmakingService,
  QUEUE_TIMEOUT_MS,
} from '@/duel/matchmaking.service.js';
import { SocketAuthService } from '@/duel/socket-auth.service.js';

@Module({
  imports: [AuthModule],
  providers: [
    DuelGateway,
    SocketAuthService,
    ConnectionRegistry,
    DuelNotifier,
    DuelRooms,
    MatchmakingService,
    SYSTEM_CLOCK,
    { provide: QUEUE_TIMEOUT_MS, useValue: DEFAULT_QUEUE_TIMEOUT_MS },
  ],
})
export class DuelModule {}
