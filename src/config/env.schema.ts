import { z } from 'zod';

// A domain like lineup.gg: at least one dot
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9-]+\.)+[a-z0-9-]+$/;

// The URL's host is the domain or sits under it
function covers(domain: string, url: string): boolean {
  // A bad URL is already reported on its own key
  if (!URL.canParse(url)) return true;
  const host = new URL(url).hostname;
  return host === domain || host.endsWith(`.${domain}`);
}

const isHttps = (url: unknown) =>
  typeof url !== 'string' || url.startsWith('https://');

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
    // Unset: the session cookie stays host-only
    COOKIE_DOMAIN: z
      .string()
      .trim()
      .toLowerCase()
      .transform((domain) => domain.replace(/^\./, ''))
      .pipe(z.string().regex(DOMAIN, 'A domain like lineup.gg'))
      .optional(),
    // Dev only: unscored mock matches join the pool
    MATCH_POOL_INCLUDE_UNSCORED: z.stringbool().default(false),
    // Proxies in front (Railway, Fly) for req.ip
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    // Off only for e2e suites not about limits
    RATE_LIMITS_ENABLED: z.stringbool().default(true),
    // Unset: every crest and photo URL stays null
    ASSET_BASE_URL: z
      .url({ protocol: /^https$/ })
      .transform((url) => url.replace(/\/+$/, ''))
      .optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.RESEND_API_KEY, {
    path: ['RESEND_API_KEY'],
    message: 'Required in production',
    // Report it alongside any other bad key
    when: () => true,
  })
  .refine(
    (env) =>
      !env.COOKIE_DOMAIN ||
      // A malformed domain already has its own issue
      !DOMAIN.test(env.COOKIE_DOMAIN) ||
      (covers(env.COOKIE_DOMAIN, env.BETTER_AUTH_URL) &&
        covers(env.COOKIE_DOMAIN, env.WEB_APP_URL)),
    {
      path: ['COOKIE_DOMAIN'],
      message: 'Must cover both BETTER_AUTH_URL and WEB_APP_URL',
    },
  )
  // Secure cookies need https on both ends
  .refine(
    (env) => env.NODE_ENV !== 'production' || isHttps(env.BETTER_AUTH_URL),
    { path: ['BETTER_AUTH_URL'], message: 'Production needs https' },
  )
  .refine((env) => env.NODE_ENV !== 'production' || isHttps(env.WEB_APP_URL), {
    path: ['WEB_APP_URL'],
    message: 'Production needs https',
  })
  // HC 13: production serves scored matches only
  .refine(
    (env) => env.NODE_ENV !== 'production' || !env.MATCH_POOL_INCLUDE_UNSCORED,
    {
      path: ['MATCH_POOL_INCLUDE_UNSCORED'],
      message: 'Must be false in production',
      when: () => true,
    },
  )
  .refine((env) => env.NODE_ENV !== 'production' || env.RATE_LIMITS_ENABLED, {
    path: ['RATE_LIMITS_ENABLED'],
    message: 'Must be true in production',
    when: () => true,
  });

export type Env = z.infer<typeof envSchema>;
