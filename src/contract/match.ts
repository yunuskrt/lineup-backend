import { z } from 'zod';
import {
  competitionKindSchema,
  idSchema,
  imageUrlSchema,
  isoDateSchema,
  sideSchema,
} from '@/contract/common.js';
import {
  FIRST_SEASON_START,
  LAST_SEASON_START,
  SQUAD_SIZE,
} from '@/contract/constants.js';
import { contractRegistry } from '@/contract/registry.js';

const OUTFIELD_SIZE = SQUAD_SIZE - 1;

export const clubRefSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    shortName: z.string().min(1),
    crestUrl: imageUrlSchema.nullable(),
  })
  .register(contractRegistry, { id: 'ClubRef' });
export type ClubRef = z.infer<typeof clubRefSchema>;

export const competitionRefSchema = z
  .object({
    id: idSchema,
    kind: competitionKindSchema,
    name: z.string().min(1),
  })
  .register(contractRegistry, { id: 'CompetitionRef' });
export type CompetitionRef = z.infer<typeof competitionRefSchema>;

// 3–5 lines covering every outfield player
export const formationSchema = z
  .string()
  .regex(/^[1-9](-[1-9]){2,4}$/)
  .refine(
    (formation) =>
      formation
        .split('-')
        .map(Number)
        .reduce((sum, line) => sum + line, 0) === OUTFIELD_SIZE,
    { error: `Formation lines must total ${OUTFIELD_SIZE} outfield players` },
  );

export const matchIdentitySchema = z
  .object({
    id: idSchema,
    competition: competitionRefSchema,
    // `2004-05` for leagues, `2006` for tournaments
    season: z.string().regex(/^\d{4}(-\d{2})?$/),
    date: isoDateSchema,
    stage: z.string().min(1).nullable(),
    home: clubRefSchema,
    away: clubRefSchema,
    score: z.object({
      home: z.number().int().nonnegative(),
      away: z.number().int().nonnegative(),
    }),
    nickname: z.string().min(1).nullable(),
  })
  .register(contractRegistry, { id: 'MatchIdentity' });
export type MatchIdentity = z.infer<typeof matchIdentitySchema>;

// Never carries a player of either XI
export const matchInPlaySchema = matchIdentitySchema
  .extend({
    side: sideSchema,
    formation: formationSchema,
  })
  .register(contractRegistry, { id: 'MatchInPlay' });
export type MatchInPlay = z.infer<typeof matchInPlaySchema>;

const seasonStartSchema = z
  .number()
  .int()
  .min(FIRST_SEASON_START)
  .max(LAST_SEASON_START);

export const eraRangeSchema = z
  .object({
    from: seasonStartSchema,
    to: seasonStartSchema,
  })
  .refine((era) => era.from <= era.to, {
    error: 'Era start must not be after its end',
    path: ['to'],
  })
  .register(contractRegistry, { id: 'EraRange' });
export type EraRange = z.infer<typeof eraRangeSchema>;

export const filtersSchema = z
  .object({
    competitionIds: z.array(idSchema),
    clubIds: z.array(idSchema),
    era: eraRangeSchema,
  })
  .register(contractRegistry, { id: 'Filters' });
export type Filters = z.infer<typeof filtersSchema>;
