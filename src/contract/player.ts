import { z } from 'zod';
import {
  idSchema,
  imageUrlSchema,
  positionGroupSchema,
} from '@/contract/common.js';
import { ROUND_MS, SQUAD_SIZE } from '@/contract/constants.js';
import { contractRegistry } from '@/contract/registry.js';

export const duelActorSchema = z
  .enum(['you', 'opponent'])
  .register(contractRegistry, { id: 'DuelActor' });
export type DuelActor = z.infer<typeof duelActorSchema>;

// Opaque per-player key; never the real id (R5)
export const directoryKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{22}$/, 'A directory key');

export const revealedPlayerSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    slot: z
      .number()
      .int()
      .min(0)
      .max(SQUAD_SIZE - 1),
    position: positionGroupSchema,
    imageUrl: imageUrlSchema.nullable(),
    // Equals this player's DirectoryPlayer.key
    directoryKey: directoryKeySchema,
  })
  .register(contractRegistry, { id: 'RevealedPlayer' });
export type RevealedPlayer = z.infer<typeof revealedPlayerSchema>;

export const duelFoundPlayerSchema = revealedPlayerSchema
  .extend({ foundBy: duelActorSchema })
  .register(contractRegistry, { id: 'DuelFoundPlayer' });
export type DuelFoundPlayer = z.infer<typeof duelFoundPlayerSchema>;

// When a player was named; end-of-game only
const namedTimingShape = {
  // 1 is the first name, no gaps
  order: z.number().int().min(1).max(SQUAD_SIZE),
  // From its round's start, capped at the round
  elapsedMs: z.number().int().min(0).max(ROUND_MS),
};

export const namedPlayerSchema = revealedPlayerSchema
  .extend(namedTimingShape)
  .register(contractRegistry, { id: 'NamedPlayer' });
export type NamedPlayer = z.infer<typeof namedPlayerSchema>;

export const duelNamedPlayerSchema = duelFoundPlayerSchema
  .extend(namedTimingShape)
  .register(contractRegistry, { id: 'DuelNamedPlayer' });
export type DuelNamedPlayer = z.infer<typeof duelNamedPlayerSchema>;
