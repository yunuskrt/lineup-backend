import {
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { SYSTEM_CLOCK } from '@/common/clock.js';
import { MatchesModule } from '@/matches/matches.module.js';
import { SoloPersistenceService } from '@/solo/solo-persistence.service.js';
import { SoloController } from '@/solo/solo.controller.js';
import { SoloService } from '@/solo/solo.service.js';
import { SoloSessionStore } from '@/solo/solo-session.store.js';

export const SWEEP_EVERY_MS = 60_000;

@Module({
  imports: [MatchesModule],
  controllers: [SoloController],
  providers: [
    SoloService,
    SoloSessionStore,
    SoloPersistenceService,
    SYSTEM_CLOCK,
  ],
})
export class SoloModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('SoloSweep');
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly solo: SoloService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      this.solo.sweep().catch((error: unknown) => {
        const kind = error instanceof Error ? error.name : 'unknown';
        this.logger.error(`Sweep failed (${kind})`);
      });
    }, SWEEP_EVERY_MS);
    // Never keeps the process alive on its own
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }
}
