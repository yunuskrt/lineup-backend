import { z } from 'zod';
import {
  MAX_GUESS_LENGTH,
  MAX_LIVES,
  SQUAD_SIZE,
} from '@/contract/constants.js';
import { contractRegistry } from '@/contract/registry.js';

export const idSchema = z.string().min(1);

export const epochMsSchema = z.number().int().nonnegative();

export const isoDateSchema = z.iso.date();

export const isoDatetimeSchema = z.iso.datetime();

export const ratioSchema = z.number().min(0).max(1);

export const livesSchema = z.number().int().min(0).max(MAX_LIVES);

export const squadCountSchema = z.number().int().min(0).max(SQUAD_SIZE);

export const guessTextSchema = z.string().trim().min(1).max(MAX_GUESS_LENGTH);

const webUrlSchema = z.url({ protocol: /^https?$/ });

// One leading slash only: `//host` is off-site
const rootPathSchema = z.string().regex(/^\/(?!\/)[^\s?#]+$/);

// Root-relative paths exist for the web mock (W27)
export const imageUrlSchema = z.union([webUrlSchema, rootPathSchema]);

export const sideSchema = z
  .enum(['home', 'away'])
  .register(contractRegistry, { id: 'Side' });
export type Side = z.infer<typeof sideSchema>;

export const competitionKindSchema = z
  .enum(['league', 'ucl', 'uel', 'world_cup', 'euro'])
  .register(contractRegistry, { id: 'CompetitionKind' });
export type CompetitionKind = z.infer<typeof competitionKindSchema>;

export const positionGroupSchema = z
  .enum(['GK', 'DF', 'MF', 'FW'])
  .register(contractRegistry, { id: 'PositionGroup' });
export type PositionGroup = z.infer<typeof positionGroupSchema>;

export const tierSchema = z
  .enum(['free', 'pro'])
  .register(contractRegistry, { id: 'Tier' });
export type Tier = z.infer<typeof tierSchema>;
