import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  // An empty PORT coerces to 0 and fails min(1)
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
});

export type Env = z.infer<typeof envSchema>;
