import { envSchema, type Env } from '@/config/env.schema.js';

export type EnvIssue = {
  key: string;
  reason: string;
};

export type ParseEnvResult =
  { success: true; data: Env } | { success: false; error: EnvIssue[] };

export function parseEnv(
  raw: Record<string, string | undefined>,
): ParseEnvResult {
  const result = envSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return {
    success: false,
    error: result.error.issues.map((issue) => ({
      key: issue.path.join('.'),
      reason: issue.message,
    })),
  };
}

export function formatEnvIssues(issues: EnvIssue[]): string {
  const lines = issues.map(({ key, reason }) => `  ${key}: ${reason}`);
  return ['Invalid environment:', ...lines].join('\n');
}
