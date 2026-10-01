import { parseEnv, type ParseEnvResult } from '@/config/parse-env.js';

let cached: ParseEnvResult | undefined;

export function loadEnv(): ParseEnvResult {
  cached ??= parseEnv(process.env);
  return cached;
}
