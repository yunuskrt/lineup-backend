import { z } from 'zod';
import {
  idSchema,
  imageUrlSchema,
  positionGroupSchema,
} from '@/contract/common.js';
import { SQUAD_SIZE } from '@/contract/constants.js';
import { contractRegistry } from '@/contract/registry.js';

export const duelActorSchema = z
  .enum(['you', 'opponent'])
  .register(contractRegistry, { id: 'DuelActor' });
export type DuelActor = z.infer<typeof duelActorSchema>;

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
  })
  .register(contractRegistry, { id: 'RevealedPlayer' });
export type RevealedPlayer = z.infer<typeof revealedPlayerSchema>;

export const duelFoundPlayerSchema = revealedPlayerSchema
  .extend({ foundBy: duelActorSchema })
  .register(contractRegistry, { id: 'DuelFoundPlayer' });
export type DuelFoundPlayer = z.infer<typeof duelFoundPlayerSchema>;
