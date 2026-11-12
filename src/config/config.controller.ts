import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '@/auth/public.decorator.js';
import { ContractResponse } from '@/common/contract-response.js';
import { RateLimit } from '@/common/rate-limits.js';
import { ENV } from '@/config/config.module.js';
import type { Env } from '@/config/env.schema.js';
import { type AppConfig, appConfigSchema } from '@/contract/config.js';

// Changes only on a restart
export const CONFIG_CACHE_CONTROL = 'public, max-age=300';

@ApiTags('config')
@Controller('config')
export class ConfigController {
  constructor(@Inject(ENV) private readonly env: Env) {}

  // Public: the landing page reads it signed out
  @Public()
  @Get()
  @RateLimit('catalog')
  @Header('Cache-Control', CONFIG_CACHE_CONTROL)
  @ContractResponse(appConfigSchema, {
    headers: {
      'Cache-Control': {
        description: CONFIG_CACHE_CONTROL,
        schema: { type: 'string' },
      },
    },
  })
  config(): AppConfig {
    return { proEnabled: this.env.PRO_ENABLED };
  }
}
