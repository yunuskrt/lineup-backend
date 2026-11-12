import { z } from 'zod';
import { contractRegistry } from '@/contract/registry.js';

// Whether the Pro split exists; grants nothing
export const appConfigSchema = z
  .object({ proEnabled: z.boolean() })
  .register(contractRegistry, { id: 'AppConfig' });
export type AppConfig = z.infer<typeof appConfigSchema>;
