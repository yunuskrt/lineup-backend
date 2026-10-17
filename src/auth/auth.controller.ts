import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { ApiBody, ApiTags } from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  AUTH_TOKEN_HEADER,
  AuthFlowService,
  type WithCookies,
} from '@/auth/auth-flow.service.js';
import { Public } from '@/auth/public.decorator.js';
import { AUTH_TOKEN_DOC } from '@/auth/session-docs.decorator.js';
import { ContractResponse } from '@/common/contract-response.js';
import { LimitPerAccount, RateLimit } from '@/common/rate-limits.js';
import { ZodValidationPipe } from '@/common/zod-validation.pipe.js';
import {
  sessionOrNullSchema,
  sessionSchema,
  signInRequestSchema,
  signUpRequestSchema,
  upgradeGuestRequestSchema,
  type SignInRequest,
  type SignUpRequest,
  type UpgradeGuestRequest,
} from '@/contract/auth.js';
import { componentRef } from '@/contract/openapi.js';

const headersOf = (req: Request) => fromNodeHeaders(req.headers);

// Forwards the cookie and token; returns the data
function sendCookies<T>(
  res: Response,
  { data, cookies, authToken }: WithCookies<T>,
): T {
  if (cookies.length > 0) res.append('Set-Cookie', cookies);
  if (authToken) res.setHeader(AUTH_TOKEN_HEADER, authToken);
  return data;
}

@ApiTags('auth')
// Each route reads or creates its own session
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthFlowService) {}

  @Get('session')
  @ContractResponse(sessionOrNullSchema)
  async session(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendCookies(res, await this.auth.getSession(headersOf(req)));
  }

  @Post('sign-up')
  @RateLimit('signUp')
  @ApiBody({ schema: { $ref: componentRef('SignUpRequest') } })
  @ContractResponse(sessionSchema, { headers: AUTH_TOKEN_DOC })
  async signUp(
    @Body(new ZodValidationPipe(signUpRequestSchema)) body: SignUpRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendCookies(res, await this.auth.signUp(body, headersOf(req)));
  }

  @Post('sign-in')
  @RateLimit('signIn')
  @LimitPerAccount()
  @ApiBody({ schema: { $ref: componentRef('SignInRequest') } })
  @ContractResponse(sessionSchema, { headers: AUTH_TOKEN_DOC })
  async signIn(
    @Body(new ZodValidationPipe(signInRequestSchema)) body: SignInRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendCookies(res, await this.auth.signIn(body, headersOf(req)));
  }

  @Post('guest')
  @RateLimit('guest')
  @ContractResponse(sessionSchema, { headers: AUTH_TOKEN_DOC })
  async guest(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return sendCookies(res, await this.auth.continueAsGuest(headersOf(req)));
  }

  @Post('upgrade')
  @RateLimit('upgrade')
  @ApiBody({ schema: { $ref: componentRef('UpgradeGuestRequest') } })
  @ContractResponse(sessionSchema, { headers: AUTH_TOKEN_DOC })
  async upgrade(
    @Body(new ZodValidationPipe(upgradeGuestRequestSchema))
    body: UpgradeGuestRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendCookies(res, await this.auth.upgradeGuest(body, headersOf(req)));
  }

  @Post('sign-out')
  @ContractResponse(z.null())
  async signOut(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return sendCookies(res, await this.auth.signOut(headersOf(req)));
  }
}
