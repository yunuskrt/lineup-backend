import { Injectable } from '@nestjs/common';
import type { Side } from '@/contract/common.js';
import { SQUAD_SIZE } from '@/contract/constants.js';
import type { RevealedPlayer } from '@/contract/player.js';
import { positionForSlot } from '@/game/formation.js';
import type { SquadEntry } from '@/game/matcher.js';
import type { Prisma } from '@/generated/prisma/client.js';
import { PrismaService } from '@/prisma/prisma.service.js';

// Server-only: the answer key (HC 2)
export type LoadedSquad = {
  readonly formation: string;
  readonly entries: readonly SquadEntry[];
  readonly players: readonly RevealedPlayer[];
};

const SQUAD_SELECT = {
  formation: true,
  lineups: {
    select: {
      slot: true,
      position: true,
      player: {
        select: {
          id: true,
          name: true,
          aliases: { select: { normalized: true } },
        },
      },
    },
    orderBy: { slot: 'asc' },
  },
} satisfies Prisma.MatchTeamSelect;

type TeamRow = Prisma.MatchTeamGetPayload<{ select: typeof SQUAD_SELECT }>;

// Names the match only, never a player
function unplayable(matchId: string, side: Side, why: string): Error {
  return new Error(`Match ${matchId} ${side} XI ${why}`);
}

function toLoadedSquad(
  matchId: string,
  side: Side,
  team: TeamRow | null,
): LoadedSquad {
  const formation = team?.formation;
  if (!team || !formation) throw unplayable(matchId, side, 'has no formation');
  const { lineups } = team;
  if (lineups.length !== SQUAD_SIZE) {
    throw unplayable(matchId, side, `has ${lineups.length} starters`);
  }

  for (const { slot, position, player } of lineups) {
    if (positionForSlot(formation, slot) !== position) {
      throw unplayable(matchId, side, `slot ${slot} breaks ${formation}`);
    }
    if (player.aliases.length === 0) {
      throw unplayable(matchId, side, `slot ${slot} has no alias`);
    }
  }

  return {
    formation,
    entries: lineups.map(({ player }) => ({
      playerId: player.id,
      aliases: player.aliases.map((alias) => alias.normalized),
    })),
    // image_key becomes a URL with B23
    players: lineups.map(({ slot, position, player }) => ({
      id: player.id,
      name: player.name,
      slot,
      position,
      imageUrl: null,
    })),
  };
}

@Injectable()
export class SquadLoaderService {
  constructor(private readonly prisma: PrismaService) {}

  async load(matchId: string, side: Side): Promise<LoadedSquad> {
    const team = await this.prisma.matchTeam.findUnique({
      where: { matchId_side: { matchId, side } },
      select: SQUAD_SELECT,
    });
    return toLoadedSquad(matchId, side, team);
  }
}
