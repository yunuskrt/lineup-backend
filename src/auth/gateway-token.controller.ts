import { Controller, Get, Header, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { GatewayTokenService } from '@/auth/gateway-token.service.js';
import { DocumentsSession } from '@/auth/session-docs.decorator.js';
import { ContractResponse } from '@/common/contract-response.js';
import { type GatewayToken, gatewayTokenSchema } from '@/contract/auth.js';

// Guarded, so kept off the @Public() AuthController
@ApiTags('auth')
@Controller('auth')
export class GatewayTokenController {
  constructor(private readonly tokens: GatewayTokenService) {}

  @Get('token')
  // A credential: no browser or proxy may keep it
  @Header('Cache-Control', 'no-store')
  @DocumentsSession()
  @ContractResponse(gatewayTokenSchema)
  token(@Req() req: Request): Promise<GatewayToken> {
    return this.tokens.issue(fromNodeHeaders(req.headers));
  }
}
