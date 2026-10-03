import { z } from 'zod';
import {
  competitionKindSchema,
  isoDateSchema,
  positionGroupSchema,
} from '@/contract/common.js';
import {
  FIRST_SEASON_START,
  LAST_SEASON_START,
  SQUAD_SIZE,
} from '@/contract/constants.js';
import { formationSchema } from '@/contract/match.js';

const slugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const textSchema = z.string().regex(/\S/);

// Mirrors player_aliases_normalized_check
const normalizedAliasSchema = z
  .string()
  .regex(/^\S+( \S+)*$/)
  .refine((alias) => alias === alias.toLowerCase(), {
    error: 'Alias must be lowercase',
  });

const seasonLabelSchema = z.string().regex(/^\d{4}(-\d{2})?$/);

const seedCompetitionSchema = z.object({
  id: slugSchema,
  kind: competitionKindSchema,
  name: textSchema,
});

const seedClubSchema = z.object({
  id: slugSchema,
  name: textSchema,
  shortName: textSchema,
});

const seedPlayerSchema = z.object({
  id: slugSchema,
  name: textSchema,
  aliases: z
    .array(normalizedAliasSchema)
    .min(1)
    .refine((aliases) => new Set(aliases).size === aliases.length, {
      error: 'Aliases must be unique',
    }),
});

const lineupEntrySchema = z.object({
  playerId: slugSchema,
  slot: z
    .number()
    .int()
    .min(0)
    .max(SQUAD_SIZE - 1),
  position: positionGroupSchema,
});

const seedSideSchema = z
  .object({
    formation: formationSchema,
    lineup: z.array(lineupEntrySchema).length(SQUAD_SIZE),
  })
  .superRefine(({ lineup }, ctx) => {
    if (new Set(lineup.map((entry) => entry.slot)).size !== SQUAD_SIZE) {
      ctx.addIssue({ code: 'custom', message: 'Slots must be unique' });
    }
    if (new Set(lineup.map((entry) => entry.playerId)).size !== SQUAD_SIZE) {
      ctx.addIssue({ code: 'custom', message: 'Players must be unique' });
    }
    lineup.forEach((entry, index) => {
      if ((entry.slot === 0) !== (entry.position === 'GK')) {
        ctx.addIssue({
          code: 'custom',
          path: ['lineup', index],
          message: 'GK belongs in slot 0 only',
        });
      }
    });
  });

const seedMatchSchema = z.object({
  id: slugSchema,
  competitionId: slugSchema,
  season: seasonLabelSchema,
  date: isoDateSchema,
  stage: textSchema.nullable(),
  homeClubId: slugSchema,
  awayClubId: slugSchema,
  score: z.object({
    home: z.number().int().nonnegative(),
    away: z.number().int().nonnegative(),
  }),
  nickname: textSchema.nullable(),
  home: seedSideSchema,
  away: seedSideSchema,
});

const TOURNAMENT_KINDS = new Set(['world_cup', 'euro']);

// Same rules as the seasons CHECKs and the mock
export function seasonIssue(
  label: string,
  date: string,
  isTournament: boolean,
): string | null {
  const start = Number(label.slice(0, 4));
  const end = label.length > 4 ? Number(label.slice(5)) : null;
  if (start < FIRST_SEASON_START || start > LAST_SEASON_START) {
    return 'Season is outside the covered range';
  }
  if (isTournament) {
    if (end !== null) return 'Tournament seasons are a single year';
    return date.startsWith(`${start}-`) ? null : 'Date is outside the season';
  }
  if (end === null) return 'Club seasons span two years';
  if (end !== (start + 1) % 100) return 'Season years must be consecutive';
  const isInSeason = date >= `${start}-07-01` && date <= `${start + 1}-06-30`;
  return isInSeason ? null : 'Date is outside the season';
}

function duplicateIndex(ids: readonly string[]): number {
  return ids.findIndex((id, index) => ids.indexOf(id) !== index);
}

export const seedDataSchema = z
  .object({
    competitions: z.array(seedCompetitionSchema),
    clubs: z.array(seedClubSchema),
    players: z.array(seedPlayerSchema),
    matches: z.array(seedMatchSchema),
  })
  .superRefine((data, ctx) => {
    for (const key of [
      'competitions',
      'clubs',
      'players',
      'matches',
    ] as const) {
      const index = duplicateIndex(data[key].map((item) => item.id));
      if (index >= 0) {
        ctx.addIssue({
          code: 'custom',
          path: [key, index],
          message: 'Duplicate id',
        });
      }
    }

    const kinds = new Map(data.competitions.map((c) => [c.id, c.kind]));
    const clubs = new Set(data.clubs.map((club) => club.id));
    const players = new Set(data.players.map((player) => player.id));

    data.matches.forEach((match, index) => {
      const issue = (path: (string | number)[], message: string) =>
        ctx.addIssue({
          code: 'custom',
          path: ['matches', index, ...path],
          message,
        });

      const kind = kinds.get(match.competitionId);
      if (!kind) issue(['competitionId'], 'Unknown competition');
      if (!clubs.has(match.homeClubId)) issue(['homeClubId'], 'Unknown club');
      if (!clubs.has(match.awayClubId)) issue(['awayClubId'], 'Unknown club');
      if (match.homeClubId === match.awayClubId) {
        issue(['awayClubId'], 'Home and away clubs must differ');
      }

      for (const side of ['home', 'away'] as const) {
        match[side].lineup.forEach((entry, slotIndex) => {
          if (!players.has(entry.playerId)) {
            issue([side, 'lineup', slotIndex, 'playerId'], 'Unknown player');
          }
        });
      }
      const homeIds = new Set(match.home.lineup.map((e) => e.playerId));
      if (match.away.lineup.some((entry) => homeIds.has(entry.playerId))) {
        issue(['away', 'lineup'], 'A player starts for both sides');
      }

      const season = kind
        ? seasonIssue(match.season, match.date, TOURNAMENT_KINDS.has(kind))
        : null;
      if (season) issue(['season'], season);
    });
  });

export type SeedCompetition = z.input<typeof seedCompetitionSchema>;
export type SeedClub = z.input<typeof seedClubSchema>;
export type SeedPlayer = z.input<typeof seedPlayerSchema>;
export type SeedMatch = z.input<typeof seedMatchSchema>;
export type SeedDataInput = z.input<typeof seedDataSchema>;
export type SeedData = z.output<typeof seedDataSchema>;
