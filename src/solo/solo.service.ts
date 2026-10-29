import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '@/common/api-exception.js';
import { CLOCK, type Clock } from '@/common/clock.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import type { User } from '@/contract/auth.js';
import type { Side } from '@/contract/common.js';
import type { Filters, MatchIdentity } from '@/contract/match.js';
import type {
  SoloGuessRequest,
  SoloGuessResponse,
  SoloMatchOffer,
  SoloSession,
  SoloSummary,
} from '@/contract/solo.js';
import {
  applyTimed,
  createTimedGame,
  type TimedInput,
  type TimedRejection,
  type TimedStep,
} from '@/game/timed-game.js';
import {
  MATCH_IDENTITY_SELECT,
  toMatchIdentity,
} from '@/matches/match-refs.js';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import { SquadLoaderService } from '@/matches/squad-loader.service.js';
import { toGuessResult } from '@/matches/squad-views.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { SoloPersistenceService } from '@/solo/solo-persistence.service.js';
import {
  isOver,
  isUnsaved,
  type OfferedRun,
  type PlayedRun,
} from '@/solo/solo-run.js';
import { SoloSessionStore } from '@/solo/solo-session.store.js';
import { toSoloSession, toSoloSummary } from '@/solo/solo-views.js';

export const SOLO_MESSAGES = {
  emptyPool: 'No match fits those filters. Try widening them.',
  notFound: 'That run no longer exists.',
  sideTaken: 'A side has already been chosen for this run.',
  noSide: 'Choose a side first.',
  otherRun: 'That guess is for another run.',
  runOver: 'This run has already finished.',
  roundOver: 'That round had already ended.',
  stillPlaying: 'The run is still in progress.',
  notAllowed: 'That is not allowed in a solo run.',
} as const;

// Never echoes the guess (HC 2)
export function rejectionError(rejected: TimedRejection): ApiException {
  switch (rejected) {
    case 'session_over':
      return new ApiException('session_over', SOLO_MESSAGES.runOver);
    case 'round_over':
      return new ApiException('session_over', SOLO_MESSAGES.roundOver);
    default:
      return new ApiException('forbidden', SOLO_MESSAGES.notAllowed);
  }
}

@Injectable()
export class SoloService {
  private isSweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly selector: MatchSelectorService,
    private readonly squads: SquadLoaderService,
    private readonly store: SoloSessionStore,
    private readonly persistence: SoloPersistenceService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async start(user: User, filters: Filters): Promise<SoloMatchOffer> {
    const selection = await this.selector.select(filters);
    if ('emptyBecause' in selection) {
      throw new ApiException('empty_pool', SOLO_MESSAGES.emptyPool, {
        emptyBecause: selection.emptyBecause,
      });
    }
    const match = await this.identityOf(selection.matchId);

    const now = this.clock.now();
    await this.endOpenRun(user.id, now);
    const run: OfferedRun = {
      id: randomUUID(),
      userId: user.id,
      match,
      touchedAt: now,
      side: null,
      squad: null,
      timed: null,
      firstRound: null,
      effects: [],
    };
    this.store.save(run);
    return { sessionId: run.id, home: match.home, away: match.away };
  }

  async chooseSide(
    user: User,
    sessionId: string,
    side: Side,
  ): Promise<SoloSession> {
    const offer = this.offerOf(sessionId, user);
    const squad = await this.squads.load(offer.match.id, side);
    // A concurrent call may have taken it meanwhile
    this.offerOf(sessionId, user);

    const now = this.clock.now();
    const timed = createTimedGame({ mode: 'solo', squad: squad.entries }, now);
    // A new game always has round 1 running
    const firstRound = timed.round!;
    const run: PlayedRun = {
      ...offer,
      touchedAt: now,
      side,
      squad,
      timed,
      firstRound,
      effects: [],
      savedAt: null,
    };
    this.store.save(run);
    return toSoloSession(run);
  }

  async guess(
    user: User,
    sessionId: string,
    request: SoloGuessRequest,
  ): Promise<SoloGuessResponse> {
    if (request.sessionId !== sessionId) {
      throw new ApiException('invalid_input', SOLO_MESSAGES.otherRun);
    }
    const input: TimedInput = { kind: 'guess', seat: 0, text: request.guess };
    const { run, step } = await this.apply(user, sessionId, input);
    if (step.rejected) throw rejectionError(step.rejected);

    const resolved = step.effects.find(
      (effect) => effect.kind === 'guess_resolved',
    );
    if (!resolved) throw new Error('An accepted guess was not resolved');
    return {
      result: toGuessResult(resolved.verdict, run.squad),
      session: toSoloSession(run),
    };
  }

  async sync(user: User, sessionId: string): Promise<SoloSession> {
    const { run } = await this.apply(user, sessionId, { kind: 'tick' });
    return toSoloSession(run);
  }

  async quit(user: User, sessionId: string): Promise<SoloSummary> {
    const { run, step } = await this.apply(user, sessionId, { kind: 'quit' });
    // An ended run keeps its own end reason
    if (step.rejected && step.rejected !== 'session_over') {
      throw rejectionError(step.rejected);
    }
    return toSoloSummary(run, user.tier);
  }

  async summary(user: User, sessionId: string): Promise<SoloSummary> {
    const { run } = await this.apply(user, sessionId, { kind: 'tick' });
    if (!isOver(run)) {
      throw new ApiException('forbidden', SOLO_MESSAGES.stillPlaying);
    }
    return toSoloSummary(run, user.tier);
  }

  // Ends abandoned runs, saves them, frees memory
  async sweep(): Promise<void> {
    if (this.isSweeping) return;
    this.isSweeping = true;
    try {
      const now = this.clock.now();
      for (const { id, userId } of this.store.played()) {
        // Re-read: a request may have moved it on
        const run = this.store.get(id, userId);
        if (!run?.side) continue;
        const tick = applyTimed(run.timed, { kind: 'tick' }, now);
        // The clock moving is not the player's touch
        await this.settle(this.record(run, tick, run.touchedAt), now);
      }
      this.store.evictIdle(now);
    } finally {
      this.isSweeping = false;
    }
  }

  private async identityOf(matchId: string): Promise<MatchIdentity> {
    const match = await this.prisma.match.findUniqueOrThrow({
      where: { id: matchId },
      select: MATCH_IDENTITY_SELECT,
    });
    return toMatchIdentity(match, this.env.ASSET_BASE_URL);
  }

  // One open run per user: the old one ends
  private async endOpenRun(userId: string, now: number): Promise<void> {
    const open = this.store.activeOf(userId);
    if (!open) return;
    if (open.side === null) {
      this.store.drop(open.id);
      return;
    }
    const step = applyTimed(open.timed, { kind: 'quit' }, now);
    await this.settle(this.record(open, step, now), now);
  }

  // A failed save stays unsaved for the sweep
  private async settle(run: PlayedRun, now: number): Promise<void> {
    if (!isUnsaved(run)) return;
    if (await this.persistence.save(run)) this.store.markSaved(run.id, now);
  }

  private offerOf(sessionId: string, user: User): OfferedRun {
    const run = this.store.get(sessionId, user.id);
    if (!run) throw new ApiException('not_found', SOLO_MESSAGES.notFound);
    if (run.side !== null) {
      throw new ApiException('forbidden', SOLO_MESSAGES.sideTaken);
    }
    return run;
  }

  private playedOf(sessionId: string, user: User): PlayedRun {
    const run = this.store.get(sessionId, user.id);
    if (!run) throw new ApiException('not_found', SOLO_MESSAGES.notFound);
    if (run.side === null) {
      throw new ApiException('invalid_input', SOLO_MESSAGES.noSide);
    }
    return run;
  }

  // Catch-up is kept even when the input is refused
  private async apply(user: User, sessionId: string, input: TimedInput) {
    const now = this.clock.now();
    const played = this.playedOf(sessionId, user);
    const step = applyTimed(played.timed, input, now);
    const run = this.record(played, step, now);
    await this.settle(run, now);
    return { run, step };
  }

  private record(
    run: PlayedRun,
    step: TimedStep,
    touchedAt: number,
  ): PlayedRun {
    const next: PlayedRun = {
      ...run,
      timed: step.timed,
      effects: [...run.effects, ...step.effects],
      touchedAt,
    };
    this.store.save(next);
    return next;
  }
}
