import { z } from 'zod';
import { idSchema, imageUrlSchema } from '@/contract/common.js';
import { SQUAD_SIZE, TOP_CLUBS_LIMIT } from '@/contract/constants.js';
import {
  clubRefSchema,
  competitionRefSchema,
  eraRangeSchema,
  matchInPlaySchema,
  seasonStartSchema,
} from '@/contract/match.js';
import { directoryKeySchema, revealedPlayerSchema } from '@/contract/player.js';
import { contractRegistry } from '@/contract/registry.js';

// What the pool holds for one competition
export const competitionOptionSchema = competitionRefSchema
  .extend({
    // Ordered as FilterOptions.clubs
    clubIds: z.array(idSchema),
    // Ascending, no repeats
    seasonStarts: z.array(seasonStartSchema).min(1),
  })
  .register(contractRegistry, { id: 'CompetitionOption' });
export type CompetitionOption = z.infer<typeof competitionOptionSchema>;

export const filterOptionsSchema = z
  .object({
    competitions: z.array(competitionOptionSchema),
    clubs: z.array(clubRefSchema),
    era: eraRangeSchema,
  })
  .register(contractRegistry, { id: 'FilterOptions' });
export type FilterOptions = z.infer<typeof filterOptionsSchema>;

// Every player with an alias; never scoped (HC 2)
export const directoryPlayerSchema = z
  .object({
    key: directoryKeySchema,
    name: z.string().min(1),
    imageUrl: imageUrlSchema.nullable(),
    // Normalised aliases to search, never shown
    terms: z.array(z.string().min(1)).min(1),
  })
  .register(contractRegistry, { id: 'DirectoryPlayer' });
export type DirectoryPlayer = z.infer<typeof directoryPlayerSchema>;

// Sorted by key
export const playerDirectorySchema = z
  .object({ players: z.array(directoryPlayerSchema) })
  .register(contractRegistry, { id: 'PlayerDirectory' });
export type PlayerDirectory = z.infer<typeof playerDirectorySchema>;

const isDistinct = (values: readonly number[]) =>
  new Set(values).size === values.length;

const slotSchema = z
  .number()
  .int()
  .min(0)
  .max(SQUAD_SIZE - 1);

// The demo's wrong guess, from the other XI
export const showcasePlayerSchema = z
  .object({
    name: z.string().min(1),
    imageUrl: imageUrlSchema.nullable(),
    directoryKey: directoryKeySchema,
  })
  .register(contractRegistry, { id: 'ShowcasePlayer' });
export type ShowcasePlayer = z.infer<typeof showcasePlayerSchema>;

export const showcaseDemoSchema = z
  .object({
    // Slots to reveal, in order
    reveals: z
      .array(slotSchema)
      .min(1)
      .max(SQUAD_SIZE)
      .refine(isDistinct, { error: 'Reveal slots must not repeat' }),
    miss: showcasePlayerSchema.nullable(),
  })
  .register(contractRegistry, { id: 'ShowcaseDemo' });
export type ShowcaseDemo = z.infer<typeof showcaseDemoSchema>;

// The one XI sent whole: never in the pool (HC 2)
export const showcaseSchema = z
  .object({
    match: matchInPlaySchema,
    // Every slot 0–10 once, so any reveal is in it
    players: z
      .array(revealedPlayerSchema)
      .length(SQUAD_SIZE)
      .refine((players) => isDistinct(players.map((p) => p.slot)), {
        error: 'Player slots must not repeat',
      }),
    demo: showcaseDemoSchema,
  })
  .register(contractRegistry, { id: 'Showcase' });
export type Showcase = z.infer<typeof showcaseSchema>;

const countSchema = z.number().int().nonnegative();

// Dataset figures only: no score (HC 20)
export const catalogOverviewSchema = z
  .object({
    counts: z.object({
      matches: countSchema,
      players: countSchema,
      clubs: countSchema,
      nationalTeams: countSchema,
      seasons: countSchema,
    }),
    era: eraRangeSchema,
    highlights: z.object({
      finals: countSchema,
      shootouts: countSchema,
      extraTime: countSchema,
      goals: countSchema,
    }),
    // By name, as FilterOptions
    competitions: z.array(competitionRefSchema),
    // Most pool matches first, then by name
    topClubs: z.array(clubRefSchema).max(TOP_CLUBS_LIMIT),
    showcase: showcaseSchema.nullable(),
  })
  .register(contractRegistry, { id: 'CatalogOverview' });
export type CatalogOverview = z.infer<typeof catalogOverviewSchema>;
