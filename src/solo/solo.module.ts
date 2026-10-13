import {
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { CLOCK, type Clock, SYSTEM_CLOCK } from '@/common/clock.js';
import { MatchesModule } from '@/matches/matches.module.js';
import { SoloController } from '@/solo/solo.controller.js';
import { SoloService } from '@/solo/solo.service.js';
import { SoloSessionStore } from '@/solo/solo-session.store.js';

const EVICT_EVERY_MS = 5 * 60_000;

@Module({
  imports: [MatchesModule],
  controllers: [SoloController],
  providers: [SoloService, SoloSessionStore, SYSTEM_CLOCK],
})
export class SoloModule implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly store: SoloSessionStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(
      () => this.store.evictIdle(this.clock.now()),
      EVICT_EVERY_MS,
    );
    // Never keeps the process alive on its own
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }
}
