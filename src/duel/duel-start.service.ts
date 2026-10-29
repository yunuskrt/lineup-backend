import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ApiException, SERVER_ERROR_MESSAGE } from '@/common/api-exception.js';
import { CLOCK, type Clock } from '@/common/clock.js';
import { RANDOM, type Random } from '@/common/random.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import type { User } from '@/contract/auth.js';
import type { DuelEventMap } from '@/contract/duel.js';
import type { Filters } from '@/contract/match.js';
import { firstSeat, flipFilters, NO_PREFERENCE } from '@/game/coin-flip.js';
import type { Seat } from '@/game/engine.js';
import { createTimedGame } from '@/game/timed-game.js';
import {
  DUEL_START_MESSAGES,
  MATCHMAKING_MESSAGES,
} from '@/duel/duel-messages.js';
import { DuelNotifier } from '@/duel/duel-notifier.js';
import { DuelPlayService } from '@/duel/duel-play.service.js';
import {
  type DuelRoom,
  type FiltersRoom,
  type FlippingRoom,
  type PlayingRoom,
  seatOf,
} from '@/duel/duel-room.js';
import { DuelRooms } from '@/duel/duel-rooms.js';
import {
  toCoinFlip,
  toDuelSession,
  toFilterSubmission,
} from '@/duel/duel-views.js';
import {
  MATCH_IDENTITY_SELECT,
  toMatchIdentity,
} from '@/matches/match-refs.js';
import { MatchSelectorService } from '@/matches/match-selector.service.js';
import { SidePickerService } from '@/matches/side-picker.service.js';
import { SquadLoaderService } from '@/matches/squad-loader.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';

export const FILTER_WINDOW_MS = Symbol('FILTER_WINDOW_MS');
export const DEFAULT_FILTER_WINDOW_MS = 30_000;
export const FLIP_REVEAL_MS = Symbol('FLIP_REVEAL_MS');
export const DEFAULT_FLIP_REVEAL_MS = 2_000;

type Resolved = Pick<PlayingRoom, 'match' | 'side' | 'squad'>;

const nameOf = (error: unknown) =>
  error instanceof Error ? error.constructor.name : typeof error;

// From paired to matchReady
@Injectable()
export class DuelStartService implements OnModuleDestroy {
  private readonly logger = new Logger('DuelStart');
  // One pending step per room: window or reveal
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly rooms: DuelRooms,
    private readonly notifier: DuelNotifier,
    private readonly play: DuelPlayService,
    private readonly selector: MatchSelectorService,
    private readonly sides: SidePickerService,
    private readonly squads: SquadLoaderService,
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RANDOM) private readonly random: Random,
    @Inject(FILTER_WINDOW_MS) private readonly filterWindowMs: number,
    @Inject(FLIP_REVEAL_MS) private readonly flipRevealMs: number,
    @Inject(ENV) private readonly env: Env,
  ) {}

  open(room: FiltersRoom): void {
    this.schedule(room.id, this.filterWindowMs, () => {
      this.closeWindow(room.id);
    });
  }

  async submit(user: User, filters: Filters): Promise<void> {
    this.openSeat(user.id);
    const emptyBecause = await this.selector.check(filters);
    if (emptyBecause) {
      throw new ApiException('empty_pool', DUEL_START_MESSAGES.emptyPool, {
        emptyBecause,
      });
    }

    // Re-read: a drop or the window may have won
    const { room, seat } = this.openSeat(user.id);
    const submissions: FiltersRoom['submissions'] =
      seat === 0
        ? [filters, room.submissions[1]]
        : [room.submissions[0], filters];
    const next: FiltersRoom = { ...room, submissions };
    this.rooms.save(next);
    this.sendSubmissions(next);

    const [first, second] = submissions;
    if (first && second) this.flip(next, [first, second]);
  }

  // A closed or replaced connection
  drop(userId: string): void {
    const room = this.rooms.roomOf(userId);
    if (!room) return;
    if (room.phase === 'playing') {
      this.play.drop(userId);
      return;
    }
    this.end(
      room,
      new ApiException('session_over', MATCHMAKING_MESSAGES.opponentLeft),
      userId,
    );
  }

  onModuleDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private openSeat(userId: string) {
    const room = this.rooms.roomOf(userId);
    const seat = room ? seatOf(room, userId) : 0;
    if (room?.phase !== 'filters' || room.submissions[seat] !== null) {
      throw new ApiException('forbidden', DUEL_START_MESSAGES.filtersClosed);
    }
    return { room, seat };
  }

  private closeWindow(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room?.phase !== 'filters') return;
    const [first, second] = room.submissions;
    const next: FiltersRoom = {
      ...room,
      submissions: [first ?? NO_PREFERENCE, second ?? NO_PREFERENCE],
    };
    this.rooms.save(next);
    this.sendSubmissions(next);
    this.flip(next, [first ?? NO_PREFERENCE, second ?? NO_PREFERENCE]);
  }

  private flip(room: FiltersRoom, sets: [Filters, Filters]): void {
    this.cancel(room.id);
    const flipping: FlippingRoom = {
      id: room.id,
      players: room.players,
      pairedAt: room.pairedAt,
      phase: 'flipping',
      flip: flipFilters(sets, this.random),
    };
    this.rooms.save(flipping);
    this.sendEach(flipping, 'coinFlip', (seat) => toCoinFlip(flipping, seat));
    void this.resolve(flipping, this.clock.now());
  }

  private async resolve(room: FlippingRoom, flippedAt: number): Promise<void> {
    let matchId: string | null = null;
    try {
      const selection = await this.selector.select(
        room.flip.filters,
        this.random,
      );
      if ('emptyBecause' in selection) {
        this.fail(
          room.id,
          new ApiException('empty_pool', DUEL_START_MESSAGES.emptiedSinceFlip, {
            emptyBecause: selection.emptyBecause,
          }),
        );
        return;
      }
      matchId = selection.matchId;
      const resolved = await this.load(matchId);
      // A drop while loading leaves nothing to start
      if (!this.rooms.get(room.id)) return;
      const wait = Math.max(
        0,
        flippedAt + this.flipRevealMs - this.clock.now(),
      );
      this.schedule(room.id, wait, () => {
        this.begin(room.id, resolved);
      });
    } catch (error) {
      // The match id only: never a player or filter
      this.logger.error(
        `Duel start failed for match ${matchId ?? 'none'} (${nameOf(error)})`,
      );
      this.fail(
        room.id,
        new ApiException('server_error', SERVER_ERROR_MESSAGE),
      );
    }
  }

  private async load(matchId: string): Promise<Resolved> {
    const side = await this.sides.pick(matchId, this.random);
    const squad = await this.squads.load(matchId, side);
    const row = await this.prisma.match.findUniqueOrThrow({
      where: { id: matchId },
      select: MATCH_IDENTITY_SELECT,
    });
    const match = toMatchIdentity(row, this.env.ASSET_BASE_URL);
    return { match, side, squad };
  }

  private begin(roomId: string, resolved: Resolved): void {
    const room = this.rooms.get(roomId);
    if (room?.phase !== 'flipping') return;

    const timed = createTimedGame(
      {
        mode: 'duel',
        squad: resolved.squad.entries,
        firstSeat: firstSeat(room.flip.winner),
      },
      this.clock.now(),
    );
    const playing: PlayingRoom = {
      ...room,
      ...resolved,
      phase: 'playing',
      timed,
      effects: [],
      away: [null, null],
      // A new game always has round 1 running
      firstRound: timed.round!,
    };
    this.rooms.save(playing);
    this.sendEach(playing, 'matchReady', (seat) =>
      toDuelSession(playing, seat),
    );
    this.play.start(playing);
  }

  // A failed start reaches both players
  private fail(roomId: string, error: ApiException): void {
    const room = this.rooms.get(roomId);
    if (room) this.end(room, error, null);
  }

  private end(room: DuelRoom, error: ApiException, leaver: string | null) {
    this.cancel(room.id);
    this.rooms.close(room.id);
    for (const player of room.players) {
      if (player.id !== leaver) {
        this.notifier.toUser(player.id, 'error', error.error);
      }
    }
  }

  private sendSubmissions(room: FiltersRoom): void {
    this.sendEach(room, 'filtersUpdated', (seat) =>
      toFilterSubmission(room.submissions, seat),
    );
  }

  private sendEach<E extends 'filtersUpdated' | 'coinFlip' | 'matchReady'>(
    room: DuelRoom,
    event: E,
    view: (seat: Seat) => DuelEventMap[E],
  ): void {
    room.players.forEach((player, seat) => {
      this.notifier.toUser(player.id, event, view(seat as Seat));
    });
  }

  private schedule(roomId: string, delayMs: number, step: () => void): void {
    this.cancel(roomId);
    const timer = setTimeout(() => {
      this.timers.delete(roomId);
      step();
    }, delayMs);
    // Never keeps the process alive on its own
    timer.unref();
    this.timers.set(roomId, timer);
  }

  private cancel(roomId: string): void {
    clearTimeout(this.timers.get(roomId));
    this.timers.delete(roomId);
  }
}
