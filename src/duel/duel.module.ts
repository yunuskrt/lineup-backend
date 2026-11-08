import { Module } from '@nestjs/common';
import { AuthModule } from '@/auth/auth.module.js';
import { SYSTEM_CLOCK } from '@/common/clock.js';
import { SYSTEM_RANDOM } from '@/common/random.js';
import { RECONNECT_WINDOW_MS, ROOM_WAIT_MS } from '@/contract/constants.js';
import { ConnectionRegistry } from '@/duel/connection-registry.js';
import { DuelNotifier } from '@/duel/duel-notifier.js';
import {
  DEFAULT_DUEL_RETRY_MS,
  DUEL_RETRY_MS,
  DuelPersistenceService,
} from '@/duel/duel-persistence.service.js';
import { DuelPlayService, RECONNECT_WINDOW } from '@/duel/duel-play.service.js';
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
import { MatchmakingQueue } from '@/duel/matchmaking-queue.js';
import {
  PrivateRoomsService,
  ROOM_CODE_PICK,
  ROOM_WAIT,
} from '@/duel/private-rooms.service.js';
import { SECURE_PICK } from '@/duel/room-code.js';
import { SocketAuthService } from '@/duel/socket-auth.service.js';
import { SocketRateLimitGuard } from '@/duel/socket-rate-limit.guard.js';
import { MatchesModule } from '@/matches/matches.module.js';

@Module({
  imports: [AuthModule, MatchesModule],
  providers: [
    DuelGateway,
    SocketAuthService,
    SocketRateLimitGuard,
    ConnectionRegistry,
    DuelNotifier,
    DuelRooms,
    MatchmakingQueue,
    MatchmakingService,
    PrivateRoomsService,
    DuelStartService,
    DuelPlayService,
    DuelPersistenceService,
    SYSTEM_CLOCK,
    SYSTEM_RANDOM,
    { provide: QUEUE_TIMEOUT_MS, useValue: DEFAULT_QUEUE_TIMEOUT_MS },
    { provide: FILTER_WINDOW_MS, useValue: DEFAULT_FILTER_WINDOW_MS },
    { provide: FLIP_REVEAL_MS, useValue: DEFAULT_FLIP_REVEAL_MS },
    { provide: RECONNECT_WINDOW, useValue: RECONNECT_WINDOW_MS },
    { provide: DUEL_RETRY_MS, useValue: DEFAULT_DUEL_RETRY_MS },
    { provide: ROOM_WAIT, useValue: ROOM_WAIT_MS },
    { provide: ROOM_CODE_PICK, useValue: SECURE_PICK },
  ],
})
export class DuelModule {}
