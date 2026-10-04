import { z } from 'zod';

// `Name <a@b.c>` or a bare address
const SENDER = /^(?:[^<>]+<[^\s@<>]+@[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+)$/;

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    // An empty PORT coerces to 0 and fails min(1)
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    // Signs session cookies; `openssl rand -base64 32`
    BETTER_AUTH_SECRET: z.string().min(32),
    // The backend's own address, callbacks build on it
    BETTER_AUTH_URL: z.url({ protocol: /^https?$/ }),
    // Kept as an origin: a trailing slash is dropped
    WEB_APP_URL: z
      .url({ protocol: /^https?$/ })
      .transform((url) => new URL(url).origin),
    MAIL_FROM: z.string().trim().regex(SENDER, 'Name <address> or address'),
    // Unset: links go to the log, nothing is sent
    RESEND_API_KEY: z.string().startsWith('re_').optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.RESEND_API_KEY, {
    path: ['RESEND_API_KEY'],
    message: 'Required in production',
    // Report it alongside any other bad key
    when: () => true,
  });

export type Env = z.infer<typeof envSchema>;
