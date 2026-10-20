import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module.js';
import { SYSTEM_CLOCK } from '@/common/clock.js';
import { SYSTEM_RANDOM } from '@/common/random.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import { DuelNotifier } from '@/duel/duel-notifier.js';
import { DuelRooms } from '@/duel/duel-rooms.js';
import {
  DEFAULT_FILTER_WINDOW_MS,
  DEFAULT_FLIP_REVEAL_MS,
  DuelStartService,
  FILTER_WINDOW_MS,
  FLIP_REVEAL_MS,
} from '@/duel/duel-start.service.js';
import { DuelGateway } from '@/duel/duel.gateway.js';
import {
  DEFAULT_QUEUE_TIMEOUT_MS,
  MatchmakingService,
  QUEUE_TIMEOUT_MS,
} from '@/duel/matchmaking.service.js';
import { SocketAuthService } from '@/duel/socket-auth.service.js';
import { MatchesModule } from '@/matches/matches.module.js';

@Module({
  imports: [AuthModule, MatchesModule],
  providers: [
    DuelGateway,
    SocketAuthService,
    ConnectionRegistry,
    DuelNotifier,
    DuelRooms,
    MatchmakingService,
    DuelStartService,
    SYSTEM_CLOCK,
    SYSTEM_RANDOM,
    { provide: QUEUE_TIMEOUT_MS, useValue: DEFAULT_QUEUE_TIMEOUT_MS },
    { provide: FILTER_WINDOW_MS, useValue: DEFAULT_FILTER_WINDOW_MS },
    { provide: FLIP_REVEAL_MS, useValue: DEFAULT_FLIP_REVEAL_MS },
  ],
})
export class DuelModule {}
