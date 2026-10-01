import { z } from 'zod';
import {
  clubRefSchema,
  competitionRefSchema,
  eraRangeSchema,
} from '@/contract/match.js';
import { contractRegistry } from '@/contract/registry.js';

export const filterOptionsSchema = z
  .object({
    competitions: z.array(competitionRefSchema),
    clubs: z.array(clubRefSchema),
    era: eraRangeSchema,
  })
  .register(contractRegistry, { id: 'FilterOptions' });
export type FilterOptions = z.infer<typeof filterOptionsSchema>;
