import { Injectable } from '@nestjs/common';
import { isOver, RUN_IDLE_MS, type SoloRun } from '@/solo/solo-run.js';

// In memory at MVP; Redis arrives with B46
@Injectable()
export class SoloSessionStore {
  private readonly runs = new Map<string, SoloRun>();

  save(run: SoloRun): void {
    this.runs.set(run.id, run);
  }

  // Another user's run reads as missing
  get(id: string, userId: string): SoloRun | undefined {
    const run = this.runs.get(id);
    return run?.userId === userId ? run : undefined;
  }

  // Offered or in play: not over yet
  activeOf(userId: string): SoloRun | undefined {
    for (const run of this.runs.values()) {
      if (run.userId === userId && !isOver(run)) return run;
    }
    return undefined;
  }

  drop(id: string): void {
    this.runs.delete(id);
  }

  evictIdle(now: number): number {
    let evicted = 0;
    for (const [id, run] of this.runs) {
      if (now - run.touchedAt < RUN_IDLE_MS) continue;
      this.runs.delete(id);
      evicted += 1;
    }
    return evicted;
  }
}
