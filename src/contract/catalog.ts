import { z } from 'zod';
import { idSchema } from '@/contract/common.js';
import {
  clubRefSchema,
  competitionRefSchema,
  eraRangeSchema,
  seasonStartSchema,
} from '@/contract/match.js';
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
