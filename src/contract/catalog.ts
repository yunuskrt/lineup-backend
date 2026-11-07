import { z } from 'zod';
import { idSchema, imageUrlSchema } from '@/contract/common.js';
import {
  clubRefSchema,
  competitionRefSchema,
  eraRangeSchema,
  seasonStartSchema,
} from '@/contract/match.js';
import { directoryKeySchema } from '@/contract/player.js';
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
